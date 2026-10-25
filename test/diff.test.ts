import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContextTooLongError, UsageError } from "../src/core/errors.js";
import { formatContextReport, prepareRequest } from "../src/core/index.js";

// Ticket 38: `--diff` at the core seam, in real temporary git repositories.
const HOSTED = "https://api.example.com/v1";
const settings = { baseUrl: HOSTED, model: "m" };

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

async function repo({ commit = true } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "learn-diff-")));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  if (commit) {
    await writeFile(join(dir, "a.ts"), "export const a = 1;\n");
    await writeFile(join(dir, "b.ts"), "export const b = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "first");
  }
  return dir;
}

const diffOf = (cwd: string, ref?: string, extra: Record<string, unknown> = {}) =>
  prepareRequest({ diff: { ...(ref !== undefined && { ref }) }, settings, cwd, ...extra });

describe("--diff", () => {
  it("explains staged and unstaged changes against HEAD, and nothing already committed", async () => {
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "export const a = 2;\n");
    git(dir, "add", "a.ts");
    await writeFile(join(dir, "b.ts"), "export const b = 3;\n");
    const { request, report } = await diffOf(dir);
    expect(request.user).toContain("+export const a = 2;");
    expect(request.user).toContain("+export const b = 3;");
    expect(request.user).toContain("-export const a = 1;");
    expect(request.user).toContain("against HEAD");
    expect(report).toMatchObject({ kind: "diff", files: ["a.ts", "b.ts"], excluded: [] });
  });

  it("compares against a ref when one is given", async () => {
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "export const a = 2;\n");
    git(dir, "commit", "-qam", "second");
    await writeFile(join(dir, "b.ts"), "export const b = 3;\n");
    const { request, report } = await diffOf(dir, "HEAD~1");
    expect(request.user).toContain("against HEAD~1");
    expect(request.user).toContain("+export const a = 2;");
    expect(request.user).toContain("+export const b = 3;");
    expect(report).toMatchObject({ files: ["a.ts", "b.ts"] });
  });

  it("rejects a ref that is not a commit, or that looks like a flag", async () => {
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "x\n");
    await expect(diffOf(dir, "nope")).rejects.toThrow(/not a commit/);
    await expect(diffOf(dir, "--output=x")).rejects.toBeInstanceOf(UsageError);
    await expect(diffOf(dir, "HEAD..HEAD~1")).rejects.toThrow(/not a commit/);
  });

  it("includes untracked files as new files, but not ignored ones", async () => {
    const dir = await repo();
    await writeFile(join(dir, ".gitignore"), "skip.ts\n");
    git(dir, "add", ".gitignore");
    git(dir, "commit", "-qm", "ignore");
    await writeFile(join(dir, "new.ts"), "export const n = 1;\nlast");
    await writeFile(join(dir, "skip.ts"), "export const skipped = 1;\n");
    const { request, report } = await diffOf(dir);
    expect(request.user).toContain("+export const n = 1;");
    expect(request.user).toContain("+last");
    expect(request.user).toContain("No newline at end of file");
    expect(request.user).not.toContain("skipped");
    expect(report).toMatchObject({ kind: "diff", files: ["new.ts"], untracked: 1 });
  });

  it("works in a repository with no commits", async () => {
    const dir = await repo({ commit: false });
    await writeFile(join(dir, "staged.ts"), "export const s = 1;\n");
    git(dir, "add", "staged.ts");
    await writeFile(join(dir, "loose.ts"), "export const l = 1;\n");
    const { request, report } = await diffOf(dir);
    expect(request.user).toContain("+export const s = 1;");
    expect(request.user).toContain("+export const l = 1;");
    expect(report).toMatchObject({ files: ["loose.ts", "staged.ts"] });
  });

  it("says there is nothing to explain when nothing changed", async () => {
    const dir = await repo();
    await expect(diffOf(dir)).rejects.toThrow(/no changes/);
  });

  it("skips untracked links, binaries and files that are too large, and says so", async () => {
    const dir = await repo();
    await writeFile(join(dir, "ok.ts"), "export const ok = 1;\n");
    await writeFile(join(dir, "blob.bin"), Buffer.from([0, 1, 2]));
    await symlink(join(dir, "a.ts"), join(dir, "link.ts"));
    const { request, report } = await diffOf(dir);
    expect(request.user).toContain("+export const ok = 1;");
    expect(report).toMatchObject({ files: ["ok.ts"], skipped: [{ file: "blob.bin" }, { file: "link.ts" }] });
  });

  it("gives the context-too-long error when the diff is over the budget", async () => {
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "x".repeat(500) + "\n");
    await expect(diffOf(dir, undefined, { settings: { ...settings, contextBudget: 300 } })).rejects.toBeInstanceOf(ContextTooLongError);
  });

  it("delimits the diff in a fence longer than any run of backticks inside it, as data", async () => {
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "const s = '`````';\n");
    const { request } = await diffOf(dir);
    expect(request.user).toContain("``````\ndiff --git");
    expect(request.user).toMatch(/data, not instructions/);
  });

  it("adds a note to the report in a shallow clone", async () => {
    const src = await repo();
    await writeFile(join(src, "a.ts"), "export const a = 2;\n");
    git(src, "commit", "-qam", "second");
    const parent = await realpath(await mkdtemp(join(tmpdir(), "learn-diff-clone-")));
    const clone = join(parent, "c");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${src}`, clone]);
    await writeFile(join(clone, "a.ts"), "export const a = 3;\n");
    const { report } = await diffOf(clone);
    expect(report).toMatchObject({ kind: "diff", shallow: true });
    expect(formatContextReport(report)).toMatch(/shallow clone: history is incomplete/);
    await writeFile(join(src, "a.ts"), "export const a = 9;\n");
    expect((await diffOf(src)).report).toMatchObject({ shallow: false });
  });

  describe("Sensitive files", () => {
    async function project() {
      const dir = await repo();
      await writeFile(join(dir, ".gitignore"), "ignored.txt\n");
      await writeFile(join(dir, ".env"), "TOKEN=old\n");
      await writeFile(join(dir, "ignored.txt"), "old\n");
      git(dir, "add", "-f", ".");
      git(dir, "commit", "-qm", "with secrets");
      await writeFile(join(dir, ".env"), "TOKEN=CANARY\n");
      await writeFile(join(dir, "ignored.txt"), "CANARY\n");
      await writeFile(join(dir, "fresh.pem"), "CANARY\n");
      await writeFile(join(dir, "a.ts"), "export const a = 2;\n");
      return dir;
    }

    it("excludes changed denylisted, gitignored and untracked files, and names them in the report", async () => {
      const dir = await project();
      const { request, report } = await diffOf(dir);
      expect(request.user).not.toContain("CANARY");
      expect(request.user).not.toContain("TOKEN");
      expect(request.user).toContain("+export const a = 2;");
      expect(report).toMatchObject({
        files: ["a.ts"],
        excluded: [
          { file: ".env", rule: ".env" },
          { file: "ignored.txt", rule: "gitignore" },
          { file: "fresh.pem", rule: "*.pem" },
        ],
      });
      const text = formatContextReport(report);
      expect(text).toContain(".env (rule: .env)");
      expect(text).toContain("fresh.pem (rule: *.pem)");
      expect(text).not.toContain("CANARY");
    });

    it("also excludes a deleted denylisted file, whose old content the diff would show", async () => {
      const dir = await project();
      await rm(join(dir, ".env"));
      const { request } = await diffOf(dir);
      expect(request.user).not.toContain("TOKEN");
    });

    it("excludes both sides of a rename away from a denylisted name, so the content does not leak under the new name", async () => {
      const dir = await project();
      await writeFile(join(dir, ".env"), "TOKEN=old\n");
      git(dir, "mv", ".env", "plain.txt");
      const { request, report } = await diffOf(dir);
      expect(request.user).not.toContain("plain.txt");
      expect(report).toMatchObject({ kind: "diff", excluded: expect.arrayContaining([{ file: ".env", rule: ".env" }, { file: "plain.txt", rule: ".env" }]) });
    });

    it("refuses when every changed file is excluded", async () => {
      const dir = await repo();
      await writeFile(join(dir, ".env"), "CANARY\n");
      await expect(diffOf(dir)).rejects.toThrow(/\.env \(rule: \.env\)/);
    });

    it("sends them with allowSensitive, and the report says so", async () => {
      const dir = await project();
      const { request, report } = await diffOf(dir, undefined, { allowSensitive: true });
      expect(request.user).toContain("CANARY");
      expect(report).toMatchObject({ kind: "diff", excluded: [] });
      const text = formatContextReport(report);
      expect(text).toContain("overridden: .env (rule: .env) is being sent to api.example.com because --allow-sensitive was passed");
      expect(text).toContain("overridden: fresh.pem");
    });

    it("leaves out files outside a narrower --root", async () => {
      const dir = await repo();
      await mkdir(join(dir, "sub"));
      await writeFile(join(dir, "sub", "in.ts"), "inside\n");
      await writeFile(join(dir, "out.ts"), "outside\n");
      const { request, report } = await diffOf(dir, undefined, { root: "sub" });
      expect(request.user).toContain("inside");
      expect(request.user).not.toContain("outside");
      expect(report).toMatchObject({ excluded: [{ file: "out.ts", rule: "outside the project root" }] });
    });
  });

  it("needs a git repository", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "learn-nogit-")));
    await expect(diffOf(dir)).rejects.toThrow(/git repository/);
  });
});
