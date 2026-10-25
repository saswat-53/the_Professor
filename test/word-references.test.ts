import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { attachReferences, buildRequest, defaultResolvers, UsageError } from "../src/core/index.js";

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
      expect(await attach(q)).toEqual({ content: q, files: [], reports: [], notes: [] });
    }
  });

  it("counts the attached definition toward the one-message limit", async () => {
    await writeFile(join(dir, "src/huge.ts"), `function huge() {\n${"  // padding line\n".repeat(60)}}\n`);
    const err = await attach("@huge", { settings: { ...settings, contextBudget: 100 } }).catch((e) => e);
    expect(err.message).toContain("budget");
  });
});
