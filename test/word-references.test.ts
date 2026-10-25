import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { attachReferences, buildRequest, defaultResolvers, formatContextReport, listSearchableFiles, prepareRequest, resolveReference, buildContextReport, UsageError, WordNotFoundError } from "../src/core/index.js";
import type { SearchList } from "../src/core/index.js";

const CANARY = "CANARY-word-never-leave";
const settings = { baseUrl: "https://api.example.com/v1", model: "m" };
const localSettings = { baseUrl: "http://localhost:11434/v1", model: "m" };
let dir: string;
const build = (reference: string, extra: Record<string, unknown> = {}) => buildRequest({ reference, settings, cwd: dir, root: dir, ...extra });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "learn-word-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  await mkdir(join(dir, "src"));
  await mkdir(join(dir, "test"));
  await mkdir(join(dir, "node_modules"));
  await writeFile(
    join(dir, "src/util.ts"),
    ["import x from 'x';", "", "// debounce is defined below", "export function debounce(fn: () => void, ms: number) {", "  let t: any;", "  return () => {", "    clearTimeout(t);", "    t = setTimeout(fn, ms);", "  };", "}", "", "export const throttled = debounce(() => {}, 5);", ""].join("\n"),
  );
  await writeFile(join(dir, "src/use.ts"), "import { debounce } from './util';\ndebounce(() => 1, 3);\nconst s = 'debounce';\n");
  await writeFile(join(dir, "test/util.test.ts"), "function debounce() { return 'test double'; }\n");
  await writeFile(join(dir, "src/arrow.ts"), "export const compose = (a: number) => {\n  return a + 1;\n};\n");
  await writeFile(join(dir, "src/model.py"), "@decorator\nclass Widget:\n    def render(self):\n        return 1\n");
  await writeFile(join(dir, "src/greeter.ts"), "class Greeter {\n  greet(name: string): string {\n    return `hi ${name}`;\n  }\n}\n");
  await writeFile(join(dir, "src/prose.md"), "function inDocsOnly() {}\n");
  await writeFile(join(dir, ".env"), `function envOnly() { return "${CANARY}"; }\n`);
  await writeFile(join(dir, "src/secret.pem"), `function pemOnly() {}\n`);
  await writeFile(join(dir, "ignored.ts"), `export function ignoredOnly() { return "${CANARY}"; }\n`);
  await writeFile(join(dir, ".gitignore"), "ignored.ts\ntracked-ignored.ts\n");
  await writeFile(join(dir, "tracked-ignored.ts"), `export function trackedIgnored() { return "${CANARY}"; }\n`);
  execFileSync("git", ["add", "-f", "tracked-ignored.ts"], { cwd: dir });
  await writeFile(join(dir, "node_modules/dep.ts"), "export function vendored() {}\n");
  const outside = await mkdtemp(join(tmpdir(), "learn-word-outside-"));
  await writeFile(join(outside, "out.ts"), `export function outsideOnly() { return "${CANARY}"; }\n`);
  await symlink(join(outside, "out.ts"), join(dir, "src/link.ts"));
  await symlink(join(dir, ".env"), join(dir, "src/envlink.ts"));
});

describe("word references", () => {
  it("finds the definition and makes its whole block the Excerpt", async () => {
    const { user } = await build("debounce");
    expect(user).toContain("File: src/util.ts:4-10");
    expect(user).toContain("export function debounce(fn");
    expect(user).toContain("t = setTimeout(fn, ms);");
  });

  it("prefers a definition to a call, an import, a comment and a string", async () => {
    expect((await build("debounce")).user).not.toContain("src/use.ts");
  });

  it("prefers a source file to a test file", async () => {
    expect((await build("debounce")).user).not.toContain("test double");
  });

  it("prefers a source file's const to a test file's function declaration", async () => {
    await writeFile(join(dir, "src/rank.ts"), "export const rankMe = () => 1;\n");
    await writeFile(join(dir, "test/rank.test.ts"), "function rankMe() { return 2; }\n");
    expect((await build("rankMe")).user).toContain("File: src/rank.ts");
  });

  it("falls back to a test file when it holds the only definition", async () => {
    await writeFile(join(dir, "test/only.test.ts"), "function onlyInTests() { return 1; }\n");
    expect((await build("onlyInTests")).user).toContain("File: test/only.test.ts");
  });

  it("finds a const arrow function, a method and a Python class", async () => {
    expect((await build("compose")).user).toContain("File: src/arrow.ts:1-3");
    expect((await build("greet")).user).toContain("File: src/greeter.ts:2-4");
    expect((await build("Widget")).user).toContain("File: src/model.py:1-4");
  });

  it("says so when nothing is found, and counts what it searched", async () => {
    const err = await build("nothingByThisName").catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.exitCode).toBe(2);
    expect(err.message).toContain('no definition of "nothingByThisName" found');
    expect(err.message).toMatch(/searched \d+ files/);
  });

  it("rejects a word that is not an identifier", async () => {
    const err = await build("a*b").catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("not an identifier");
  });

  it("does not search documents, ignored files, vendored code or Sensitive files", async () => {
    for (const word of ["inDocsOnly", "envOnly", "pemOnly", "ignoredOnly", "trackedIgnored", "vendored"]) {
      const err = await build(word).catch((e) => e);
      expect(err, word).toBeInstanceOf(UsageError);
      expect(err.message, word).toContain("no definition");
    }
  });

  it("does not search Sensitive files even when the check is skipped (local endpoint, --allow-sensitive)", async () => {
    for (const extra of [{ settings: localSettings }, { allowSensitive: true }]) {
      for (const word of ["envOnly", "ignoredOnly", "trackedIgnored"]) {
        const err = await build(word, extra).catch((e) => e);
        expect(err.message, word).toContain("no definition");
      }
    }
  });

  it("does not follow a symlink out of the project root or to a Sensitive file", async () => {
    for (const word of ["outsideOnly", "envOnly"]) {
      const err = await build(word, { settings: localSettings }).catch((e) => e);
      expect(err.message, word).toContain("no definition");
    }
  });

  it("keeps the canary out of every request and error", async () => {
    for (const word of ["envOnly", "ignoredOnly", "trackedIgnored", "outsideOnly"]) {
      const out = await build(word).then((r) => JSON.stringify(r), (e) => e.message);
      expect(out).not.toContain(CANARY);
    }
  });

  it("searches without git too, still skipping the denylist", async () => {
    const plain = await mkdtemp(join(tmpdir(), "learn-word-plain-"));
    await writeFile(join(plain, "a.js"), "function plainFn() {}\n");
    await writeFile(join(plain, ".env"), "function plainSecret() {}\n");
    await mkdir(join(plain, "node_modules"));
    await writeFile(join(plain, "node_modules/b.js"), "function plainVendored() {}\n");
    const run = (word: string) => buildRequest({ reference: word, settings, cwd: plain, root: plain });
    expect((await run("plainFn")).user).toContain("File: a.js");
    for (const word of ["plainSecret", "plainVendored"]) expect((await run(word).catch((e) => e)).message).toContain("no definition");
  });

  it("a file with the word's name wins over a search", async () => {
    await writeFile(join(dir, "Makefile"), "all:\n\techo hi\n");
    expect((await build("Makefile")).user).toContain("File: Makefile");
  });
});

describe("custom resolvers", () => {
  it("buildRequest uses the resolvers it is given, so a kind can be added without editing callers", async () => {
    const { user } = await build("debounce", { resolvers: { ...defaultResolvers, word: async () => ({ label: "custom", text: "from a custom resolver" }) } });
    expect(user).toContain("File: custom");
    expect(user).toContain("from a custom resolver");
  });
});

describe("words in chat", () => {
  const attach = (question: string, extra: Record<string, unknown> = {}) => attachReferences({ question, settings, cwd: dir, root: dir, ...extra });

  it("@word attaches the definition and reports it", async () => {
    const { content, reports, files } = await attach("how does @debounce work?");
    expect(content).toContain("how does @debounce work?");
    expect(content).toContain("File: src/util.ts:4-10");
    expect(reports[0]).toMatchObject({ kind: "sent", label: "src/util.ts:4-10" });
    expect(files).toEqual(["debounce"]);
  });

  it("leaves an @word with no definition (a decorator, a handle) as plain text", async () => {
    for (const q of ["what is @Injectable for?", "ping @someone about it"]) {
      expect(await attach(q)).toMatchObject({ content: q, files: [], reports: [] });
    }
  });

  it("counts the attached definition toward the one-message limit", async () => {
    await writeFile(join(dir, "src/huge.ts"), `function huge() {\n${"  // padding line\n".repeat(60)}}\n`);
    const err = await attach("@huge", { settings: { ...settings, contextBudget: 100 } }).catch((e) => e);
    expect(err.message).toContain("budget");
  });
});

describe("what a search could not cover", () => {
  let guarded: string;
  beforeAll(async () => {
    guarded = await mkdtemp(join(tmpdir(), "learn-word-guarded-"));
    execFileSync("git", ["init", "-q"], { cwd: guarded });
    await writeFile(join(guarded, "open.ts"), "export function openFn() {}\n");
    await writeFile(join(guarded, "secrets.ts"), `export function loadSecrets() { return "${CANARY}"; }\n`);
    await writeFile(join(guarded, ".env.ts"), `export function loadDotenv() { return "${CANARY}"; }\n`);
    await writeFile(join(guarded, ".gitignore"), "secrets.ts\n");
  });
  const inGuarded = (word: string) => buildRequest({ reference: word, settings, cwd: guarded, root: guarded });

  it("says how many files a safety rule skipped, without naming them or the rule", async () => {
    const err = await inGuarded("loadSecrets").catch((e) => e);
    expect(err).toBeInstanceOf(WordNotFoundError);
    expect(err.message).toContain('no definition of "loadSecrets" found in the project (searched 1 file)');
    expect(err.message).toContain("2 files were skipped because they are excluded by a safety rule");
    for (const leak of ["secrets.ts", ".env", "gitignore", "denylist", CANARY]) expect(err.message.replace("loadSecrets", "")).not.toContain(leak);
  });

  it("says nothing about skipped files when none were skipped", async () => {
    const clean = await mkdtemp(join(tmpdir(), "learn-word-clean-"));
    await writeFile(join(clean, "open.ts"), "export function openFn() {}\n");
    const err = await buildRequest({ reference: "nothingByThisName", settings, cwd: clean, root: clean }).catch((e) => e);
    expect(err.message).toContain("searched 1 file");
    expect(err.message).not.toContain("safety rule");
  });

  it("uses the singular for one skipped file", async () => {
    const one = await mkdtemp(join(tmpdir(), "learn-word-one-"));
    await writeFile(join(one, ".env.ts"), "export function hidden() {}\n");
    const err = await buildRequest({ reference: "hidden", settings, cwd: one, root: one }).catch((e) => e);
    expect(err.message).toContain("1 file was skipped because it is excluded by a safety rule");
  });

  it("stops at a file limit and says so, in the listing and in the error", async () => {
    const clean = await mkdtemp(join(tmpdir(), "learn-word-cap-"));
    for (const n of ["a", "b", "c"]) await writeFile(join(clean, `${n}.ts`), `export const ${n} = 1;\n`);
    const list = await listSearchableFiles(clean, 2);
    expect(list.files).toHaveLength(2);
    expect(list.truncatedAt).toBe(2);
    expect((await listSearchableFiles(clean)).truncatedAt).toBeUndefined();
    const err = new WordNotFoundError("x", 2, { truncatedAt: 20_000 });
    expect(err.message).toContain("the search stopped at its limit of 20,000 files, so a definition may be in a file that was not searched");
  });

  it("puts the limit in the Context report of a definition it did find", async () => {
    const search = { list: async (): Promise<SearchList> => ({ files: [join(dir, "src/util.ts")] as SearchList["files"], skipped: 0, truncatedAt: 20_000 }), read: async (p: string) => ({ text: "export function lone() {}\n", name: p }) };
    const excerpt = await resolveReference({ kind: "word", word: "lone" } as never, { read: async () => ({ text: "", name: "x" }), search: search as never });
    const text = formatContextReport(buildContextReport(excerpt, null, { chars: 24_000, source: "hosted default" }, false));
    expect(text).toContain("search stopped at its limit of 20,000 files");
  });
});

describe("several definitions of one word", () => {
  let multi: string;
  beforeAll(async () => {
    multi = await mkdtemp(join(tmpdir(), "learn-word-multi-"));
    for (const pkg of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      await mkdir(join(multi, `pkg-${pkg}`));
      await writeFile(join(multi, `pkg-${pkg}`, "dup.ts"), "export function dup() {\n  return 1;\n}\n");
    }
    await mkdir(join(multi, "pair"));
    await writeFile(join(multi, "pair/x.ts"), "export function twin() {}\n");
    await writeFile(join(multi, "pair/y.ts"), "export class Holder {\n  twin() {\n    return 1;\n  }\n}\n");
  });
  const report = async (word: string) => formatContextReport((await prepareRequest({ reference: word, settings, cwd: multi, root: multi })).report);

  it("names the chosen definition and where else the word is defined, as labels to ask for", async () => {
    expect(await report("twin")).toContain("chose pair/x.ts:1; also found in pair/y.ts:2-4 (to explain another, give it as file:N-M)");
  });

  it("lists five others at most, then counts the rest", async () => {
    const text = await report("dup");
    expect(text).toContain("chose pkg-a/dup.ts:1-3; also found in pkg-b/dup.ts:1-3, pkg-c/dup.ts:1-3, pkg-d/dup.ts:1-3, pkg-e/dup.ts:1-3, pkg-f/dup.ts:1-3 and 2 more");
  });

  it("says nothing extra when the word is defined once", async () => {
    expect(await report("Holder")).not.toContain("also found");
  });

  it("the other definition can be asked for with file:N-M", async () => {
    expect((await buildRequest({ reference: "pair/y.ts:2-4", settings, cwd: multi, root: multi })).user).toContain("File: pair/y.ts:2-4");
  });

  it("is in the report for a word attached in chat, and a hidden definition is noted there", async () => {
    const { reports } = await attachReferences({ question: "see @dup", settings, cwd: multi, root: multi });
    expect(formatContextReport(reports[0]!)).toContain("also found in pkg-b/dup.ts:1-3");
  });
});

describe("a word in chat that nothing visible defines", () => {
  it("is plain text, with a note only when a safety rule skipped files", async () => {
    const guarded = await mkdtemp(join(tmpdir(), "learn-word-chat-"));
    await writeFile(join(guarded, ".env.ts"), "export function hidden() {}\n");
    const ask = (cwd: string) => attachReferences({ question: "what is @hidden?", settings, cwd, root: cwd });
    const { content, notes } = await ask(guarded);
    expect(content).toBe("what is @hidden?");
    expect(notes).toEqual(["@hidden was not attached: no definition found; 1 file was skipped because it is excluded by a safety rule"]);
    const clean = await mkdtemp(join(tmpdir(), "learn-word-chat-clean-"));
    await writeFile(join(clean, "open.ts"), "export function openFn() {}\n");
    expect((await ask(clean)).notes).toEqual([]);
  });
});
