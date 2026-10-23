import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BlockedFileError } from "../src/core/errors.js";
import { buildRequest } from "../src/core/explain.js";
import { createFileReader, isLocalHost } from "../src/core/sensitive.js";
import { run } from "./support/cli.js";

const CANARY = "CANARY-secret-value";
let repo: string;

beforeAll(async () => {
  repo = await realpath(await mkdtemp(join(tmpdir(), "learn-sens-")));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
  await writeFile(join(repo, "ok.ts"), "export const ok = 1;\n");
  await writeFile(join(repo, "ignored.txt"), `${CANARY}\n`);
  await writeFile(join(repo, ".env"), `KEY=${CANARY}\n`);
  await writeFile(join(repo, ".env.example"), "KEY=\n");
  await writeFile(join(repo, "private_key.json"), CANARY);
  await writeFile(join(repo, "server.pem"), CANARY);
  await writeFile(join(repo, "my-secrets.json"), CANARY);
  await writeFile(join(repo, "id_ed25519"), CANARY);
  await mkdir(join(repo, "sub"));
  await writeFile(join(repo, "sub", ".env.local"), CANARY);
  await symlink(join(repo, ".env"), join(repo, "innocent.txt"));
});

const reader = (opts: { allowSensitive?: boolean } = {}) => createFileReader({ root: repo, cwd: repo, ...opts });

describe("sensitive files", () => {
  it.each([
    ["ignored.txt", "gitignore"],
    [".env", ".env"],
    ["sub/.env.local", ".env.*"],
    ["server.pem", "*.pem"],
    ["my-secrets.json", "secret"],
    ["id_ed25519", "id_ed25519"],
    ["innocent.txt", ".env"],
    [".env.example", ".env.*"],
    ["private_key.json", "secret"],
  ])("refuses %s and names the rule %s", async (path, rule) => {
    const err = await reader().read(path).catch((e) => e);
    expect(err).toBeInstanceOf(BlockedFileError);
    expect((err as BlockedFileError).exitCode).toBe(3);
    expect((err as Error).message).toContain(rule);
    expect((err as Error).message).not.toContain(CANARY);
  });

  it("allows ordinary files", async () => {
    expect((await reader().read("ok.ts")).text).toContain("ok");
  });

  it("refuses a second, blocked path asked of the reader directly", async () => {
    const r = reader();
    await r.read("ok.ts");
    await expect(r.read(".env")).rejects.toBeInstanceOf(BlockedFileError);
  });

  it("allowSensitive overrides", async () => {
    expect((await reader({ allowSensitive: true }).read(".env")).text).toContain(CANARY);
  });

  it("is skipped for a localhost endpoint", async () => {
    const r = createFileReader({ root: repo, cwd: repo, baseUrl: "http://localhost:11434/v1" });
    expect((await r.read(".env")).text).toContain(CANARY);
  });

  it.each([
    ["http://localhost:1/v1", true],
    ["http://127.0.0.1/v1", true],
    ["http://[::1]:8080/v1", true],
    ["http://localhost.evil.example/v1", false],
    ["http://127.0.0.1.evil.example/v1", false],
    ["https://api.openai.com/v1", false],
    ["not a url", false],
  ])("isLocalHost(%s) is %s", (url, expected) => {
    expect(isLocalHost(url)).toBe(expected);
  });

  it("buildRequest refuses a blocked reference before building anything", async () => {
    await expect(
      buildRequest({ reference: ".env", cwd: repo, settings: { baseUrl: "http://h/v1", model: "m" } }),
    ).rejects.toBeInstanceOf(BlockedFileError);
  });
});

describe("sensitive files through the CLI", () => {
  const env = { LEARN_BASE_URL: "http://example.invalid/v1", LEARN_MODEL: "m" };

  it("exits 3 and names the rule", async () => {
    const r = await run([".env"], env, repo);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain(".env");
    expect(r.stderr).toContain("--allow-sensitive");
  });

  it.each(["--show-prompt", "--dry-run"])("%s never prints a blocked file's content", async (flag) => {
    const r = await run(["ignored.txt", flag], env, repo);
    expect(r.code).toBe(3);
    expect(r.stdout + r.stderr).not.toContain(CANARY);
  });

  it("--allow-sensitive lets --dry-run through", async () => {
    const r = await run([".env", "--dry-run", "--allow-sensitive"], env, repo);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(CANARY);
  });
});
