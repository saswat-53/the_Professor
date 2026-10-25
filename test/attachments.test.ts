import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { attachReferences } from "../src/core/index.js";

const settings = { baseUrl: "http://h/v1", model: "m" };
let dir: string;
const attach = (question: string, extra: Record<string, unknown> = {}) => attachReferences({ question, settings, cwd: dir, root: dir, ...extra });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "learn-attach-"));
  await writeFile(join(dir, "a.ts"), Array.from({ length: 30 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n") + "\n");
  await writeFile(join(dir, "my file.ts"), "export const spaced = true;\n");
  await writeFile(join(dir, "Makefile"), "all:\n\techo hi\n");
  await writeFile(join(dir, ".env"), "SECRET=abc\n");
  await writeFile(join(dir, "big.ts"), "x".repeat(20_000));
  await mkdir(join(dir, "sub"));
});

describe("attachReferences", () => {
  it("leaves a question with no reference exactly as typed", async () => {
    expect(await attach("why is this async?")).toEqual({ content: "why is this async?", reports: [] });
  });

  it("attaches a whole file, keeps the question text, and reports it", async () => {
    const { content, reports } = await attach("what does @a.ts do?");
    expect(content).toContain("what does @a.ts do?");
    expect(content).toContain("File: a.ts");
    expect(content).toContain("const line30 = 30;");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: "sent", label: "a.ts" });
  });

  it("attaches a line range with its Context, and reports the lines", async () => {
    const { content, reports } = await attach("explain @a.ts:10-12");
    expect(content).toContain("File: a.ts:10-12");
    expect(reports[0]).toMatchObject({ kind: "sent", path: "a.ts", ranges: expect.arrayContaining([{ part: "excerpt", start: 10, end: 12 }]) });
  });

  it("does not take an email address, a decorator or a mid-word @ for a reference", async () => {
    for (const q of ["mail me@example.com", "what is @Injectable for?", "see @app.route(\"/x\") here", "x@a.ts is odd"]) {
      expect(await attach(q)).toEqual({ content: q, reports: [] });
    }
  });

  it("takes an extensionless file that exists, and ignores trailing punctuation", async () => {
    const { content } = await attach("and @Makefile, then @a.ts:1-2?");
    expect(content).toContain("File: Makefile");
    expect(content).toContain("File: a.ts:1-2");
  });

  it("supports quotes and backslash escapes for paths with spaces", async () => {
    for (const q of ['look at @"my file.ts"', "look at @my\\ file.ts"]) {
      expect((await attach(q)).content).toContain("File: my file.ts");
    }
    expect((await attach('look at @"my file.ts":1')).content).toContain("File: my file.ts:1");
  });

  it("refuses a missing file, naming it", async () => {
    await expect(attach("what is @nope.ts?")).rejects.toMatchObject({ name: "FileNotFoundError", message: expect.stringContaining("nope.ts") });
    await expect(attach("what is @src/nope")).rejects.toMatchObject({ name: "FileNotFoundError" });
  });

  it("refuses a Sensitive file and a file outside the root", async () => {
    await expect(attach("read @.env")).rejects.toMatchObject({ name: "BlockedFileError" });
    await expect(attach("read @../outside.ts")).rejects.toBeInstanceOf(Error);
  });

  it("refuses a bad range", async () => {
    await expect(attach("see @a.ts:0")).rejects.toMatchObject({ name: "UsageError" });
    await expect(attach("see @a.ts:99")).rejects.toMatchObject({ name: "UsageError" });
  });

  it("asks for a range when a whole file is over the Excerpt limit", async () => {
    await expect(attach("see @big.ts")).rejects.toMatchObject({ name: "ContextTooLongError", message: expect.stringContaining("@big.ts:") });
  });

  it("sends nothing when any one of several references fails", async () => {
    await expect(attach("@a.ts and @nope.ts")).rejects.toBeInstanceOf(Error);
  });

  it("attaches several files, one report each", async () => {
    const { reports } = await attach("compare @a.ts:1-2 with @\"my file.ts\"");
    expect(reports.map((r) => (r.kind === "sent" ? r.label : ""))).toEqual(["a.ts:1-2", "my file.ts"]);
  });
});
