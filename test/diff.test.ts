import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCommandLine } from "../src/cli/command-line.js";
import { ContextTooLongError, FileRefusedError, SessionTooLongError, UsageError } from "../src/core/errors.js";
import { type ExplainEvent, type LanguageModel, Session, explain, followUp, formatContextReport, prepareRequest, readTextFile } from "../src/core/index.js";

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

  describe("limiting to paths (--diff -- path)", () => {
    it("limits the diff to the named files and directories", async () => {
      const dir = await repo();
      await mkdir(join(dir, "sub"));
      await writeFile(join(dir, "sub", "in.ts"), "inside\n");
      await writeFile(join(dir, "a.ts"), "export const a = 2;\n");
      await writeFile(join(dir, "b.ts"), "export const b = 2;\n");
      const one = await diffOf(dir, undefined, { diff: { paths: ["a.ts"] } });
      expect(one.report).toMatchObject({ files: ["a.ts"], limitedTo: ["a.ts"] });
      expect(one.request.user).not.toContain("export const b");
      expect(one.request.user).toContain("limited to a.ts");
      const many = await diffOf(dir, undefined, { diff: { paths: ["sub", "b.ts"] } });
      expect(many.report).toMatchObject({ files: ["b.ts", "sub/in.ts"] });
    });

    it("reads paths relative to the current directory", async () => {
      const dir = await repo();
      await mkdir(join(dir, "sub"));
      await writeFile(join(dir, "sub", "in.ts"), "inside\n");
      await writeFile(join(dir, "a.ts"), "export const a = 2;\n");
      const { report } = await diffOf(join(dir, "sub"), undefined, { diff: { paths: ["in.ts"] } });
      expect(report).toMatchObject({ files: ["sub/in.ts"] });
    });

    it("still excludes a secret renamed to an innocent name when only the new name is asked for", async () => {
      const dir = await repo();
      await writeFile(join(dir, ".env"), "TOKEN=old\n");
      git(dir, "add", "-f", ".env");
      git(dir, "commit", "-qm", "env");
      git(dir, "mv", ".env", "plain.txt");
      await expect(diffOf(dir, undefined, { diff: { paths: ["plain.txt"] } })).rejects.toThrow(/plain\.txt \(rule: \.env\)/);
    });

    it("says so when the paths hold no change, and rejects a path outside the repository", async () => {
      const dir = await repo();
      await writeFile(join(dir, "a.ts"), "export const a = 2;\n");
      await expect(diffOf(dir, undefined, { diff: { paths: ["b.ts"] } })).rejects.toThrow(/no changes to explain: b\.ts matches HEAD/);
      await expect(diffOf(dir, undefined, { diff: { paths: ["../elsewhere"] } })).rejects.toThrow(/outside the repository/);
    });

    it("explains in the error that a path given as the ref needs --", async () => {
      const dir = await repo();
      await writeFile(join(dir, "a.ts"), "export const a = 2;\n");
      await expect(diffOf(dir, "a.ts")).rejects.toThrow('"a.ts" is not a commit; to limit the diff to it, use --diff -- a.ts');
    });

    it("parses the command line: words after -- are paths, a word before is still a conflicting reference", () => {
      expect(parseCommandLine(["--diff", "--", "src/a.ts", "b"])).toMatchObject({ kind: "run", reference: undefined, flags: { diff: true, diffPaths: ["src/a.ts", "b"] } });
      expect(parseCommandLine(["--diff", "v1", "--", "src/a.ts"])).toMatchObject({ reference: undefined, flags: { diff: "v1", diffPaths: ["src/a.ts"] } });
      expect(parseCommandLine(["x.ts", "--diff", "--", "src/a.ts"])).toMatchObject({ reference: "x.ts", flags: { diffPaths: ["src/a.ts"] } });
      expect(parseCommandLine(["--diff"])).toMatchObject({ reference: undefined, flags: { diff: true } });
      expect(parseCommandLine(["--", "file.ts"])).toMatchObject({ reference: "file.ts" });
    });
  });

  it("notes in the report that a ref other than HEAD can hold secrets that were later removed", async () => {
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "const key = 'CANARY';\n");
    git(dir, "commit", "-qam", "adds key");
    await writeFile(join(dir, "a.ts"), "const key = process.env.KEY;\n");
    git(dir, "commit", "-qam", "removes key");
    const old = await diffOf(dir, "HEAD~2");
    expect(formatContextReport(old.report)).toMatch(/can include content that was later removed, such as a secret; the sensitive-file rules go by file name, not content/);
    await writeFile(join(dir, "a.ts"), "changed\n");
    expect(formatContextReport((await diffOf(dir)).report)).not.toMatch(/later removed/);
    expect(formatContextReport((await diffOf(dir, "HEAD")).report)).not.toMatch(/later removed/);
  });

  describe("files that cannot be shown as text, and hostile names", () => {
    it("shows a changed tracked binary as a binary-file note, not bytes", async () => {
      const dir = await repo();
      await writeFile(join(dir, "img.bin"), Buffer.from([0, 1, 2, 3]));
      git(dir, "add", "img.bin");
      git(dir, "commit", "-qm", "bin");
      await writeFile(join(dir, "img.bin"), Buffer.from([0, 9, 9, 9, 255, 254]));
      const { request } = await diffOf(dir);
      expect(request.user).toMatch(/Binary files a\/img\.bin and b\/img\.bin differ/);
      expect(request.user).not.toContain("\0");
    });

    it("skips a huge untracked file with a reason, and refuses a huge tracked change as too long", async () => {
      const dir = await repo();
      await writeFile(join(dir, "huge.txt"), "x".repeat(2 * 1024 * 1024));
      await writeFile(join(dir, "small.ts"), "const s = 1;\n");
      expect((await diffOf(dir)).report).toMatchObject({ files: ["small.ts"], skipped: [{ file: "huge.txt", why: expect.stringContaining("too large") }] });
      await writeFile(join(dir, "a.ts"), "y".repeat(2 * 1024 * 1024) + "\n");
      await expect(diffOf(dir)).rejects.toBeInstanceOf(ContextTooLongError);
    });

    it("passes a file named like a git option as a name, never as an option", async () => {
      const dir = await repo();
      const hostile = ["--output=pwned", "-p", "--help"];
      for (const name of hostile) {
        await writeFile(join(dir, name), `base ${name}\n`);
      }
      git(dir, "add", "--", ...hostile);
      git(dir, "commit", "-qm", "hostile");
      for (const name of hostile) await writeFile(join(dir, name), `changed ${name}\n`);
      await writeFile(join(dir, "--new"), "fresh\n");
      for (const paths of [undefined, ["--output=pwned"]]) {
        const { request, report } = await diffOf(dir, undefined, paths ? { diff: { paths } } : {});
        expect(request.user).toContain("+changed --output=pwned");
        expect(paths ? report : (report as { files: string[] }).files.length).toBeTruthy();
      }
      const all = await diffOf(dir);
      expect(all.report).toMatchObject({ files: ["--help", "--output=pwned", "-p", "--new"] });
      expect(all.request.user).toContain("+fresh");
      await expect(readTextFile(join(dir, "pwned"))).rejects.toThrow();
    });
  });

  describe("untracked files are opened once, without following a link", () => {
    it("refuses a link at the end of the path instead of reading what it points at", async () => {
      const dir = await repo();
      await writeFile(join(dir, "target.txt"), "TARGET\n");
      await symlink(join(dir, "target.txt"), join(dir, "link.txt"));
      await expect(readTextFile(join(dir, "link.txt"), undefined, true)).rejects.toBeInstanceOf(FileRefusedError);
      await expect(readTextFile(join(dir, "link.txt"))).resolves.toBe("TARGET\n");
      await expect(readTextFile(join(dir, "target.txt"), undefined, true)).resolves.toBe("TARGET\n");
    });
  });

  describe("with a Session (--chat)", () => {
    const model = (reply = "ANSWER"): LanguageModel => ({ async *stream() { yield reply; } });
    const drain = async (events: AsyncIterable<ExplainEvent>) => {
      const out: ExplainEvent[] = [];
      for await (const e of events) out.push(e);
      return out;
    };

    it("keeps the diff pinned in every follow-up, and drops only follow-up turns", async () => {
      const dir = await repo();
      await writeFile(join(dir, "a.ts"), "export const a = 'PINNED_DIFF_MARKER';\n");
      const first = await diffOf(dir);
      const session = new Session(first.request.user.length + 150);
      const events = await drain(explain({ diff: {}, settings, cwd: dir, session, model: model(), signal: new AbortController().signal }));
      expect(events.at(-1)).toEqual({ type: "done" });
      const requests: string[] = [];
      for (const q of ["first question here", "second question here", "third question here"]) {
        const out = await drain(followUp({ session, question: q, model: model("A".repeat(60)), signal: new AbortController().signal, onRequest: (r) => requests.push(JSON.stringify(r.history)) }));
        expect(out.at(-1)).toEqual({ type: "done" });
      }
      // The cap forced older follow-ups out, but the diff is in the history of every request.
      expect(requests.every((h) => h.includes("PINNED_DIFF_MARKER"))).toBe(true);
      expect(session.turns[0]!.user).toContain("PINNED_DIFF_MARKER");
      expect(session.turns.length).toBeLessThan(4);
    });

    it("refuses before sending when the diff alone does not fit the Session cap", async () => {
      const dir = await repo();
      await writeFile(join(dir, "a.ts"), "z".repeat(3000) + "\n");
      const events = await drain(explain({ diff: {}, settings, cwd: dir, session: new Session(500), model: model(), signal: new AbortController().signal }));
      expect(events.find((e) => e.type === "error")).toMatchObject({ error: expect.any(SessionTooLongError) });
      expect(events.some((e) => e.type === "text-delta")).toBe(false);
    });
  });
});
