import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runInit } from "../src/cli/init.js";
import type { InitDeps } from "../src/cli/init.js";
import { BadKeyError, parseConfig, resolveSettings } from "../src/core/index.js";
import type { LanguageModel } from "../src/core/index.js";

const HOME = "/home/u";
const FILE = "/home/u/.config/learn/config.toml";
const ENTER = "";
const CTRL_C = "\u0003";

/**
 * Drives the wizard like a person: each time it prints a prompt (a line ending in ": "), the next scripted
 * answer is typed. Returns what it printed, what it wrote, and the exit code.
 */
async function drive(answers: string[], over: Partial<InitDeps> = {}, { tty = false } = {}) {
  const input = Object.assign(new PassThrough(), { isTTY: tty });
  const queue = [...answers];
  let out = "";
  const output = new Writable({
    write(chunk, _enc, done) {
      out += String(chunk);
      if (/: $/.test(out) && queue.length > 0) {
        const next = queue.shift()!;
        setImmediate(() => (next === CTRL_C ? input.write(CTRL_C) : input.write(`${next}\n`)));
        out += "\n"; // the prompt has been answered; do not trigger on it again
      }
      done();
    },
  });
  const written: { file: string; text: string }[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const deps: InitDeps = {
    input,
    output,
    env: {},
    home: HOME,
    file: FILE,
    write: async (file, text) => void written.push({ file, text }),
    model: () => ({ async *stream() { yield "ready"; } }),
    warn: (t) => warnings.push(t),
    error: (t) => errors.push(t),
    ...over,
  };
  const done = runInit(deps);
  // Out of answers and still waiting: the end of input is what a closed terminal sends.
  const code = await Promise.race([done, new Promise<"waiting">((r) => setTimeout(() => r("waiting"), 400))]);
  if (code === "waiting") input.end();
  return { code: code === "waiting" ? await done : code, out, written, warnings, errors };
}

const settingsOf = (text: string) => resolveSettings({ flags: {}, env: {}, config: parseConfig(text, FILE), home: HOME }).settings;

describe("learn init", () => {
  it("all defaults gives a working local config, and never asks for a key", async () => {
    const r = await drive([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, "n"]);
    expect(r.code).toBe(0);
    expect(r.written).toHaveLength(1);
    expect(r.written[0]!.file).toBe(FILE);
    expect(settingsOf(r.written[0]!.text)).toMatchObject({ baseUrl: "http://localhost:11434/v1", model: "llama3.1", level: "intermediate", notesDir: `${HOME}/learn-notes` });
    expect(r.written[0]!.text).not.toMatch(/^key_env/m);
    expect(r.out).not.toMatch(/export /);
    expect(r.out).toContain("never asked for here");
  });

  it("openai: names the variable to export and does not ask for its value", async () => {
    const r = await drive(["2", ENTER, ENTER, ENTER, "beginner", ENTER, "n"]);
    expect(r.code).toBe(0);
    expect(settingsOf(r.written[0]!.text)).toMatchObject({ baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", level: "beginner" });
    expect(r.out).toContain("export OPENAI_API_KEY=<your key>");
  });

  it("says so when the variable is already set, without printing it", async () => {
    const r = await drive(["2", ENTER, ENTER, ENTER, ENTER, ENTER, "n"], { env: { OPENAI_API_KEY: "sk-SECRET-VALUE" } });
    expect(r.out).toContain("OPENAI_API_KEY is set in this shell");
    expect(r.out).not.toContain("sk-SECRET-VALUE");
  });

  it("a key typed where the variable name goes is refused and never echoed", async () => {
    const key = "sk-proj-SECRET123abc";
    const r = await drive(["2", ENTER, ENTER, key, ENTER, ENTER, ENTER, "n"]);
    expect(r.out).toContain("NAME of an environment variable");
    expect(r.out).not.toContain(key);
    expect(r.written[0]!.text).not.toContain(key);
    expect(settingsOf(r.written[0]!.text).keyEnv).toBe("OPENAI_API_KEY");
  });

  it("asks again for a bad URL, with the reader's reason", async () => {
    const r = await drive([ENTER, "ftp://nope", ENTER, ENTER, ENTER, ENTER, ENTER, "n"]);
    expect(r.out).toContain("must start with http:// or https://");
    expect(settingsOf(r.written[0]!.text).baseUrl).toBe("http://localhost:11434/v1");
  });

  it("a hosted endpoint cannot be left without a key variable", async () => {
    const r = await drive(["3", "https://example.com/v1", "m", "none", "MY_KEY", ENTER, ENTER, "n"]);
    expect(r.out).toContain("a hosted endpoint needs a key");
    expect(settingsOf(r.written[0]!.text).keyEnv).toBe("MY_KEY");
  });

  it("warns about plain http to a non-local host", async () => {
    const r = await drive(["3", "http://example.com/v1", "m", "K", ENTER, ENTER, "n"]);
    expect(r.warnings.join("\n")).toMatch(/http/i);
  });

  describe("an existing config", () => {
    const existing = parseConfig(`level = "expert"\ncontext_budget = 5000\nnotes_dir = "~/n"\n[provider]\nbase_url = "http://localhost:1234/v1"\nmodel = "mine"\n`, FILE);

    it("supplies the defaults, asks before replacing, and carries over the context budget", async () => {
      const r = await drive([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, "y", "n"], { existing });
      expect(r.code).toBe(0);
      expect(settingsOf(r.written[0]!.text)).toMatchObject({ baseUrl: "http://localhost:1234/v1", model: "mine", level: "expert", contextBudget: 5000, notesDir: `${HOME}/n` });
    });

    it("answering no leaves it alone", async () => {
      const r = await drive([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, ENTER], { existing });
      expect(r.code).toBe(0);
      expect(r.written).toEqual([]);
    });
  });

  describe("cancelling", () => {
    it("Ctrl-C at a prompt writes nothing and exits 130", async () => {
      const r = await drive([ENTER, ENTER, CTRL_C], { existing: parseConfig('level = "expert"\n', FILE) }, { tty: true });
      expect(r.code).toBe(130);
      expect(r.written).toEqual([]);
      expect(r.out).toContain("No changes were made");
    });

    it("the end of input (Ctrl-D, a closed terminal) is the same", async () => {
      const r = await drive([ENTER, ENTER]);
      expect(r.code).toBe(130);
      expect(r.written).toEqual([]);
    });

    it("Ctrl-C at the last question is still before the write", async () => {
      const r = await drive([ENTER, ENTER, ENTER, ENTER, ENTER, CTRL_C], {}, { tty: true });
      expect(r.code).toBe(130);
      expect(r.written).toEqual([]);
    });
  });

  it("a failed write is reported with its error code and exits 1", async () => {
    const r = await drive([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER], { write: async () => { throw Object.assign(new Error("x"), { code: "EACCES" }); } });
    expect(r.code).toBe(1);
    expect(r.errors.join()).toContain("EACCES");
  });

  describe("the test request", () => {
    it("reports success", async () => {
      const r = await drive([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, "y"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("It works");
    });

    it("cancelling during the test request (the wizard has no prompt then, so drive() ends the input) exits 130 and does not claim nothing was saved", async () => {
      const model: LanguageModel = { async *stream(_r, signal) { await new Promise((r) => signal.addEventListener("abort", r)); throw new Error("aborted"); } };
      const r = await drive([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, "y"], { model: () => model }, { tty: true });
      expect(r.code).toBe(130);
      expect(r.written).toHaveLength(1);
      expect(r.out).toContain("already saved");
      expect(r.out).not.toContain("No changes were made");
    });

    it("reports a typed failure with its message and exit code, and keeps the saved config", async () => {
      const model: LanguageModel = { async *stream() { throw new BadKeyError("the provider rejected the API key; check $OPENAI_API_KEY"); } };
      const r = await drive(["2", ENTER, ENTER, ENTER, ENTER, ENTER, "y"], { env: { OPENAI_API_KEY: "k" }, model: () => model });
      expect(r.code).toBe(new BadKeyError("").exitCode);
      expect(r.errors).toEqual(["the provider rejected the API key; check $OPENAI_API_KEY"]);
      expect(r.written).toHaveLength(1);
    });

    it("a hosted endpoint with the variable unset is reported by name, not sent", async () => {
      let asked = false;
      const r = await drive(["2", ENTER, ENTER, ENTER, ENTER, ENTER, "y"], { model: () => ({ async *stream() { asked = true; yield "x"; } }) });
      expect(asked).toBe(false);
      expect(r.code).toBe(2);
      expect(r.errors.join()).toContain("OPENAI_API_KEY");
    });

    it("the key goes to the model factory, from the named variable only", async () => {
      let seen: string | undefined;
      await drive(["2", ENTER, ENTER, ENTER, ENTER, ENTER, "y"], { env: { OPENAI_API_KEY: " k1 \n", OTHER: "no" }, model: (key) => ((seen = key), { async *stream() { yield "ok"; } }) });
      expect(seen).toBe("k1");
    });
  });
});
