import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { BlockedFileError, CancelledError, ContextTooLongError, ExitCode, FileRefusedError, findProjectRoot, LEVELS, LearnError, UsageError, configPath, describeMissing, explain, firstRunMessage, formatContextReport, insecureTransportWarning, parseConfig, prepareRequest, readClipboard, readTextFile, redactUrl, reportForError, resolveApiKey, resolveSettings } from "../core/index.js";
import type { Config, ModelRequest, Resolution } from "../core/index.js";
import { SUBCOMMANDS, USAGE, looksLikeCommand, parseCommandLine } from "./command-line.js";
import type { Flags } from "./command-line.js";
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

/** Piped or clipboard text is read only up to this many bytes, so an endless pipe cannot fill memory; the context budget is the real limit and is far smaller. */
const INPUT_MAX_BYTES = 1024 * 1024;

/** All of standard input as text, or a ContextTooLongError once it passes the cap. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > INPUT_MAX_BYTES) throw new ContextTooLongError(`the piped input is over ${INPUT_MAX_BYTES.toLocaleString("en-US")} bytes; pipe a smaller piece (for example \`sed -n 40,60p file\`)`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

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

/** Either the resolved settings with where they came from, or the exit code to end with (the reason is already printed). */
type Loaded = { ok: true; resolved: Resolution; config: Config | undefined; file: string } | { ok: false; exitCode: number };

/** Where the settings come from, in order: flags, environment, the per-user config file. Returns an exit code when they cannot be resolved. */
async function loadSettings(values: Flags): Promise<Loaded> {
  const home = homedir();
  const file = configPath(process.env, home);
  try {
    const config = await readConfig(file);
    const resolved = resolveSettings({
      flags: { level: values.level, model: values.model, baseUrl: values.baseUrl, contextBudget: values.contextBudget },
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
  const parsed = parseCommandLine(process.argv.slice(2));
  if (parsed.kind === "usage-error") {
    record(ExitCode.Usage);
    status("error", parsed.message);
    process.stderr.write(`${USAGE}\n`);
    return ExitCode.Usage;
  }
  // Asked for on purpose, so the answer is the output: stdout, exit 0.
  if (parsed.kind === "help") {
    process.stdout.write(`${parsed.text.trimEnd()}\n`);
    return 0;
  }
  if (parsed.kind === "version") {
    process.stdout.write(`${__VERSION__}\n`);
    return 0;
  }
  const { reference, flags: values } = parsed;
  if (reference !== undefined && looksLikeCommand(reference) && !existsSync(reference)) {
    record(2);
    // Word references (ticket 35) will make a bare word a real reference; until then it can only be a mistyped command.
    status("error", `"${reference}" is not a command (commands: ${SUBCOMMANDS.join(", ")}) and was not found as a file; word references are not supported yet`);
    process.stderr.write(`${USAGE}\n`);
    return 2;
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
  const codeFor = (err: unknown) => (err instanceof LearnError ? err.exitCode : 1);
  const fail = (err: unknown) => {
    const code = record(codeFor(err));
    status("error", describe(err));
    return code;
  };
  // A file Reference wins over piped input: standard input is then not read at all (so a pipe that never closes cannot hang the run).
  // With no Reference, piped text is the input; a terminal on stdin, or a pipe that carries nothing, is a usage error.
  // --clip asked for the clipboard by name, so a Reference beside it is a conflict rather than something to pick between; standard input is not read.
  let piped: { text: string; lang?: string; origin?: "clipboard" } | undefined;
  if (values.clip && reference) {
    record(2);
    status("error", "--clip cannot be combined with a file reference; give one or the other");
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (reference) {
    if (values.lang !== undefined) status("warning", "warning: --lang only applies to piped input and clipboard text and is ignored for a file reference");
  } else if (values.clip) {
    try {
      piped = { text: await readClipboard({ maxBytes: INPUT_MAX_BYTES }), lang: values.lang, origin: "clipboard" };
    } catch (err) {
      return fail(err);
    }
  } else {
    let text = "";
    try {
      if (!process.stdin.isTTY) text = await readStdin();
    } catch (err) {
      record(err instanceof LearnError ? err.exitCode : 1);
      status("error", describe(err));
      return exitCode;
    }
    if (text.trim() === "") {
      record(2);
      process.stderr.write(`${USAGE}\n`);
      return 2;
    }
    piped = { text, lang: values.lang };
  }
  const settings = { baseUrl, model, level, contextBudget };
  const transportWarning = insecureTransportWarning(baseUrl);
  if (transportWarning) status("warning", transportWarning);
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

  if (values.dryRun) {
    try {
      const { request, report } = await prepareRequest({ reference, piped, settings, root: values.root, allowSensitive: values.allowSensitive });
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
    piped,
    settings,
    root: values.root,
    allowSensitive: values.allowSensitive,
    model: llm,
    signal: controller.signal,
    onRequest: values.showPrompt ? printRequest : undefined,
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
