import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { run } from "./support/cli.js";

let home: string;
let file: string;

/** A home directory whose config.toml holds `toml`, reached through XDG_CONFIG_HOME. */
async function withConfig(toml: string) {
  const xdg = await mkdtemp(join(tmpdir(), "learn-xdg-"));
  await mkdir(join(xdg, "learn"));
  await writeFile(join(xdg, "learn", "config.toml"), toml);
  return { XDG_CONFIG_HOME: xdg, path: join(xdg, "learn", "config.toml") };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "learn-cfg-"));
  file = join(home, "sample.ts");
  await writeFile(file, "export const answer = 42;\n");
});

describe("config file", () => {
  it("supplies base URL, model and level; env beats it; flag beats env", async () => {
    const { path: _p, ...env } = await withConfig('level = "expert"\n[provider]\nbase_url = "http://cfg/v1"\nmodel = "cfg-model"\n');
    let r = await run([file, "--dry-run"], env);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("base URL: http://cfg/v1");
    expect(r.stderr).toContain("model: cfg-model");
    expect(r.stderr).toContain("Level: expert");
    r = await run([file, "--dry-run"], { ...env, LEARN_MODEL: "env-model", LEARN_LEVEL: "beginner" });
    expect(r.stderr).toContain("model: env-model");
    expect(r.stderr).toContain("Level: beginner");
    r = await run([file, "--dry-run", "--model", "flag-model"], { ...env, LEARN_MODEL: "env-model" });
    expect(r.stderr).toContain("model: flag-model");
  });

  it("the budget setting comes from the config file and shows in the report", async () => {
    const env = await withConfig('context_budget = 1234\n[provider]\nbase_url = "http://cfg/v1"\nmodel = "m"\n');
    const r = await run([file, "--dry-run"], env);
    expect(r.stderr).toContain("1,234");
  });

  it("ignores a config file in the project", async () => {
    const project = await mkdtemp(join(tmpdir(), "learn-proj-"));
    await mkdir(join(project, ".config", "learn"), { recursive: true });
    await writeFile(join(project, "learn.toml"), '[provider]\nbase_url = "http://evil/v1"\nmodel = "evil"\n');
    await writeFile(join(project, ".config", "learn", "config.toml"), '[provider]\nbase_url = "http://evil/v1"\nmodel = "evil"\n');
    await writeFile(join(project, "a.ts"), "x\n");
    const r = await run(["a.ts", "--dry-run"], { LEARN_BASE_URL: "http://ok/v1", LEARN_MODEL: "ok" }, project);
    expect(r.stderr).toContain("base URL: http://ok/v1");
    expect(r.stderr).not.toContain("evil");
  });

  it("an invalid value names the key and the file and exits 2", async () => {
    const env = await withConfig('level = "guru"\n');
    const r = await run([file, "--dry-run"], env);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('"level"');
    expect(r.stderr).toContain(env.path);
  });

  it("an unknown key warns, naming it, and the run continues", async () => {
    const env = await withConfig('modle = "x"\n[provider]\nbase_url = "http://cfg/v1"\nmodel = "m"\n');
    const r = await run([file, "--dry-run"], env);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('unknown key "modle"');
  });

  it("with no config file and nothing set, prints the first-run message and exits 2", async () => {
    const r = await run([file]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("No config file at");
    expect(r.stderr).toMatch(/Alternative 1/);
  });

  it("the first-run message goes to stderr (stdout stays empty), says where to save it, and includes a minimal example", async () => {
    const r = await run([file]);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(join(emptyHomeOf(r.stderr), ".config", "learn", "config.toml"));
    expect(r.stderr).toContain("save this there");
    expect(r.stderr).toContain("base_url =");
    expect(r.stderr).toContain("model =");
  });

  it("no first-run message when flags or environment already give the base URL and model", async () => {
    const r = await run([file, "--dry-run"], { LEARN_BASE_URL: "http://x/v1", LEARN_MODEL: "m" });
    expect(r.stderr).not.toContain("No config file");
  });
});

/** The path the message names for the config, found from the output itself. */
const emptyHomeOf = (stderr: string) => /No config file at (.*)\/\.config\/learn\/config\.toml/.exec(stderr)?.[1] ?? "";

describe("base URL credentials", () => {
  const CREDS = "http://user:hunter2@127.0.0.1:9/v1";
  it.each([["--dry-run"], ["--show-prompt"], []])("a URL with credentials is refused (exit 2) and never printed (%s)", async (...flags) => {
    for (const via of ["flag", "env"] as const) {
      const args = [file, ...flags, ...(via === "flag" ? ["--base-url", CREDS] : [])];
      const r = await run(args, { LEARN_MODEL: "m", ...(via === "env" ? { LEARN_BASE_URL: CREDS } : {}) });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("put the key in an environment variable");
      expect(r.stderr).toContain("http://127.0.0.1:9/v1");
      expect(r.stdout + r.stderr).not.toContain("hunter2");
    }
  });
});

describe("missing settings and the first-run hint", () => {
  it("an empty flag falls through, and the error says where it looked", async () => {
    const r = await run([file, "--model", ""], { LEARN_BASE_URL: "http://x/v1" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no model set (looked at --model, LEARN_MODEL, then");
    expect(r.stderr).toContain("an empty value counts as not set");
    expect(r.stderr).not.toContain("no base URL set");
  });

  it("with a config file that lacks the model, names the file and key, and gives no create-a-config hint", async () => {
    const env = await withConfig('[provider]\nbase_url = "http://x/v1"\n');
    const r = await run([file], env);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`"provider.model" in ${env.path}`);
    expect(r.stderr).not.toContain("No config file");
  });

  it("an invalid config gives its specific error and no create-a-config hint", async () => {
    const env = await withConfig('level = "guru"\n');
    const r = await run([file], env);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('invalid "level"');
    expect(r.stderr).not.toContain("No config file");
    expect(r.stderr).not.toContain("save this there");
  });
});

describe("config file safety", () => {
  const withEntry = async (make: (path: string) => Promise<void> | void) => {
    const xdg = await mkdtemp(join(tmpdir(), "learn-xdg-"));
    await mkdir(join(xdg, "learn"));
    const path = join(xdg, "learn", "config.toml");
    await make(path);
    return { XDG_CONFIG_HOME: xdg, path };
  };
  const BASE = { LEARN_BASE_URL: "http://x/v1", LEARN_MODEL: "m" };

  it("a named pipe is refused at once instead of hanging", async () => {
    const env = await withEntry((p) => void execFileSync("mkfifo", [p]));
    const r = await run([file, "--dry-run"], { ...BASE, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(env.path);
    expect(r.stderr).toContain("not a regular file");
  }, 10_000);

  it("a directory in its place is refused", async () => {
    const env = await withEntry((p) => mkdir(p));
    const r = await run([file, "--dry-run"], { ...BASE, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("not a regular file");
  });

  it("an oversized file is refused, naming the cap", async () => {
    const env = await withEntry((p) => writeFile(p, `# ${"x".repeat(70 * 1024)}\n`));
    const r = await run([file, "--dry-run"], { ...BASE, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("too large (over 64 KB)");
  });

  it("an unreadable file is a usage error naming the file", async () => {
    const env = await withEntry((p) => writeFile(p, "level = \"expert\"\n"));
    await chmod(env.path, 0o000);
    const r = await run([file, "--dry-run"], { ...BASE, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME });
    // Root can read anything; elsewhere this must be refused.
    if (process.getuid?.() !== 0) {
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(env.path);
      expect(r.stderr).toContain("EACCES");
    }
  });

  it("a TOML syntax error exits 2 naming the file and line, without echoing the line", async () => {
    const env = await withEntry((p) => writeFile(p, 'api_key = "sk-SECRET123" oops\n'));
    const r = await run([file, "--dry-run"], { ...BASE, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`${env.path}: not valid TOML at line 1`);
    expect(r.stderr).not.toContain("sk-SECRET123");
    expect(r.stderr).not.toContain("    at ");
  });

  it("an unknown key's value is never printed", async () => {
    const env = await withEntry((p) => writeFile(p, 'api_key = "sk-SECRET123"\n'));
    const r = await run([file, "--dry-run"], { ...BASE, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME });
    expect(r.stderr).toContain('unknown key "api_key"');
    expect(r.stderr).not.toContain("sk-SECRET123");
  });

  it("LEARN_ROOT, LEARN_ALLOW_SENSITIVE and root / allow_sensitive in the config change nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-safe-"));
    const outside = await mkdtemp(join(tmpdir(), "learn-outside-"));
    await mkdir(join(dir, ".git"));
    await writeFile(join(outside, "x.ts"), "const outsideRoot = 1;\n");
    await writeFile(join(dir, ".env"), "SECRET_TOKEN=abc\n");
    const env = await withEntry((p) => writeFile(p, `root = "${outside}"\nallow_sensitive = true\n`));
    const settings = { ...BASE, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME, LEARN_ROOT: outside, LEARN_ALLOW_SENSITIVE: "1" };
    const blocked = await run([".env", "--dry-run"], settings, dir);
    expect(blocked.code).toBe(3);
    expect(blocked.stderr).not.toContain("SECRET_TOKEN=abc");
    const escaped = await run([join(outside, "x.ts"), "--dry-run"], settings, dir);
    expect(escaped.code).toBe(3);
    expect(escaped.stderr).not.toContain("outsideRoot");
    for (const r of [blocked, escaped]) {
      expect(r.stderr).toContain("LEARN_ROOT is ignored");
      expect(r.stderr).toContain('"allow_sensitive" in');
    }
  });
});
