import { execFileSync } from "node:child_process";
import { readFile, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContextTooLongError, UnexpectedError, UntrustedRepoError, UsageError } from "../src/core/errors.js";
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

  it("rejects a symlink inside the root that points outside it", async () => {
    const root = await tempRepo();
    const outside = await tempDir();
    await symlink(outside, join(root, "link"));
    await expect(runGit(root, "log", { paths: ["link"] })).rejects.toBeInstanceOf(UsageError);
  });

  it("names the git subcommand when git fails", async () => {
    const root = await tempRepo();
    await expect(runGit(root, "show", { refs: ["no-such-ref"] })).rejects.toThrow(/^git show failed/);
  });

  it("accepts an absolute path inside the root", async () => {
    const root = await tempRepo();
    await expect(runGit(root, "log", { paths: [join(root, "a.txt")] })).resolves.toContain("first");
  });
});

/** A script that records that it ran, so a test can assert it never did. */
async function spy() {
  const bin = await tempDir("learn-bin-");
  const marker = join(bin, "ran");
  const script = join(bin, "spy.sh");
  await writeFile(script, `#!/bin/sh\ntouch "${marker}"\ncat\n`);
  await chmod(script, 0o755);
  return { script, marker };
}

const ALL = ["log", "diff", "blame", "show", "rev-parse", "check-ignore"] as const;
async function runEach(root: string) {
  for (const sub of ALL) {
    const opts =
      sub === "blame" ? { paths: ["a.txt"] }
      : sub === "check-ignore" ? { paths: ["a.txt"] }
      : sub === "log" ? { args: ["-p"] }
      : sub === "rev-parse" ? { args: ["--git-dir"] }
      : {};
    await runGit(root, sub, opts);
  }
}

// Note: git never starts a pager when its output is piped, so pagers cannot be proven here;
// they are disabled in config anyway (core.pager, --no-pager).
describe("programs named by repo config are never run", () => {
  it("external diff driver and textconv filter", async () => {
    const root = await tempRepo();
    const { script, marker } = await spy();
    git(root, "config", "diff.external", script);
    await writeFile(join(root, ".gitattributes"), "*.txt diff=spy\n");
    git(root, "config", "diff.spy.command", script);
    git(root, "config", "diff.spy.textconv", script);
    await writeFile(join(root, "a.txt"), "one\ntwo\n");
    await runEach(root);
    expect(existsSync(marker)).toBe(false);
  });

  it("core.fsmonitor", async () => {
    const root = await tempRepo();
    const { script, marker } = await spy();
    git(root, "config", "core.fsmonitor", script);
    await writeFile(join(root, "a.txt"), "one\ntwo\n");
    await runEach(root);
    expect(existsSync(marker)).toBe(false);
  });

  // REGRESSION GUARD: passes today even without the `core.hooksPath=/dev/null` override, because
  // none of our read-only subcommands run hooks. The override is the remaining protection if one ever does.
  it("regression guard: core.hooksPath hooks are not run", async () => {
    const root = await tempRepo();
    const { script, marker } = await spy();
    const hooks = await tempDir("learn-hooks-");
    for (const hook of ["post-index-change", "reference-transaction", "post-checkout", "fsmonitor-watchman"]) {
      await writeFile(join(hooks, hook), `#!/bin/sh\ntouch "${marker}"\n`);
      await chmod(join(hooks, hook), 0o755);
    }
    git(root, "config", "core.hooksPath", hooks);
    void script;
    await writeFile(join(root, "a.txt"), "one\ntwo\n");
    await runEach(root);
    expect(existsSync(marker)).toBe(false);
  });

  // REGRESSION GUARD: passes today even without the `core.attributesFile=/dev/null` override, because
  // --no-textconv (and --no-ext-diff) already stop a routed filter from running. If --no-textconv is
  // ever removed, this override becomes the only thing between a hostile attributes file and execution.
  it("regression guard: core.attributesFile filters are not run", async () => {
    const root = await tempRepo();
    const { script, marker } = await spy();
    const attrs = join(await tempDir("learn-attrs-"), "attributes");
    await writeFile(attrs, "* diff=spy\n");
    git(root, "config", "core.attributesFile", attrs);
    git(root, "config", "diff.spy.textconv", script);
    git(root, "config", "diff.spy.command", script);
    await writeFile(join(root, "a.txt"), "one\ntwo\n");
    await runEach(root);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("environment", () => {
  it("does not let GIT_EXTERNAL_DIFF, GIT_PAGER or GIT_DIR from our process reach git", async () => {
    const root = await tempRepo();
    const other = await tempRepo({ commit: false });
    const { script, marker } = await spy();
    await writeFile(join(root, "a.txt"), "one\ntwo\n");
    const saved = { ...process.env };
    Object.assign(process.env, { GIT_EXTERNAL_DIFF: script, GIT_PAGER: script, GIT_DIR: join(other, ".git") });
    try {
      expect(await runGit(root, "log", { args: ["--format=%s"] })).toBe("first\n");
      await runGit(root, "diff");
      expect((await findRepo(root))?.hasCommits).toBe(true);
    } finally {
      for (const k of ["GIT_EXTERNAL_DIFF", "GIT_PAGER", "GIT_DIR"]) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
    expect(existsSync(marker)).toBe(false);
  });
});

describe("read-only", () => {
  it("leaves .git/index byte-identical even when the index is stale", async () => {
    const root = await tempRepo();
    git(root, "status", "-s"); // settle the freshly written index so only the touch below is stale
    // A touched mtime makes git want to refresh (and rewrite) the index.
    const later = new Date(Date.now() + 60_000);
    await utimes(join(root, "a.txt"), later, later);
    const before = await readFile(join(root, ".git/index"));
    await runEach(root);
    expect(Buffer.compare(before, await readFile(join(root, ".git/index")))).toBe(0);
  });
});

describe("check-ignore", () => {
  it("lists ignored paths and returns nothing when none are ignored", async () => {
    const root = await tempRepo();
    await writeFile(join(root, ".gitignore"), "*.log\n");
    expect(await runGit(root, "check-ignore", { paths: ["x.log", "a.txt"] })).toBe("x.log\n");
    expect(await runGit(root, "check-ignore", { paths: ["a.txt"] })).toBe("");
  });

  it("handles hostile and flag-like paths literally", async () => {
    const root = await tempRepo();
    await writeFile(join(root, ".gitignore"), "*\n");
    const names = ["--stat", "$(touch pwned)", "a b;c", "[x]*?"];
    const out = await runGit(root, "check-ignore", { paths: names });
    expect(out.split("\n").filter(Boolean)).toEqual(names);
    expect(existsSync(join(root, "pwned"))).toBe(false);
  });

  it("treats glob characters as literal names, so a glob never widens the answer", async () => {
    const root = await tempRepo();
    // check-ignore rejects :(literal) and GIT_LITERAL_PATHSPECS, but it does not expand globs: each
    // argument is one path name. Real files named like globs prove it.
    for (const name of ["*.env", "[a].env", "a.env", "b.env"]) await writeFile(join(root, name), "x\n");
    await writeFile(join(root, ".gitignore"), "a.env\n");
    const out = await runGit(root, "check-ignore", { paths: ["*.env", "[a].env", "a.env", "b.env"] });
    expect(out.split("\n").filter(Boolean)).toEqual(["a.env"]);
    await writeFile(join(root, ".gitignore"), "*.env\n");
    const widened = await runGit(root, "check-ignore", { paths: ["*.env", "[a].env", "b.env", "c.txt"] });
    expect(widened.split("\n").filter(Boolean)).toEqual(["*.env", "[a].env", "b.env"]);
  });

  it("rejects a path outside the root", async () => {
    const root = await tempRepo();
    await expect(runGit(root, "check-ignore", { paths: ["../x"] })).rejects.toBeInstanceOf(UsageError);
  });
});

describe("paths that exist only in history", () => {
  it("log and blame accept a file deleted in a later commit", async () => {
    const root = await tempRepo();
    await writeFile(join(root, "gone.txt"), "x\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "add gone");
    git(root, "rm", "-q", "gone.txt");
    git(root, "commit", "-q", "-m", "remove gone");
    const out = await runGit(root, "log", { args: ["--format=%s"], paths: ["gone.txt"] });
    expect(out.trim().split("\n")).toEqual(["remove gone", "add gone"]);
    await expect(
      runGit(root, "blame", { refs: ["HEAD~1"], paths: ["gone.txt"] }),
    ).resolves.toContain("x");
  });

  it("still rejects a missing path under a symlinked directory that leads outside", async () => {
    const root = await tempRepo();
    await symlink(await tempDir(), join(root, "link"));
    await expect(runGit(root, "log", { paths: ["link/gone.txt"] })).rejects.toBeInstanceOf(UsageError);
  });
});

describe("limits and failures", () => {
  it("fails with ContextTooLongError when output passes the cap, not silent truncation", async () => {
    const root = await tempRepo();
    await expect(
      runGit(root, "log", { args: ["--format=%s%n%s%n%s"], maxOutputBytes: 5 }),
    ).rejects.toThrow(/git log output is larger than the 5-byte limit.*not a file.*commits/);
  });

  it("kills git that runs past the timeout", async () => {
    const root = await tempRepo();
    const fake = await tempDir("learn-slowgit-");
    // `exec` makes the sleep the process itself, so killing it closes the output pipe at once.
    await writeFile(join(fake, "git"), "#!/bin/sh\nexec sleep 30\n");
    await chmod(join(fake, "git"), 0o755);
    const saved = process.env.PATH;
    process.env.PATH = `${fake}:${saved}`;
    const started = Date.now();
    try {
      await expect(runGit(root, "log", { timeoutMs: 200 })).rejects.toThrow(/git log timed out/);
    } finally {
      process.env.PATH = saved;
    }
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("maps git's dubious-ownership refusal to a typed error that does not suggest a bypass flag", async () => {
    const root = await tempRepo();
    const fake = await tempDir("learn-fakegit-");
    await writeFile(
      join(fake, "git"),
      "#!/bin/sh\necho \"fatal: detected dubious ownership in repository at 'x'\" >&2\nexit 128\n",
    );
    await chmod(join(fake, "git"), 0o755);
    const saved = process.env.PATH;
    process.env.PATH = fake;
    try {
      await expect(findRepo(root)).rejects.toBeInstanceOf(UntrustedRepoError);
      await expect(runGit(root, "log")).rejects.toBeInstanceOf(UntrustedRepoError);
    } finally {
      process.env.PATH = saved;
    }
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

  it("does not mistake a missing git for no repo", async () => {
    const saved = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(findRepo(await tempDir())).rejects.toBeInstanceOf(UnexpectedError);
    } finally {
      process.env.PATH = saved;
    }
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
