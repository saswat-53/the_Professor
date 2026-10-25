import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./support/cli.js";

const BIN = join(import.meta.dirname, "../dist/cli.js");
const HELPER = join(import.meta.dirname, "support/pty-script.py");
const ENTER = "\r";
const hasPython = spawnSync("python3", ["--version"]).status === 0;

/** Types `steps` into `learn init` on a real pseudo-terminal, with a private HOME. */
async function initOnTerminal(home: string, steps: [string, string][]): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile("python3", ["-I", HELPER, JSON.stringify(steps), "node", BIN, "init"], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "", TERM: "dumb", NO_COLOR: "1" }, cwd: tmpdir() }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

const configIn = (home: string) => join(home, ".config", "learn", "config.toml");

describe("learn init without a terminal", () => {
  it("refuses with exit 2 and a message, and writes nothing", async () => {
    const r = await run(["init"], {}, tmpdir(), undefined, "1\n\n\n");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("needs a terminal");
    expect(r.stdout).toBe("");
  });
});

describe.skipIf(!hasPython)("learn init on a terminal", () => {
  it("writes an owner-only config in one piece, and never asks for the key", async () => {
    const home = await mkdtemp(join(tmpdir(), "learn-init-"));
    const out = await initOnTerminal(home, [
      ["Provider", `2${ENTER}`],
      ["Base URL", ENTER],
      ["Model", ENTER],
      ["Key variable name", ENTER],
      ["Level", `beginner${ENTER}`],
      ["Notes directory", ENTER],
      ["test request", `n${ENTER}`],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(out).toContain("export OPENAI_API_KEY=<your key>");
    expect(out).not.toMatch(/api key:|enter your key|paste/i);
    const text = await readFile(configIn(home), "utf8");
    expect(text).toContain('key_env = "OPENAI_API_KEY"');
    expect(text).toContain('level = "beginner"');
    expect((await stat(configIn(home))).mode & 0o777).toBe(0o600);
    expect(await readdir(join(home, ".config", "learn"))).toEqual(["config.toml"]);
    // The file it wrote is one the CLI accepts.
    const sample = join(home, "sample.ts");
    await writeFile(sample, "export const answer = 42;\n");
    const r = await run([sample, "--dry-run"], { HOME: home }, home);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("base URL: https://api.openai.com/v1");
  }, 30_000);

  it("Ctrl-C leaves an existing config byte for byte as it was", async () => {
    const home = await mkdtemp(join(tmpdir(), "learn-init-"));
    await mkdir(join(home, ".config", "learn"), { recursive: true });
    const original = '# mine\nlevel = "expert"\n[provider]\nbase_url = "http://localhost:1234/v1"\nmodel = "mine"\n';
    await writeFile(configIn(home), original, { mode: 0o644 });
    const out = await initOnTerminal(home, [
      ["Provider", ENTER],
      ["Base URL", ENTER],
      ["Model", `other${ENTER}`],
      ["Key variable name", "\u0003"],
    ]);
    expect(out).toMatch(/\nexit 130\n$/);
    expect(out).toContain("No changes were made");
    expect(await readFile(configIn(home), "utf8")).toBe(original);
    expect(await readdir(join(home, ".config", "learn"))).toEqual(["config.toml"]);
  }, 30_000);

  it("Ctrl-C with no config yet creates nothing", async () => {
    const home = await mkdtemp(join(tmpdir(), "learn-init-"));
    const out = await initOnTerminal(home, [["Provider", ENTER], ["Base URL", "\u0003"]]);
    expect(out).toMatch(/\nexit 130\n$/);
    await expect(stat(join(home, ".config"))).rejects.toThrow();
  }, 30_000);
});
