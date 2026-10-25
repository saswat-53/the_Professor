import { createInterface } from "node:readline/promises";
import { CancelledError, ExitCode, INIT_PRESETS, LEVELS, LearnError, insecureTransportWarning, isLocalHost, renderConfig, resolveApiKey, resolveSettings, testRequest, validateSetting } from "../core/index.js";
import type { Config, InitAnswers, InitPreset, LanguageModel, PresetName } from "../core/index.js";

/** Everything the wizard touches outside itself, so a test can drive it with plain streams and a fake endpoint. */
export interface InitDeps {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream;
  env: Record<string, string | undefined>;
  home: string;
  /** Where the config goes. */
  file: string;
  /** The config already there, if any: its values become the defaults. */
  existing?: Config;
  write: (file: string, text: string) => Promise<void>;
  /** Builds the model for the optional test request. */
  model: (apiKey: string | undefined, keyEnv: string | undefined) => LanguageModel;
  /** Warnings and errors, on stderr in the real CLI. */
  warn: (text: string) => void;
  error: (text: string) => void;
}

const SIGINT_EXIT = 130;

/**
 * `learn init`: asks the questions, then writes the global config in one atomic step. Nothing is written until the
 * last answer is in, so Ctrl-C (or the end of input) at any point leaves an existing config untouched. The API key
 * is never asked for: the wizard asks for the NAME of the variable and tells the user to export it.
 * Returns the exit code.
 */
export async function runInit(d: InitDeps): Promise<number> {
  const say = (text = "") => d.output.write(`${text}\n`);
  const rl = createInterface({ input: d.input, output: d.output, terminal: d.input.isTTY === true });
  const controller = new AbortController();
  // Ctrl-C in raw mode arrives as a key (rl "SIGINT"); the end of input is the same wish to stop.
  rl.on("SIGINT", () => controller.abort());
  rl.on("close", () => controller.abort());
  // A signal sent to the process (`kill -INT`, or Ctrl-C once the terminal is cooked) is the same wish; without this the default action would end the process before it could say what was saved.
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  const { signal } = controller;
  let saved = false;

  /** One question with a default; asks again until `check` accepts. A rejected answer is never echoed back. */
  async function ask<T>(question: string, fallback: string | undefined, check: (answer: string) => { value: T } | { error: string }): Promise<T> {
    for (;;) {
      if (signal.aborted) throw new CancelledError();
      let answer: string;
      try {
        answer = await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `, { signal });
      } catch {
        throw new CancelledError();
      }
      const result = check(answer.trim() === "" && fallback !== undefined ? fallback : answer.trim());
      if ("value" in result) return result.value;
      say(`  ${result.error}`);
    }
  }
  const setting = (key: Parameters<typeof validateSetting>[0]) => (raw: string) => validateSetting(key, raw, d.home) as { value: string } | { error: string };

  try {
    // The current file's values are the defaults, read with an empty environment so a LEARN_* variable cannot leak into the file.
    let current: ReturnType<typeof resolveSettings>["settings"] | undefined;
    if (d.existing) {
      try {
        current = resolveSettings({ flags: {}, env: {}, config: d.existing, home: d.home }).settings;
      } catch (err) {
        d.warn(`warning: ${d.file} has a setting that is not valid (${err instanceof Error ? err.message : String(err)}); its values are not used as defaults`);
      }
      say(`${d.file} exists. Press Ctrl-C at any point to leave it as it is.`);
    } else {
      say(`This will create ${d.file}. Press Ctrl-C at any point to stop without writing anything.`);
    }
    say();

    const names = Object.keys(INIT_PRESETS) as PresetName[];
    names.forEach((name, i) => say(`  ${i + 1}) ${INIT_PRESETS[name].label}`));
    const presetName = await ask<PresetName>("Provider", "1", (raw) => {
      const found = names.find((n, i) => raw === String(i + 1) || raw.toLowerCase() === n);
      return found ? { value: found } : { error: `choose 1 to ${names.length}, or one of: ${names.join(", ")}` };
    });
    const preset: InitPreset = INIT_PRESETS[presetName];

    const baseUrl = await ask("Base URL", current?.baseUrl ?? preset.baseUrl, setting("baseUrl"));
    const warning = insecureTransportWarning(baseUrl);
    if (warning) d.warn(warning);
    const model = await ask("Model", current?.model ?? preset.model, setting("model"));

    say();
    say("The API key is never stored by learn, and never asked for here: give the NAME of the environment variable that holds it.");
    const local = isLocalHost(baseUrl);
    const keyDefault = current?.keyEnv ?? preset.keyEnv ?? (local ? "none" : undefined);
    const keyEnv = await ask<string | undefined>("Key variable name", keyDefault, (raw) => {
      if (raw.toLowerCase() === "none") return local ? { value: undefined } : { error: "a hosted endpoint needs a key; name the variable that holds it, such as OPENAI_API_KEY" };
      return validateSetting("keyEnv", raw, d.home) as { value: string } | { error: string };
    });

    const level = await ask("Level (" + LEVELS.join(", ") + ")", current?.level ?? "intermediate", setting("level"));
    const notesDir = await ask("Notes directory (used by /save, coming later)", d.existing && current ? tildeOf(current.notesDir, d.home) : "~/learn-notes", setting("notesDir"));
    // `setting` returned the expanded path; the file keeps what is portable.
    const answers: InitAnswers = { baseUrl, model, keyEnv, level: level as InitAnswers["level"], notesDir: tildeOf(notesDir, d.home), contextBudget: current?.contextBudget, contextWindow: current?.contextWindow };

    if (d.existing) {
      const replace = await ask<boolean>(`Replace ${d.file}`, "n", yesNo);
      if (!replace) {
        say("Left as it is.");
        return 0;
      }
    }
    if (signal.aborted) throw new CancelledError();
    try {
      await d.write(d.file, renderConfig(answers));
    } catch (err) {
      d.error(`could not write ${d.file}: ${(err as NodeJS.ErrnoException).code ?? "failed"}`);
      return ExitCode.Runtime;
    }
    saved = true;
    say();
    say(`Wrote ${d.file}`);
    if (keyEnv) {
      say(d.env[keyEnv] ? `${keyEnv} is set in this shell.` : `Before you run learn, export your key (add the line to your shell profile to keep it):\n  export ${keyEnv}=<your key>`);
    }

    say();
    const test = await ask<boolean>("Send a one-word test request to check the setup", "n", yesNo);
    if (!test) return 0;
    return await sendTest(answers, d, controller, say);
  } catch (err) {
    if (err instanceof CancelledError) {
      say();
      say(saved ? `Cancelled. The config was already saved to ${d.file}.` : "Cancelled. No changes were made.");
      return SIGINT_EXIT;
    }
    throw err;
  } finally {
    process.off("SIGINT", onSignal);
    rl.close();
  }
}

const yesNo = (raw: string) => (/^(y|yes)$/i.test(raw) ? { value: true } : /^(n|no)$/i.test(raw) ? { value: false } : { error: "answer y or n" });

/** The path with the home directory shown as `~`, which is how it is stored. */
const tildeOf = (path: string, home: string) => (path === home ? "~" : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path);

/** The optional check: one tiny request to the endpoint just configured (the only network call `init` can make). */
async function sendTest(a: InitAnswers, d: InitDeps, controller: AbortController, say: (text?: string) => void): Promise<number> {
  try {
    const apiKey = await resolveApiKey({ keyEnv: a.keyEnv, baseUrl: a.baseUrl, env: d.env });
    say(`Asking ${a.model}...`);
    let reply = "";
    for await (const piece of d.model(apiKey, a.keyEnv).stream(testRequest(a), controller.signal)) {
      reply += piece;
      if (reply.length > 200) break;
    }
    // An aborted stream can simply end instead of throwing: that is a cancellation, not an empty answer.
    if (controller.signal.aborted) throw new CancelledError();
    say(reply.trim() === "" ? "The endpoint answered, but with no text. Check the model name." : "It works: the endpoint answered.");
    return 0;
  } catch (err) {
    if (controller.signal.aborted) throw new CancelledError();
    // The config is already saved; the test only reports. Typed errors carry their own message and exit code.
    d.error(err instanceof Error ? err.message : String(err));
    say(`The config was saved. Fix the problem above, or run learn init again.`);
    return err instanceof LearnError ? err.exitCode : ExitCode.Runtime;
  }
}
