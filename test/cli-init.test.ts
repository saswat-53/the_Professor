import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

  it("a real SIGINT while the test request is in flight exits 130, keeps the saved config, and says so", async () => {
    // An endpoint that accepts the request and never answers, so the request is certainly in flight.
    const sockets = new Set<import("node:net").Socket>();
    const server = createServer(() => {});
    server.on("connection", (s) => sockets.add(s));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      const home = await mkdtemp(join(tmpdir(), "learn-init-"));
      const out = await initOnTerminal(home, [
        ["Provider", ENTER],
        ["Base URL", `${url}${ENTER}`],
        ["Model", ENTER],
        ["Key variable name", ENTER],
        ["Level", ENTER],
        ["Notes directory", ENTER],
        ["test request", `y${ENTER}`],
        ["Asking", "signal:SIGINT"],
      ]);
      expect(out).toMatch(/\nexit 130\n$/);
      expect(out).toContain("already saved");
      expect(out).not.toContain("No changes were made");
      expect(await readFile(configIn(home), "utf8")).toContain(`base_url = "${url}"`);
      expect(await readdir(join(home, ".config", "learn"))).toEqual(["config.toml"]);
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }
  }, 30_000);

  describe("an existing config that is broken, huge or holds a secret", () => {
    const SECRET = "SECRETVALUE9x7";
    const cases: [string, string][] = [
      ["a TOML syntax error on a line with a secret", `level = "expert"\napi_key = sk-${SECRET}\n`],
      ["a file over the size cap", `# ${SECRET}\n`.repeat(20_000)],
      ["a base URL with credentials", `[provider]\nbase_url = "http://user:${SECRET}@host/v1"\nmodel = "m"\n`],
      ["a key pasted as key_env", `[provider]\nkey_env = "sk-${SECRET}"\n`],
      ["an unknown key holding a secret", `api_key = "sk-${SECRET}"\n`],
      ["a bad level holding a secret", `level = "${SECRET}"\n`],
    ];
    it.each(cases)("%s: starts without crashing, never prints a value, and Ctrl-C leaves it as it was", async (_name, content) => {
      const home = await mkdtemp(join(tmpdir(), "learn-init-"));
      await mkdir(join(home, ".config", "learn"), { recursive: true });
      await writeFile(configIn(home), content);
      const out = await initOnTerminal(home, [["Provider", "\u0003"]]);
      expect(out).toMatch(/\nexit 130\n$/);
      expect(out).not.toContain(SECRET);
      expect(out).not.toMatch(/Error:|at .*\.js:\d+/);
      expect(await readFile(configIn(home), "utf8")).toBe(content);
    }, 30_000);

    it("names the file when it cannot be used", async () => {
      const home = await mkdtemp(join(tmpdir(), "learn-init-"));
      await mkdir(join(home, ".config", "learn"), { recursive: true });
      await writeFile(configIn(home), `level = "expert"\napi_key = sk-${SECRET}\n`);
      const out = await initOnTerminal(home, [["Provider", "\u0003"]]);
      expect(out).toContain("config.toml");
    }, 30_000);
  });

  describe("a pasted key at the key-variable prompt", () => {
    const keys = ["sk-proj-Ab12Cd34Ef56", "sk_live_abcdef123456", "Xk9aQ2mZp7LwR4tYb8", "AIzaSyD4abc123"];
    it.each(keys)("%s is refused, the program never prints it back, and nothing is written", async (key) => {
      const home = await mkdtemp(join(tmpdir(), "learn-init-"));
      const out = await initOnTerminal(home, [
        ["Provider", `2${ENTER}`],
        ["Base URL", ENTER],
        ["Model", ENTER],
        ["Key variable name", `${key}${ENTER}`],
        ["NAME of an environment variable", "\u0003"],
      ]);
      expect(out).toContain("NAME of an environment variable");
      // The terminal shows what is typed, once; the program's own messages must not repeat it.
      expect(out.split(key).length - 1).toBeLessThanOrEqual(1);
      expect(out).toMatch(/\nexit 130\n$/);
      await expect(stat(join(home, ".config"))).rejects.toThrow();
    }, 30_000);
  });
});
