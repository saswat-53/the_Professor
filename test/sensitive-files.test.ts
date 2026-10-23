import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BlockedFileError } from "../src/core/errors.js";
import { buildRequest } from "../src/core/explain.js";
import { createFileReader, isLocalHost } from "../src/core/sensitive.js";
import { run } from "./support/cli.js";

const CANARY = "CANARY-secret-value";
let repo: string;
let fakeHome: string;
let savedEnv: Record<string, string | undefined>;

beforeAll(async () => {
  repo = await realpath(await mkdtemp(join(tmpdir(), "learn-sens-")));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  await writeFile(join(repo, ".gitignore"), "ignored.txt\nbuild/\n*.log\n!keep.log\n");
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
  await mkdir(join(repo, "build"));
  await writeFile(join(repo, "build", "out.js"), CANARY);
  await writeFile(join(repo, "debug.log"), CANARY);
  await writeFile(join(repo, "keep.log"), "fine\n");
  await mkdir(join(repo, "config"));
  await writeFile(join(repo, "config", "local.json"), CANARY);
  await mkdir(join(repo, ".aws"));
  await writeFile(join(repo, ".aws", "config-x"), "x");
  for (const dir of [".aws", ".kube", ".docker", "terraform"]) await mkdir(join(repo, dir), { recursive: true });
  await writeFile(join(repo, ".aws", "credentials"), CANARY);
  await writeFile(join(repo, ".kube", "config"), CANARY);
  await writeFile(join(repo, ".docker", "config.json"), CANARY);
  await writeFile(join(repo, "terraform", "prod.tfstate"), CANARY);
  await writeFile(join(repo, "terraform", "prod.tfvars"), CANARY);
  await writeFile(join(repo, ".git-credentials"), CANARY);
  await writeFile(join(repo, ".pypirc"), CANARY);
  await writeFile(join(repo, ".htpasswd"), CANARY);
  for (const f of [".envrc", ".vault-token", "vault.kdbx", "x.keystore", "terraform/terraform.tfstate.backup", "excluded.txt", "globally.txt"]) {
    await writeFile(join(repo, f), CANARY);
  }
  // A .gitignore below the root, .git/info/exclude, and a global ignore file reached through HOME.
  await mkdir(join(repo, "pkg"));
  await writeFile(join(repo, "pkg", ".gitignore"), "nested.txt\n");
  await writeFile(join(repo, "pkg", "nested.txt"), CANARY);
  await writeFile(join(repo, ".git", "info", "exclude"), "excluded.txt\n");
  fakeHome = await mkdtemp(join(tmpdir(), "learn-home-"));
  await mkdir(join(fakeHome, ".config", "git"), { recursive: true });
  await writeFile(join(fakeHome, ".config", "git", "ignore"), "globally.txt\n");
  savedEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = fakeHome;
  delete process.env.XDG_CONFIG_HOME;
  await symlink(join(repo, ".aws", "credentials"), join(repo, "notes.txt"));
  // Commit config/local.json, THEN ignore it: it stays tracked, which is the common real-world state.
  execFileSync("git", ["add", "config/local.json"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], { cwd: repo });
  await writeFile(join(repo, ".gitignore"), "ignored.txt\nbuild/\n*.log\n!keep.log\nconfig/local.json\n");
});

const reader = (opts: { allowSensitive?: boolean } = {}) => createFileReader({ root: repo, cwd: repo, ...opts });

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("sensitive files", () => {
  it.each([
    ["ignored.txt", "gitignore"],
    [".env", ".env"],
    ["sub/.env.local", ".env.*"],
    ["server.pem", "*.pem"],
    ["my-secrets.json", "secret"],
    ["id_ed25519", "id_ed25519"],
    ["innocent.txt", ".env"],
    ["notes.txt", ".aws/credentials"],
    [".aws/credentials", ".aws/credentials"],
    [".kube/config", ".kube/config"],
    [".docker/config.json", ".docker/config.json"],
    ["terraform/prod.tfstate", "*.tfstate"],
    ["terraform/prod.tfvars", "*.tfvars"],
    [".git-credentials", ".git-credentials"],
    [".pypirc", ".pypirc"],
    [".htpasswd", ".htpasswd"],
    [".envrc", ".envrc"],
    [".vault-token", ".vault-token"],
    ["vault.kdbx", "*.kdbx"],
    ["x.keystore", "*.jks"],
    ["terraform/terraform.tfstate.backup", "*.tfstate"],
    ["pkg/nested.txt", "gitignore"],
    ["excluded.txt", "gitignore"],
    ["globally.txt", "gitignore"],
    ["config/local.json", "gitignore"],
    ["build/out.js", "gitignore"],
    ["debug.log", "gitignore"],
    [".env.example", ".env.*"],
    ["private_key.json", "secret"],
  ])("refuses %s and names the rule %s", async (path, rule) => {
    const err = await reader().read(path).catch((e) => e);
    expect(err).toBeInstanceOf(BlockedFileError);
    expect((err as BlockedFileError).exitCode).toBe(3);
    expect((err as BlockedFileError).rule).toBe(rule);
    expect((err as Error).message).toContain(rule);
    expect((err as Error).message).not.toContain("--allow-sensitive");
    expect((err as Error).message).not.toContain(CANARY);
  });

  it("allows ordinary files and a negated (un-ignored) file", async () => {
    expect((await reader().read("ok.ts")).text).toContain("ok");
    expect((await reader().read("keep.log")).text).toBe("fine\n");
  });

  it("refuses matching .env spellings in any letter case", async () => {
    await writeFile(join(repo, ".ENV"), CANARY);
    await expect(reader().read(".ENV")).rejects.toBeInstanceOf(BlockedFileError);
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
    ["http://localhost@evil.com/v1", false],
    ["http://evil.com/localhost", false],
    ["http://LOCALHOST:11434/v1", true],
    ["http://localhost./v1", false],
    ["http://[::ffff:127.0.0.1]/v1", false],
    ["http://0.0.0.0:8080/v1", false],
    ["http://127.0.0.2/v1", false],
  ])("isLocalHost(%s) is %s", (url, expected) => {
    expect(isLocalHost(url)).toBe(expected);
  });

  it("buildRequest refuses a blocked reference before building anything", async () => {
    await expect(
      buildRequest({ reference: ".env", cwd: repo, settings: { baseUrl: "http://h/v1", model: "m" } }),
    ).rejects.toBeInstanceOf(BlockedFileError);
  });
});

describe("without git, or without a repo", () => {
  it("applies the denylist in a directory that is not a repo, and reads ordinary files", async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), "learn-norepo-")));
    await writeFile(join(plain, ".env"), CANARY);
    await writeFile(join(plain, "a.ts"), "x\n");
    const r = createFileReader({ root: plain, cwd: plain });
    await expect(r.read(".env")).rejects.toBeInstanceOf(BlockedFileError);
    expect((await r.read("a.ts")).text).toBe("x\n");
  });

  // Decision: when git cannot run, the gitignore half cannot be answered, so the read is refused
  // (fail closed). The denylist needs no git, so it still names its rule.
  it("fails closed on gitignore but still applies the denylist when git is missing", async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), "learn-nogit-")));
    await writeFile(join(plain, ".env"), CANARY);
    await writeFile(join(plain, "a.ts"), "x\n");
    const savedPath = process.env.PATH;
    process.env.PATH = plain;
    try {
      const r = createFileReader({ root: plain, cwd: plain });
      await expect(r.read(".env")).rejects.toBeInstanceOf(BlockedFileError);
      const err = await r.read("a.ts").catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(BlockedFileError);
      expect(err.exitCode).toBeDefined();
    } finally {
      process.env.PATH = savedPath;
    }
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

  it("ignores LEARN_ALLOW_SENSITIVE: the override is a flag only", async () => {
    const r = await run([".env", "--dry-run"], { ...env, LEARN_ALLOW_SENSITIVE: "1" }, repo);
    expect(r.code).toBe(3);
    expect(r.stderr).not.toContain(CANARY);
  });

  it("--root does not imply --allow-sensitive, and the reverse", async () => {
    const withRoot = await run([".env", "--dry-run", "--root", repo], env, repo);
    expect(withRoot.code).toBe(3);
    const other = await mkdtemp(join(tmpdir(), "learn-other-"));
    const outside = await run([join(repo, "ok.ts"), "--allow-sensitive", "--dry-run"], env, other);
    expect(outside.code).toBe(3);
    expect(outside.stderr).toContain("outside the project root");
  });

  it("does not exempt look-alike hosts or userinfo tricks", async () => {
    for (const url of ["http://localhost@evil.invalid/v1", "http://127.0.0.1.evil.invalid/v1"]) {
      const r = await run([".env", "--dry-run"], { LEARN_BASE_URL: url, LEARN_MODEL: "m" }, repo);
      expect(r.code).toBe(3);
    }
    const local = await run([".env", "--dry-run"], { LEARN_BASE_URL: "http://localhost:1/v1", LEARN_MODEL: "m" }, repo);
    expect(local.code).toBe(0);
  });

  it("--allow-sensitive lets --dry-run through", async () => {
    const r = await run([".env", "--dry-run", "--allow-sensitive"], env, repo);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(CANARY);
  });
});
