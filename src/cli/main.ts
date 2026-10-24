import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { BlockedFileError, CancelledError, ContextTooLongError, FileRefusedError, findProjectRoot, LEVELS, LearnError, UsageError, configPath, describeMissing, explain, firstRunMessage, formatContextReport, insecureTransportWarning, parseConfig, prepareRequest, readTextFile, redactUrl, reportForError, resolveApiKey, resolveSettings } from "../core/index.js";
import type { Config, ModelRequest, Resolution } from "../core/index.js";
import { openAICompatibleModel } from "./openai-compatible.js";
import { createEscapeStripper } from "./escape-stripper.js";
import { outputMode, painter } from "./output.js";
import type { StatusKind } from "./output.js";

/** Status goes to stderr, coloured only for a person watching; stdout carries the explanation alone. */
const mode = outputMode({ stdoutIsTTY: !!process.stdout.isTTY, stderrIsTTY: !!process.stderr.isTTY, env: process.env });
const paint = painter(mode.color);
const status = (kind: StatusKind, text: string) => process.stderr.write(`${paint(kind, text)}\n`);

/** The exit code the run is heading for. Recorded before the message is written, so a pipe that closes mid-message cannot turn a failure into a success. */
let exitCode = 0;
const record = (code: number) => (exitCode = code);

// A closed output pipe (`learn f | head`) is the reader being done, not a failure: end without a stack trace,
// with the code of any failure already found (0 if none). Exiting at once is deliberate: waiting for a closed pipe to drain can hang.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(exitCode);
    throw err;
  });
}

/** Replaced with the package version at build time (tsup `define`). */
declare const __VERSION__: string;

const USAGE = `Usage: learn <file> [--base-url <url>] [--model <name>] [--root <dir>] [--level <level>] [--context-budget <chars>] [--allow-sensitive] [--show-prompt] [--dry-run]
       learn -h | --help | -v | --version

Each setting comes from its flag, then its environment variable (LEARN_BASE_URL, LEARN_MODEL, LEARN_LEVEL, LEARN_CONTEXT_BUDGET),
then the config file (~/.config/learn/config.toml), then the default.
Level is one of: ${LEVELS.join(", ")} (default intermediate).`;

/** A config file is a few lines; this cap also keeps a wrong file (a log, a dump) from being parsed. */
const CONFIG_MAX_BYTES = 64 * 1024;

/**
 * The per-user config file, or undefined when there is none. The project is never searched. It is
 * read with the same safe reader as source files (regular files only, so a named pipe cannot hang
 * the run), and any failure is a usage error that names the file.
 */
async function readConfig(file: string): Promise<Config | undefined> {
  let source;
  try {
    source = await readTextFile(file, CONFIG_MAX_BYTES);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    const why = err instanceof FileRefusedError ? err.detail : code ?? "cannot be read";
    throw new UsageError(`${file}: cannot be used as the config file (${why})`);
  }
  return parseConfig(source, file);
}

/** The parsed command-line values `loadSettings` reads. */
type Flagged = { level?: string; model?: string; "base-url"?: string; "context-budget"?: string };

/** Either the resolved settings with where they came from, or the exit code to end with (the reason is already printed). */
type Loaded = { ok: true; resolved: Resolution; config: Config | undefined; file: string } | { ok: false; exitCode: number };

/** Where the settings come from, in order: flags, environment, the per-user config file. Returns an exit code when they cannot be resolved. */
async function loadSettings(values: Flagged): Promise<Loaded> {
  const home = homedir();
  const file = configPath(process.env, home);
  try {
    const config = await readConfig(file);
    const resolved = resolveSettings({
      flags: { level: values.level, model: values.model, baseUrl: values["base-url"], contextBudget: values["context-budget"] },
      env: process.env,
      config,
      home,
    });
    for (const warning of resolved.warnings) status("warning", warning);
    if (!config && (!resolved.settings.baseUrl || !resolved.settings.model)) {
      status("info", firstRunMessage(file));
      process.stderr.write("\n");
    }
    return { ok: true, resolved, config, file };
  } catch (err) {
    const code = record(err instanceof LearnError ? err.exitCode : 2);
    status("error", err instanceof Error ? err.message : String(err));
    return { ok: false, exitCode: code };
  }
}

/** The error's message, plus CLI-only advice where this frontend has a way to act on it. */
const describe = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof BlockedFileError) return `${message}; pass --allow-sensitive to send it anyway`;
  return err instanceof ContextTooLongError ? `${message}; or raise the limit with --context-budget` : message;
};

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        "base-url": { type: "string" },
        model: { type: "string" },
        level: { type: "string" },
        root: { type: "string" },
        "context-budget": { type: "string" },
        "allow-sensitive": { type: "boolean" },
        "show-prompt": { type: "boolean" },
        "dry-run": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    record(2);
    status("error", err instanceof Error ? err.message : String(err));
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [reference] = positionals;
  // Asked for on purpose, so the answer is the output: stdout, exit 0.
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${__VERSION__}\n`);
    return 0;
  }
  const loaded = await loadSettings(values);
  if (!loaded.ok) return loaded.exitCode;
  const { resolved, config, file } = loaded;
  const { baseUrl, model, level, contextBudget, keyEnv } = resolved.settings;
  if (!baseUrl || !model) {
    record(2);
    if (!baseUrl) status("error", describeMissing("baseUrl", config, file));
    if (!model) status("error", describeMissing("model", config, file));
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (!reference) {
    record(2);
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const settings = { baseUrl, model, level, contextBudget };
  const transportWarning = insecureTransportWarning(baseUrl);
  if (transportWarning) status("warning", transportWarning);
  const codeFor = (err: unknown) => (err instanceof LearnError ? err.exitCode : 1);
  const fail = (err: unknown) => {
    const code = record(codeFor(err));
    status("error", describe(err));
    return code;
  };
  try {
    const project = await findProjectRoot(process.cwd(), values.root);
    if (project.isHome) {
      status("warning", "warning: the project root is your home directory, so everything in it is in reach; run learn from inside a project or pass --root");
    }
  } catch (err) {
    return fail(err);
  }
  const printRequest = (request: ModelRequest) =>
    process.stderr.write(
      `base URL: ${redactUrl(request.baseUrl)}\nmodel: ${request.model}\n--- system ---\n${request.system}\n--- user ---\n${request.user}\n`,
    );

  if (values["dry-run"]) {
    try {
      const { request, report } = await prepareRequest({ reference, settings, root: values.root, allowSensitive: values["allow-sensitive"] });
      status("info", formatContextReport(report));
      printRequest(request);
      return 0;
    } catch (err) {
      record(codeFor(err));
      const refused = reportForError(err);
      if (refused) status("info", formatContextReport(refused));
      return fail(err);
    }
  }

  const controller = new AbortController();
  // Conventional shell codes: 128 + the signal number. A signal ends the request through the abort signal, never by killing the process mid-write.
  const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;
  let cancelCode: number = SIGNAL_EXIT_CODES.SIGINT;
  for (const [name, code] of Object.entries(SIGNAL_EXIT_CODES)) {
    process.on(name, () => {
      // A second signal means "stop now": leave at once instead of waiting for the request to wind down.
      if (controller.signal.aborted) process.exit(code);
      cancelCode = code;
      controller.abort();
    });
  }
  let apiKey: string | undefined;
  try {
    apiKey = resolveApiKey({ keyEnv, baseUrl, env: process.env });
  } catch (err) {
    return fail(err);
  }
  const llm = openAICompatibleModel(apiKey, keyEnv);
  let lastChar = "\n";
  // In terminal mode the model's text could carry escape sequences; in plain mode it is data, left as sent.
  const stripTerminalEscapes = mode.stripEscapes ? createEscapeStripper() : (text: string) => text;
  for await (const event of explain({
    reference,
    settings,
    root: values.root,
    allowSensitive: values["allow-sensitive"],
    model: llm,
    signal: controller.signal,
    onRequest: values["show-prompt"] ? printRequest : undefined,
  })) {
    if (event.type === "context-report") {
      status("info", formatContextReport(event.report));
    } else if (event.type === "text-delta") {
      const text = stripTerminalEscapes(event.text);
      process.stdout.write(text);
      lastChar = text.at(-1) ?? lastChar;
    } else if (event.type === "error") {
      const code = event.error instanceof CancelledError ? cancelCode : event.error.exitCode;
      record(code);
      // Start the message on a fresh line, but only if streamed text left the cursor mid-line.
      if (lastChar !== "\n") process.stderr.write("\n");
      status("error", describe(event.error));
      return code;
    }
  }
  process.stdout.write("\n");
  return 0;
}

process.exitCode = await main();
