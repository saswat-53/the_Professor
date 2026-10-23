import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UsageError } from "../src/core/errors.js";
import { findRepo, runGit } from "../src/core/git.js";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

async function tempDir(prefix = "learn-git-") {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

async function tempRepo({ commit = true } = {}) {
  const dir = await tempDir();
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  if (commit) {
    await writeFile(join(dir, "a.txt"), "one\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "first");
  }
  return dir;
}

describe("subcommand allowlist", () => {
  it.each(["push", "config", "status", "checkout", "-c", ""])(
    "rejects %j before spawning anything",
    async (sub) => {
      // The root does not exist, so a spawn would fail with ENOENT, not UsageError.
      await expect(runGit("/no/such/root", sub as never, {})).rejects.toBeInstanceOf(UsageError);
    },
  );

  it.each(["log", "diff", "blame", "show", "rev-parse"] as const)("runs %s", async (sub) => {
    const root = await tempRepo();
    const args = sub === "rev-parse" ? ["--git-dir"] : sub === "blame" ? [] : ["--oneline"];
    const paths = sub === "blame" ? ["a.txt"] : [];
    await expect(runGit(root, sub, { args, paths })).resolves.toEqual(expect.any(String));
  });
});

describe("argument safety", () => {
  it("handles shell metacharacters in a path literally, without a shell", async () => {
    const root = await tempRepo();
    const name = "weird $(touch pwned) ;`x` [a]*?.txt";
    await writeFile(join(root, name), "hi\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "weird");
    const out = await runGit(root, "log", { args: ["--format=%s"], paths: [name] });
    expect(out.trim()).toBe("weird");
    expect(existsSync(join(root, "pwned"))).toBe(false);
  });

  it("puts -- before every path, so a path named like a flag is a path", async () => {
    const root = await tempRepo();
    await writeFile(join(root, "--stat"), "x\n");
    git(root, "add", "-A", "--", "--stat");
    git(root, "commit", "-q", "-m", "flaggy");
    const out = await runGit(root, "log", { args: ["--format=%s"], paths: ["--stat"] });
    expect(out.trim()).toBe("flaggy");
  });

  it("rejects a ref starting with a dash", async () => {
    const root = await tempRepo();
    await expect(
      runGit(root, "show", { refs: ["--output=evil.txt"] }),
    ).rejects.toBeInstanceOf(UsageError);
    expect(existsSync(join(root, "evil.txt"))).toBe(false);
  });

  it("rejects a path outside the project root", async () => {
    const root = await tempRepo();
    for (const p of ["../outside.txt", "/etc/passwd", "sub/../../x"]) {
      await expect(runGit(root, "log", { paths: [p] })).rejects.toBeInstanceOf(UsageError);
    }
  });

  it("accepts an absolute path inside the root", async () => {
    const root = await tempRepo();
    await expect(runGit(root, "log", { paths: [join(root, "a.txt")] })).resolves.toContain("first");
  });
});

describe("external programs", () => {
  it("runs neither an external diff driver nor a pager", async () => {
    const root = await tempRepo();
    const bin = await tempDir("learn-bin-");
    const marker = join(bin, "ran");
    const script = join(bin, "spy.sh");
    await writeFile(script, `#!/bin/sh\ntouch "${marker}"\ncat\n`);
    await chmod(script, 0o755);
    git(root, "config", "diff.external", script);
    git(root, "config", "core.pager", script);
    git(root, "config", "pager.diff", script);
    git(root, "config", "pager.log", script);
    git(root, "config", "pager.show", script);
    await writeFile(join(root, ".gitattributes"), "*.txt diff=spy\n");
    git(root, "config", "diff.spy.command", script);
    git(root, "config", "diff.spy.textconv", script);
    await writeFile(join(root, "a.txt"), "one\ntwo\n");
    for (const sub of ["diff", "log", "show"] as const) {
      const args = sub === "log" ? ["-p"] : [];
      await runGit(root, sub, { args });
    }
    expect(existsSync(marker)).toBe(false);
  });
});

describe("findRepo", () => {
  it("finds the root from a subdirectory", async () => {
    const root = await tempRepo();
    await mkdir(join(root, "src/deep"), { recursive: true });
    const repo = await findRepo(join(root, "src/deep"));
    expect(repo).toEqual({ root, shallow: false, hasCommits: true });
  });

  it("reports no repo outside one", async () => {
    expect(await findRepo(await tempDir())).toBeUndefined();
  });

  it("works in a repo with no commits", async () => {
    const root = await tempRepo({ commit: false });
    expect(await findRepo(root)).toEqual({ root, shallow: false, hasCommits: false });
  });

  it("reports a shallow clone", async () => {
    const origin = await tempRepo();
    await writeFile(join(origin, "a.txt"), "one\ntwo\n");
    git(origin, "commit", "-q", "-am", "second");
    const parent = await tempDir();
    git(parent, "clone", "-q", "--depth", "1", `file://${origin}`, "clone");
    const repo = await findRepo(join(parent, "clone"));
    expect(repo?.shallow).toBe(true);
    expect(repo?.hasCommits).toBe(true);
  });
});
