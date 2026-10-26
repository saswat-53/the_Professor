import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { appendGlossaryEntry, attachReferences, findRepoAround, BlockedFileError, buildSystemPrompt, CancelledError, ContextTooLongError, ExitCode, FileRefusedError, SessionTooLongError, findProjectRoot, LEVELS, LearnError, UsageError, WordNotFoundError, configPath, describeMissing, Session, explain, firstRunMessage, formatContextReport, insecureTransportWarning, parseConfig, prepareRequest, readClipboard, readTextFile, redactUrl, reportForError, resolveApiKey, resolveEndpoint, resolveSessionCap, resolveSettings, saveNote, trimEnds } from "../core/index.js";
import type { Config, ModelRequest, Resolution } from "../core/index.js";
import { SUBCOMMANDS, USAGE, looksLikeCommand, parseCommandLine } from "./command-line.js";
import type { Flags } from "./command-line.js";
import { runChat } from "./chat.js";
import { writeFileAtomic } from "./atomic-write.js";
import { readHidden } from "./hidden-input.js";
import { runInit } from "./init.js";
import { KeychainUnavailableError, osKeychain } from "./keychain.js";
import { openAICompatibleModel } from "./openai-compatible.js";
import { createEscapeStripper } from "./escape-stripper.js";
import { outputMode, painter } from "./output.js";
import { owlBanner } from "./owl.js";
import { chooseOwlStyle, startMascot } from "./mascot/mascot.js";
import { colorDepth } from "./mascot/render.js";
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
async function loadSettings(values: Flags, { needsModel = true } = {}): Promise<Loaded> {
  const home = homedir();
  const file = configPath(process.env, home);
  try {
    const config = await readConfig(file);
    const resolved = resolveSettings({
      flags: { level: values.level, model: values.model, baseUrl: values.baseUrl, contextBudget: values.contextBudget, contextWindow: values.contextWindow },
      env: process.env,
      config,
      home,
    });
    for (const warning of resolved.warnings) status("warning", warning);
    if (!config && (!resolved.settings.baseUrl || (needsModel && !resolved.settings.model))) {
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
  // A bare lowercase word that nothing defines is more likely a mistyped command than a name to look up.
  if (err instanceof WordNotFoundError && looksLikeCommand(err.word)) return `${message}; if you meant a command, the commands are: ${SUBCOMMANDS.join(", ")}`;
  if (err instanceof BlockedFileError) return `${message}; pass --allow-sensitive to send it anyway`;
  if (err instanceof SessionTooLongError) return `${message}; lower --context-budget or narrow the range, or for a local model raise --context-window (its context window in tokens)`;
  return err instanceof ContextTooLongError ? `${message}; or raise the limit with --context-budget` : message;
};

/** `learn init`: needs a person at a terminal, since it asks questions and nothing else could answer them. */
async function initCommand(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    record(ExitCode.Usage);
    status("error", "learn init asks questions, so it needs a terminal (standard input and output must both be one); run it directly in your shell, or write the config file yourself");
    return ExitCode.Usage;
  }
  const home = homedir();
  const file = configPath(process.env, home);
  let existing: Config | undefined;
  try {
    existing = await readConfig(file);
  } catch (err) {
    // Something is there but unusable: still "exists", so the user is asked before it is replaced.
    status("warning", `warning: ${err instanceof Error ? err.message : String(err)}`);
    existing = { file, values: {} };
  }
  const code = await runInit({
    input: process.stdin,
    output: process.stdout,
    env: process.env,
    home,
    file,
    existing,
    write: writeFileAtomic,
    model: openAICompatibleModel,
    warn: (text) => status("warning", text),
    error: (text) => status("error", text),
  });
  return record(code);
}

/** A key is a short line; this cap keeps a wrong pipe (a log, a binary) from being read whole. */
const KEY_MAX_BYTES = 16 * 1024;

/** The key for `learn auth set`: typed with nothing shown when a person is at the terminal, otherwise the first line of standard input. */
async function readKey(host: string): Promise<string> {
  // The prompt goes to stderr, but whether it is visible does not matter for hiding: any terminal on stdin means a person typing, so never echo.
  if (process.stdin.isTTY) {
    return await readHidden(process.stdin as unknown as Parameters<typeof readHidden>[0], `API key for ${host} (typing is hidden): `, (text) => process.stderr.write(text));
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > KEY_MAX_BYTES) throw new UsageError("the key on standard input is far longer than any API key; pipe only the key");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").split("\n")[0] ?? "";
}

/** `learn auth set` and `learn auth delete`: keep or remove the key in the OS keychain under the configured endpoint's host (and port, if the URL names one). The key is never printed. */
async function authCommand(action: "set" | "delete", values: Flags): Promise<number> {
  const loaded = await loadSettings(values, { needsModel: false });
  if (!loaded.ok) return loaded.exitCode;
  const { baseUrl } = loaded.resolved.settings;
  const host = baseUrl === undefined ? undefined : resolveEndpoint(baseUrl).keyHost;
  if (host === undefined) {
    record(ExitCode.Usage);
    status("error", baseUrl === undefined ? `${describeMissing("baseUrl", loaded.config, loaded.file)}; the key is stored under the endpoint's host` : "the base URL cannot be read, so there is no host the key is stored under");
    return ExitCode.Usage;
  }
  const done = action === "set" ? "stored" : "removed";
  try {
    if (action === "set") {
      const key = trimEnds(await readKey(host)) ?? "";
      if (!key) throw new UsageError("no key was given, so nothing was stored");
      await osKeychain().set(host, key);
    } else if (!(await osKeychain().delete(host))) {
      status("info", `No key was stored for ${host}; nothing to remove.`);
      return 0;
    }
  } catch (err) {
    if (err instanceof CancelledError) {
      record(130);
      status("info", "Cancelled; nothing was stored.");
      return 130;
    }
    if (err instanceof KeychainUnavailableError) {
      record(ExitCode.Runtime);
      status("error", `cannot use the OS keychain: ${err.message}. Nothing was ${done}. Setting the key in an environment variable still works (name it with key_env in the config file).`);
      return ExitCode.Runtime;
    }
    const code = record(err instanceof LearnError ? err.exitCode : 1);
    status("error", describe(err));
    return code;
  }
  status("info", `${action === "set" ? "Stored the key for" : "Removed the key for"} ${host} ${action === "set" ? "in" : "from"} the OS keychain.`);
  return 0;
}

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
  if (parsed.kind === "init") return await initCommand();
  if (parsed.kind === "auth") return await authCommand(parsed.action, parsed.flags);
  const { reference, flags: values } = parsed;
  if (values.chat) {
    const problem = values.dryRun
      ? "--chat cannot be combined with --dry-run: a dry run sends nothing, so there is nothing to talk about"
      : !process.stdin.isTTY || !process.stdout.isTTY
        ? "--chat needs a terminal (standard input and output must both be one), because it asks you questions; run it directly in your shell, without a pipe"
        : undefined;
    if (problem) {
      record(2);
      status("error", problem);
      return 2;
    }
  }
  const loaded = await loadSettings(values);
  if (!loaded.ok) return loaded.exitCode;
  const { resolved, config, file } = loaded;
  const { baseUrl, model, level, contextBudget, contextWindow, keyEnv, notesDir } = resolved.settings;
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
  const diffRequested = values.diff !== undefined;
  const blameRequested = values.blame !== undefined;
  if (blameRequested && (reference || values.clip || diffRequested)) {
    record(2);
    status("error", `--blame cannot be combined with ${reference ? "a file reference" : values.clip ? "--clip" : "--diff"}; give one or the other${reference ? " (the file and lines go in --blame's value: --blame path:N-M)" : ""}`);
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (diffRequested && (reference || values.clip)) {
    record(2);
    status("error", `--diff cannot be combined with ${reference ? "a file reference" : "--clip"}; give one or the other${reference ? ` (if "${reference}" was meant as the ref to compare with, it must follow --diff directly)` : ""}`);
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (values.clip && reference) {
    record(2);
    status("error", "--clip cannot be combined with a file reference; give one or the other");
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (diffRequested || blameRequested) {
    if (values.lang !== undefined) status("warning", `warning: --lang only applies to piped input and clipboard text and is ignored for ${blameRequested ? "--blame" : "--diff"}`);
  } else if (reference) {
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
  const settings = { baseUrl, model, level, contextBudget, contextWindow };
  const transportWarning = insecureTransportWarning(baseUrl);
  if (transportWarning) status("warning", transportWarning);
  if (contextWindow !== undefined && !resolveEndpoint(baseUrl).local) status("warning", "warning: context_window only applies to local endpoints; it is ignored for this one");
  try {
    const project = await findProjectRoot(process.cwd(), values.root);
    if (project.isHome) {
      status("warning", "warning: the project root is your home directory, so everything in it is in reach; run learn from inside a project or pass --root");
    }
  } catch (err) {
    return fail(err);
  }
  const diff = diffRequested ? { ...(typeof values.diff === "string" && { ref: values.diff }), ...(values.diffPaths && { paths: values.diffPaths }) } : undefined;
  const printRequest = (request: ModelRequest) =>
    process.stderr.write(
      `base URL: ${redactUrl(request.baseUrl)}\nmodel: ${request.model}\n--- system ---\n${request.system}\n${(request.history ?? []).map((m) => `--- ${m.role} (earlier) ---\n${m.content}\n`).join("")}--- user ---\n${request.user}\n`,
    );

  if (values.dryRun) {
    try {
      const { request, report } = await prepareRequest({ reference, piped, diff, blame: values.blame, settings, root: values.root, allowSensitive: values.allowSensitive });
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
  // What names a saved note: the Reference as typed, or where piped text came from.
  const sessionTitle = reference ?? (blameRequested ? "blame" : diffRequested ? "diff" : values.clip ? "clipboard" : "piped input");
  // The cap on the transcript: hosted, four times the context budget; local, derived from the context window (see `resolveSessionCap`).
  const session = values.chat
    ? new Session(resolveSessionCap(resolveEndpoint(baseUrl), { contextBudget, contextWindow, systemChars: buildSystemPrompt(level).length }))
    : undefined;
  // Conventional shell codes: 128 + the signal number. A signal ends the request through the abort signal, never by killing the process mid-write.
  const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;
  let cancelCode: number = SIGNAL_EXIT_CODES.SIGINT;
  // What a signal does is replaceable: the chat takes it over once the first explanation is done.
  let onSignal = (code: number) => {
    // A second signal means "stop now": leave at once instead of waiting for the request to wind down.
    if (controller.signal.aborted) process.exit(code);
    cancelCode = code;
    controller.abort();
  };
  for (const [name, code] of Object.entries(SIGNAL_EXIT_CODES)) process.on(name, () => onSignal(code));
  let apiKey: string | undefined;
  try {
    apiKey = await resolveApiKey({ keyEnv, baseUrl, env: process.env, store: osKeychain() });
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
    diff,
    blame: values.blame,
    settings,
    root: values.root,
    allowSensitive: values.allowSensitive,
    session,
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
  if (!session) return 0;
  // The explanation is already on screen; if its size leaves no room to ask anything, say so instead of opening a chat that refuses every question.
  try {
    session.assertPinnedFits();
  } catch (err) {
    status("info", "the explanation above is complete; only the chat that would follow it is refused");
    return fail(err);
  }
  let chatSignals = 0;
  // Notes hold code from the project: if the notes directory sits inside a git work tree they could be committed by accident. Said once, before the first write.
  let notesRepoChecked = false;
  const warnIfNotesInRepo = async () => {
    if (notesRepoChecked) return;
    notesRepoChecked = true;
    const repo = await findRepoAround(notesDir).catch(() => undefined);
    if (repo) status("warning", `warning: the notes directory ${notesDir} is inside the git repository ${repo.root}; saved notes contain code and could be committed by accident (add the folder to .gitignore, or point notes_dir somewhere else)`);
  };
  // The owl: animated in a header when the terminal allows, a still picture otherwise, nothing with LEARN_OWL=off.
  const owl = chooseOwlStyle({ color: mode.color, rows: process.stdout.rows, columns: process.stdout.columns, env: process.env });
  const mascot = owl === "animated" ? startMascot({ output: process.stdout, depth: colorDepth(process.env) }) : undefined;
  let finished: number | undefined;
  try {
    finished = await runChat({
      input: process.stdin,
      output: process.stdout,
      banner: owl === "static" ? owlBanner({ color: mode.color }) : undefined,
      mascot,
      session,
      model: llm,
      stripper: () => (mode.stripEscapes ? createEscapeStripper() : (text: string) => text),
      report: (kind, text) => status(kind, text),
      describe,
      attach: (question) => attachReferences({ question, settings, root: values.root, allowSensitive: values.allowSensitive }),
      onRequest: values.showPrompt ? printRequest : undefined,
      save: async (name) => (await warnIfNotesInRepo(), saveNote({ notesDir, turns: session.turns, title: name ?? sessionTitle, now: new Date() })),
      glossary: async (term, definition) => (await warnIfNotesInRepo(), appendGlossaryEntry({ notesDir, term, definition, now: new Date() })),
      takeSignals: (handler) => {
        onSignal = (code) => {
          // The same "stop now" rule: a repeated SIGTERM while already winding down leaves at once.
          if (code === 143 && chatSignals++ > 0) process.exit(code);
          handler(code);
        };
      },
    });
  } finally {
    // A wave goodbye on a normal ending; a SIGTERM (143) or a crash gets the terminal back at once.
    await mascot?.close({ farewell: finished !== undefined && finished !== 143 });
  }
  return record(finished);
}

process.exitCode = await main();
