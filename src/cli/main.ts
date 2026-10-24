import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { BlockedFileError, ContextTooLongError, FileRefusedError, findProjectRoot, LEVELS, LearnError, UsageError, configPath, describeMissing, explain, firstRunMessage, formatContextReport, insecureTransportWarning, parseConfig, prepareRequest, readTextFile, redactUrl, reportForError, resolveApiKey, resolveSettings } from "../core/index.js";
import type { Config, ModelRequest, Resolution } from "../core/index.js";
import { openAICompatibleModel } from "./openai-compatible.js";

const USAGE = `Usage: learn <file> [--base-url <url>] [--model <name>] [--root <dir>] [--level <level>] [--context-budget <chars>] [--allow-sensitive] [--show-prompt] [--dry-run]

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
    for (const warning of resolved.warnings) process.stderr.write(`${warning}\n`);
    if (!config && (!resolved.settings.baseUrl || !resolved.settings.model)) process.stderr.write(`${firstRunMessage(file)}\n\n`);
    return { ok: true, resolved, config, file };
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return { ok: false, exitCode: err instanceof LearnError ? err.exitCode : 2 };
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
      },
    });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n${USAGE}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [reference] = positionals;
  const loaded = await loadSettings(values);
  if (!loaded.ok) return loaded.exitCode;
  const { resolved, config, file } = loaded;
  const { baseUrl, model, level, contextBudget, keyEnv } = resolved.settings;
  if (!baseUrl || !model) {
    if (!baseUrl) process.stderr.write(`${describeMissing("baseUrl", config, file)}\n`);
    if (!model) process.stderr.write(`${describeMissing("model", config, file)}\n`);
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (!reference) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const settings = { baseUrl, model, level, contextBudget };
  const insecure = insecureTransportWarning(baseUrl);
  if (insecure) process.stderr.write(`${insecure}\n`);
  const fail = (err: unknown) => {
    process.stderr.write(`${describe(err)}\n`);
    return err instanceof LearnError ? err.exitCode : 1;
  };
  try {
    const project = await findProjectRoot(process.cwd(), values.root);
    if (project.isHome) {
      process.stderr.write(
        "warning: the project root is your home directory, so everything in it is in reach; run learn from inside a project or pass --root\n",
      );
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
      process.stderr.write(`${formatContextReport(report)}\n`);
      printRequest(request);
      return 0;
    } catch (err) {
      const refused = reportForError(err);
      if (refused) process.stderr.write(`${formatContextReport(refused)}\n`);
      return fail(err);
    }
  }

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  let apiKey: string | undefined;
  try {
    apiKey = resolveApiKey({ keyEnv, baseUrl, env: process.env });
  } catch (err) {
    return fail(err);
  }
  const llm = openAICompatibleModel(apiKey);
  let lastChar = "\n";
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
      process.stderr.write(`${formatContextReport(event.report)}\n`);
    } else if (event.type === "text-delta") {
      process.stdout.write(event.text);
      lastChar = event.text.at(-1) ?? lastChar;
    } else if (event.type === "error") {
      // Start the message on a fresh line, but only if streamed text left the cursor mid-line.
      process.stderr.write(`${lastChar === "\n" ? "" : "\n"}${describe(event.error)}\n`);
      return event.error.exitCode;
    }
  }
  process.stdout.write("\n");
  return 0;
}

process.exitCode = await main();
