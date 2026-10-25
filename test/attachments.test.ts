import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { attachReferences, followUp, Session } from "../src/core/index.js";

const CANARY = "CANARY-9f3a-never-leave";
const settings = { baseUrl: "http://h/v1", model: "m" };
let dir: string;
const attach = (question: string, extra: Record<string, unknown> = {}) => attachReferences({ question, settings, cwd: dir, root: dir, ...extra });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "learn-attach-"));
  await writeFile(join(dir, "a.ts"), Array.from({ length: 30 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n") + "\n");
  await writeFile(join(dir, "my file.ts"), "export const spaced = true;\n");
  await writeFile(join(dir, "Makefile"), "all:\n\techo hi\n");
  await writeFile(join(dir, "big.ts"), "x".repeat(20_000));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  await mkdir(join(dir, "sub"));
  for (const n of ["p", "q", "r"]) await writeFile(join(dir, `${n}.ts`), `// ${n}\n${"y".repeat(5_000)}`);
  await writeFile(join(dir, "ignored.txt"), `${CANARY}\n`);
  await writeFile(join(dir, ".gitignore"), "ignored.txt\n");
  await writeFile(join(dir, ".env"), `TOKEN=${CANARY}\n`);
});

describe("attachReferences", () => {
  it("leaves a question with no reference exactly as typed", async () => {
    expect(await attach("why is this async?")).toEqual({ content: "why is this async?", reports: [], notes: [] });
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
      expect(await attach(q)).toEqual({ content: q, reports: [], notes: [] });
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

  it("limits the code attached to one message as a whole, naming the file that pushed it over", async () => {
    // Each of p, q and r is 5,000 characters, well inside the limit alone; the hosted limit for a message is 12,000.
    const { content } = await attach("@p.ts @q.ts");
    expect(content).toContain("File: q.ts");
    await expect(attach("@p.ts @q.ts @r.ts")).rejects.toMatchObject({ name: "ContextTooLongError", message: expect.stringContaining("@r.ts brings the code attached to this message") });
  });

  it("attaches a file mentioned twice once, and says so", async () => {
    const { content, reports, notes } = await attach("@a.ts:1-2 then @a.ts:1-2 again");
    expect(reports).toHaveLength(1);
    expect(content.match(/File: a\.ts:1-2/g)).toHaveLength(1);
    expect(notes).toEqual(["@a.ts:1-2 was mentioned more than once and is attached once"]);
  });
});

describe("two references to one file", () => {
  it("attaches different ranges of it separately, and notes only an identical reference", async () => {
    const { content, reports, notes } = await attach("@a.ts:1-2 and @a.ts:20-22, and @a.ts:1-2 again, and the whole @a.ts");
    expect(reports.map((r) => (r.kind === "sent" ? r.label : ""))).toEqual(["a.ts:1-2", "a.ts:20-22", "a.ts"]);
    expect(content).toContain("const line21 = 21;");
    expect(notes).toEqual(["@a.ts:1-2 was mentioned more than once and is attached once"]);
  });
});

describe("attached code and the interim Session cap", () => {
  it("counts toward the cap, so attaching cannot get around it", async () => {
    const session = new Session(400);
    session.begin({ baseUrl: "http://h/v1", model: "m", system: "s", user: "first" }, "answer");
    const never: import("../src/core/index.js").LanguageModel = { async *stream() { throw new Error("must not be called"); } };
    const typed = await attach("what is this?");
    const attached = await attach("what is @a.ts:1-30?");
    const run = async (question: string) => {
      const events = [];
      for await (const e of followUp({ session, question, model: never, signal: new AbortController().signal })) events.push(e);
      return events;
    };
    // The question alone fits; the same question with 30 attached lines does not.
    expect(attached.content.length).toBeGreaterThan(400);
    expect(typed.content.length).toBeLessThan(100);
    expect((await run(attached.content))[0]).toMatchObject({ type: "error", error: { name: "ContextTooLongError" } });
  });
});

describe("a secret in an attached file", () => {
  it("is refused on a hosted endpoint, and the refusal never carries the secret", async () => {
    for (const q of ["@.env", "@ignored.txt", "@.env:1"]) {
      const err = await attach(q).then(() => undefined, (e: Error) => e);
      expect(err).toMatchObject({ name: "BlockedFileError" });
      expect(`${err?.message}`).not.toContain(CANARY);
    }
    // A harmless file mentioned beside it does not get the message through.
    await expect(attach("@a.ts and @.env")).rejects.toMatchObject({ name: "BlockedFileError" });
  });

  it("is sent only with --allow-sensitive, and the report says which rule and where", async () => {
    const { content, reports } = await attach("@.env", { allowSensitive: true });
    expect(content).toContain(CANARY);
    expect(reports[0]).toMatchObject({ kind: "sent", overrides: [{ file: ".env", by: "flag", host: "h" }] });
  });
});
