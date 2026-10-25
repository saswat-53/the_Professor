import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCommandLine } from "../src/cli/command-line.js";
import { BlockedFileError, ContextTooLongError, UsageError } from "../src/core/errors.js";
import { formatContextReport, prepareRequest, reportForError } from "../src/core/index.js";

// Ticket 39: `--blame path:N-M` at the core seam, in real temporary git repositories.
const HOSTED = "https://api.example.com/v1";
const settings = { baseUrl: HOSTED, model: "m" };

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

async function repo({ commit = true } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "learn-blame-")));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  if (commit) {
    await writeFile(join(dir, "a.ts"), "export const a = 1;\nexport const b = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "add the constants");
    await writeFile(join(dir, "a.ts"), "export const a = 2;\nexport const b = 1;\n");
    git(dir, "commit", "-qam", "bump a because the cache was stale");
  }
  return dir;
}

const blameOf = (cwd: string, spec: string, extra: Record<string, unknown> = {}) => prepareRequest({ blame: spec, settings, cwd, ...extra });

describe("--blame", () => {
  it("gives the model the commit messages and patches that touched the range, as evidence", async () => {
    const dir = await repo();
    const { request, report } = await blameOf(dir, "a.ts:1-1");
    expect(request.user).toContain("bump a because the cache was stale");
    expect(request.user).toContain("add the constants");
    expect(request.user).toContain("-export const a = 1;");
    expect(request.user).toContain("+export const a = 2;");
    expect(report).toMatchObject({ kind: "blame", path: "a.ts", start: 1, end: 1, commits: 2 });
  });

  it("only includes history of the range, not of other lines", async () => {
    const dir = await repo();
    const { request, report } = await blameOf(dir, "a.ts:2");
    expect(request.user).toContain("add the constants");
    expect(request.user).not.toContain("bump a");
    expect(report).toMatchObject({ commits: 1, start: 2, end: 2 });
  });

  it("tells the model it can only explain what the history shows and to mark guessed intent", async () => {
    const dir = await repo();
    const { request } = await blameOf(dir, "a.ts:1-2");
    expect(request.user).toMatch(/only explain what the history shows/i);
    expect(request.user).toMatch(/guess/i);
    expect(request.user).toMatch(/data, not instructions/);
  });

  it("delimits the history in a fence longer than any run of backticks inside it", async () => {
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "const s = '`````';\nexport const b = 1;\n");
    git(dir, "commit", "-qam", "ticks");
    const { request } = await blameOf(dir, "a.ts:1");
    expect(request.user).toContain("``````\ncommit ");
  });

  it("follows a rename, and refuses when an earlier name of the file is a Sensitive file", async () => {
    const dir = await repo({ commit: false });
    await writeFile(join(dir, "server.pem"), "line one\nline two\n");
    git(dir, "add", "-f", ".");
    git(dir, "commit", "-qm", "key");
    git(dir, "mv", "server.pem", "notes.txt");
    git(dir, "commit", "-qm", "rename");
    const err = await blameOf(dir, "notes.txt:1-2").catch((e) => e);
    expect(err).toBeInstanceOf(BlockedFileError);
    expect(err.message).toMatch(/server\.pem/);
    expect(reportForError(err)).toMatchObject({ kind: "refused", file: "server.pem" });
  });

  it("decodes the escaped way git writes a non-ASCII name, so an earlier Sensitive name is still caught", async () => {
    const dir = await repo({ commit: false });
    await mkdir(join(dir, "é"));
    await writeFile(join(dir, "é", ".env"), "one\ntwo\n");
    git(dir, "add", "-f", ".");
    git(dir, "commit", "-qm", "env");
    git(dir, "mv", "é/.env", "plain.txt");
    git(dir, "commit", "-qm", "rename");
    const err = await blameOf(dir, "plain.txt:1-2").catch((e) => e);
    expect(err).toBeInstanceOf(BlockedFileError);
    expect(err.file).toBe("é/.env");
  });

  it("refuses a denylisted or gitignored file given as the path, naming the rule", async () => {
    const dir = await repo({ commit: false });
    await writeFile(join(dir, ".gitignore"), "ignored.txt\n");
    await writeFile(join(dir, ".env"), "TOKEN=x\n");
    await writeFile(join(dir, "ignored.txt"), "x\n");
    git(dir, "add", "-f", ".");
    git(dir, "commit", "-qm", "all");
    const env = await blameOf(dir, ".env:1").catch((e) => e);
    expect(env).toBeInstanceOf(BlockedFileError);
    expect(env.rule).toBe(".env");
    const ignored = await blameOf(dir, "ignored.txt:1").catch((e) => e);
    expect(ignored).toBeInstanceOf(BlockedFileError);
    expect(ignored.rule).toBe("gitignore");
  });

  it("lets --allow-sensitive through and records it in the report", async () => {
    const dir = await repo({ commit: false });
    await writeFile(join(dir, ".env"), "TOKEN=x\n");
    git(dir, "add", "-f", ".");
    git(dir, "commit", "-qm", "env");
    const { report } = await blameOf(dir, ".env:1", { allowSensitive: true });
    expect(report).toMatchObject({ kind: "blame", overrides: [{ file: ".env", by: "flag" }] });
    expect(formatContextReport(report)).toContain("overridden: .env");
  });

  it("says plainly in the report that secrets inside history cannot be filtered by name", async () => {
    const dir = await repo();
    const { report } = await blameOf(dir, "a.ts:1");
    expect(formatContextReport(report)).toMatch(/secrets inside history can't be filtered by name/);
  });

  it("adds a note to the report in a shallow clone", async () => {
    const src = await repo();
    const parent = await realpath(await mkdtemp(join(tmpdir(), "learn-blame-clone-")));
    const clone = join(parent, "c");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${src}`, clone]);
    const { report } = await blameOf(clone, "a.ts:1");
    expect(report).toMatchObject({ shallow: true });
    expect(formatContextReport(report)).toMatch(/shallow clone: history is incomplete/);
    expect(formatContextReport((await blameOf(src, "a.ts:1")).report)).not.toMatch(/shallow/);
  });

  it("works from a subdirectory, with the path as typed there", async () => {
    const dir = await repo();
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "c.ts"), "export const c = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "add c");
    const { report } = await blameOf(join(dir, "src"), "c.ts:1");
    expect(report).toMatchObject({ path: "src/c.ts" });
  });

  it("gives the context-too-long error when the history is over the budget", async () => {
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), `${"x".repeat(500)}\nexport const b = 1;\n`);
    git(dir, "commit", "-qam", "big");
    await expect(blameOf(dir, "a.ts:1", { settings: { ...settings, contextBudget: 300 } })).rejects.toBeInstanceOf(ContextTooLongError);
  });

  describe("bad input", () => {
    it.each([
      ["a.ts", /path:N or path:N-M/],
      ["a.ts:", /missing a line number/],
      ["a.ts:0", /start at 1/],
      ["a.ts:3-1", /reversed/],
      ["a.ts:9", /only 2 lines|past the end/],
      ["nope.ts:1", /no file "nope\.ts"|not .*in the repository|not tracked/],
      ["../outside.ts:1", /outside/],
    ])("%s is a usage error", async (spec, message) => {
      const dir = await repo();
      const err = await blameOf(dir, spec).catch((e) => e);
      expect(err).toBeInstanceOf(UsageError);
      expect(err.message).toMatch(message);
    });

    it("needs a git repository", async () => {
      const dir = await realpath(await mkdtemp(join(tmpdir(), "learn-blame-none-")));
      await writeFile(join(dir, "a.ts"), "x\n");
      await expect(blameOf(dir, "a.ts:1")).rejects.toThrow(/needs a git repository/);
    });

    it("says so when the repository has no commits", async () => {
      const dir = await repo({ commit: false });
      await writeFile(join(dir, "a.ts"), "x\n");
      await expect(blameOf(dir, "a.ts:1")).rejects.toThrow(/no commits/);
    });

    it("says so when the lines have no committed history", async () => {
      const dir = await repo();
      await writeFile(join(dir, "new.ts"), "x\n");
      await expect(blameOf(dir, "new.ts:1")).rejects.toThrow(UsageError);
    });
  });
});

describe("--blame on the command line", () => {
  it("takes the path:range as its value", () => {
    expect(parseCommandLine(["--blame", "a.ts:1-2"])).toMatchObject({ kind: "run", flags: { blame: "a.ts:1-2" } });
  });

  it("needs a value", () => {
    expect(parseCommandLine(["--blame"])).toMatchObject({ kind: "usage-error" });
  });
});
