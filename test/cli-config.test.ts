import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
});
