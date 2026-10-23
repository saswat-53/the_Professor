import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type BlockFinder, type LineSpan, noBlockFinder } from "../src/core/context.js";
import { buildRequest } from "../src/core/explain.js";
import { blockFinderContract } from "./support/block-finder-contract.js";

const settings = { baseUrl: "http://localhost:11434/v1", model: "m" };

/** A project with one file of numbered lines; `header` lines come first. */
async function project(name: string, header: string[], total: number) {
  const dir = await mkdtemp(join(tmpdir(), "learn-ctx-"));
  await mkdir(join(dir, ".git"));
  const body = Array.from({ length: total }, (_, i) => `line ${i + 1}`);
  await writeFile(join(dir, name), [...header, ...body].join("\n") + "\n");
  return dir;
}

const request = async (dir: string, reference: string) => (await buildRequest({ reference, cwd: dir, settings })).user;

describe("context: fixed window fallback", () => {
  it("sends 25 lines either side of the excerpt, kept apart from the excerpt itself", async () => {
    const dir = await project("a.txt", [], 100);
    const user = await request(dir, "a.txt:50-51");
    expect(user).toContain("line 25\n");
    expect(user).not.toContain("line 24\n");
    expect(user).toContain("line 76\n");
    expect(user).not.toContain("line 77\n");
    const [excerptPart, contextPart] = user.split(/\nContext/);
    expect(excerptPart).toContain("a.txt:50-51");
    expect(excerptPart).toContain("line 50\nline 51");
    expect(excerptPart).not.toContain("line 49");
    expect(contextPart).toContain("line 49");
  });

  it("uses fewer lines at the edges of the file", async () => {
    const dir = await project("a.txt", [], 30);
    const user = await request(dir, "a.txt:3");
    expect(user).toContain("line 1\n");
    expect(user).toContain("line 28\n");
    expect(user).not.toContain("line 29\n");
  });
});

describe("context: imports", () => {
  it("includes the import block, including multi-line imports, when it lies above the window", async () => {
    const dir = await project("a.ts", ['import fs from "node:fs";', "import {", "  a,", '} from "./a";', ""], 100);
    const user = await request(dir, "a.ts:80");
    expect(user).toContain('import fs from "node:fs";\nimport {\n  a,\n} from "./a";');
    expect(user).toContain("Imports from a.ts, lines 1-4");
  });

  it("does not repeat imports that fall inside the window", async () => {
    const dir = await project("a.ts", ['import fs from "node:fs";'], 10);
    const user = await request(dir, "a.ts:5");
    expect(user.match(/import fs/g)).toHaveLength(1);
    expect(user).not.toContain("Imports from");
  });

  it("sends no imports section for a file without imports", async () => {
    const dir = await project("a.txt", [], 100);
    expect(await request(dir, "a.txt:80")).not.toContain("Imports from");
  });
});

/** A toy finder for a language where blocks are `block NAME {` ... `}` at matching indentation. */
const toyFinder: BlockFinder = {
  name: "toy",
  find({ lines }, range) {
    let best: LineSpan | null = null;
    const stack: number[] = [];
    lines.forEach((line, i) => {
      if (/^\s*block \w+ \{$/.test(line)) stack.push(i + 1);
      else if (/^\s*\}$/.test(line) && stack.length) {
        const span = { start: stack.pop()!, end: i + 1 };
        if (span.start <= range.start && span.end >= range.end && (!best || span.end - span.start < best.end - best.start)) best = span;
      }
    });
    return best;
  },
};

const toySource = ["// top", "block outer {", "  x", "  block inner {", "    y", "  }", "  z", "}", "free"].join("\n");

blockFinderContract("null finder", noBlockFinder, [
  { name: "finds nothing, even inside what looks like a block", path: "a.toy", text: toySource, range: { start: 5, end: 5 }, expect: null },
]);

blockFinderContract("toy finder (proves the suite catches found, not found and nested)", toyFinder, [
  { name: "found", path: "a.toy", text: toySource, range: { start: 7, end: 7 }, expect: { start: 2, end: 8 } },
  { name: "nested: the smallest block wins", path: "a.toy", text: toySource, range: { start: 5, end: 5 }, expect: { start: 4, end: 6 } },
  { name: "a range spanning inner and outer gets the outer block", path: "a.toy", text: toySource, range: { start: 5, end: 7 }, expect: { start: 2, end: 8 } },
  { name: "not found outside any block", path: "a.toy", text: toySource, range: { start: 9, end: 9 }, expect: null },
]);

describe("context: enclosing block", () => {
  it("sends the block instead of the window when a finder returns one", async () => {
    const dir = await project("a.txt", [], 100);
    const user = await buildRequest({
      reference: "a.txt:50",
      cwd: dir,
      settings,
      blockFinder: { name: "fixed", find: () => ({ start: 45, end: 55 }) },
    }).then((r) => r.user);
    expect(user).toContain("Enclosing block in a.txt, lines 45-55");
    expect(user).toContain("line 45\n");
    expect(user).not.toContain("line 44\n");
    expect(user).not.toContain("line 56\n");
  });

  it("ignores a block that does not contain the Excerpt and falls back to the window", async () => {
    const dir = await project("a.txt", [], 100);
    const user = await buildRequest({
      reference: "a.txt:50",
      cwd: dir,
      settings,
      blockFinder: { name: "wrong", find: () => ({ start: 1, end: 10 }) },
    }).then((r) => r.user);
    expect(user).toContain("Surrounding lines in a.txt, lines 25-75");
  });
});
