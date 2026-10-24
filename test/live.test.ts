import { execFileSync } from "node:child_process";
import { readdir, readFile, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./support/cli.js";

// Ticket 22: opt-in smoke tests against real models. They cost time (and, hosted, a little money), so they run only when
// LEARN_LIVE=1, and never in CI. Run them with:
//   LEARN_LIVE=1 LEARN_LIVE_OLLAMA_MODEL=<a pulled model> DEEPSEEK_API_KEY=<key> npx vitest run test/live.test.ts
// LEARN_LIVE_HOSTED_MODEL overrides the hosted model name (default deepseek-flash). Ollama must be running on localhost:11434. The hosted half is skipped without a key, the local half without a model name.
const live = process.env.LEARN_LIVE === "1";
const ollamaModel = process.env.LEARN_LIVE_OLLAMA_MODEL;

// Checked against each provider's documentation on 2026-10-25 (see the notes in ticket 22).
const OLLAMA_URL = "http://localhost:11434/v1";
const DEEPSEEK_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.LEARN_LIVE_HOSTED_MODEL ?? "deepseek-flash";
const KEY_VAR = "DEEPSEEK_API_KEY";
const deepseekKey = process.env[KEY_VAR];

const SAMPLE = [
  "import { readFileSync } from 'node:fs';",
  "",
  "export function countLines(path: string): number {",
  "  const text = readFileSync(path, 'utf8');",
  "  return text.split('\\n').length;",
  "}",
  "",
].join("\n");

/** A temp git project (inside a temp HOME) with an ordinary file and a Sensitive one. */
async function project() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "learn-live-home-")));
  const repo = join(home, "proj");
  await mkdir(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  await writeFile(join(repo, "sample.ts"), SAMPLE);
  await writeFile(join(repo, ".env"), "TOKEN=not-a-real-secret\n");
  return { home, repo };
}

/** A config file naming the variable that holds the hosted key, as a user would write it. */
async function keyConfig() {
  const xdg = await mkdtemp(join(tmpdir(), "learn-live-xdg-"));
  await mkdir(join(xdg, "learn"));
  await writeFile(join(xdg, "learn", "config.toml"), `[provider]\nkey_env = "${KEY_VAR}"\n`);
  return { XDG_CONFIG_HOME: xdg };
}

/** The environment for a hosted run: endpoint, model, the key in the variable the temp config names, and the temp HOME. */
async function hostedEnv(home: string) {
  return { LEARN_BASE_URL: DEEPSEEK_URL, LEARN_MODEL: DEEPSEEK_MODEL, HOME: home, [KEY_VAR]: deepseekKey!, ...(await keyConfig()) };
}

describe("default CI stays offline", () => {
  it("the workflows never switch the live tests on or provide a key", async () => {
    const dir = join(import.meta.dirname, "../.github/workflows");
    for (const name of await readdir(dir)) {
      const text = await readFile(join(dir, name), "utf8");
      expect(text, name).not.toMatch(/LEARN_LIVE|DEEPSEEK|GEMINI|secrets\./);
    }
  });
});

describe.skipIf(!live || !ollamaModel)("live: local Ollama", () => {
  it("streams a real explanation, with the Context report on stderr", async () => {
    const { home, repo } = await project();
    const r = await run(["sample.ts:3-6"], { LEARN_BASE_URL: OLLAMA_URL, LEARN_MODEL: ollamaModel!, HOME: home }, repo);
    expect(r.stderr).toContain("Context report");
    expect(r.code).toBe(0);
    expect(r.stdout.trim().length).toBeGreaterThan(50);
    expect(r.stdoutChunks.length).toBeGreaterThan(1);
  }, 180_000);
});

describe.skipIf(!live || !deepseekKey)("live: hosted DeepSeek", () => {
  it("streams a real explanation after the Sensitive-file check, project-root check and Context report", async () => {
    const { home, repo } = await project();
    const env = await hostedEnv(home);
    const r = await run(["sample.ts:3-6"], env, repo);
    // The report is shown before the output and names what was sent.
    expect(r.stderr).toContain("Context report: this is what will be sent");
    expect(r.stderr).toContain("sample.ts");
    expect(r.code).toBe(0);
    expect(r.stdout.trim().length).toBeGreaterThan(50);
    expect(r.stdoutChunks.length).toBeGreaterThan(1);
    expect(r.stdout + r.stderr).not.toContain(deepseekKey!);
  }, 120_000);

  it("refuses a Sensitive file before any request, with exit 3 and the file shown as refused in the Context report", async () => {
    const { home, repo } = await project();
    const env = await hostedEnv(home);
    const r = await run([".env"], env, repo);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("Context report");
    expect(r.stderr).toContain("refused: ");
    expect(r.stdout).toBe("");
  }, 30_000);

  it("refuses a file outside the project root", async () => {
    const { home, repo } = await project();
    const outside = join(home, "outside.ts");
    await writeFile(outside, SAMPLE);
    const env = await hostedEnv(home);
    const r = await run([outside], env, repo);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("outside the project root");
    expect(r.stdout).toBe("");
  }, 30_000);
});
