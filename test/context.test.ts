import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type BlockFinder, type LineSpan, noBlockFinder } from "../src/core/context.js";
import { buildRequest, explain } from "../src/core/explain.js";
import type { ExplainEvent, LanguageModel, ModelRequest } from "../src/core/types.js";
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
    expect(contextPart).toContain("line 52");
    expect(contextPart).not.toContain("line 50\n");
    expect(contextPart).not.toContain("line 51\n");
  });

  it("sends every line once: before and after the Excerpt, never the Excerpt again", async () => {
    const dir = await project("a.txt", [], 100);
    const user = await request(dir, "a.txt:50-51");
    expect(user.match(/^line 50$/gm)).toHaveLength(1);
    expect(user).toContain("before the Excerpt");
    expect(user).toContain("after the Excerpt");
  });

  it("calls the window 'Nearby lines', the glossary's word for Context", async () => {
    const user = await request(await project("a.txt", [], 100), "a.txt:50");
    expect(user).toContain("Nearby lines");
    expect(user).not.toMatch(/surround/i);
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
    expect(user).toContain("Imports, a.ts lines 1-4");
  });

  it("never cuts an import block that straddles the window start: the window grows to take it whole", async () => {
    const imports = ['import {', "  alpha,", "  beta,", '} from "./x";', 'import fs from "node:fs";'];
    const dir = await project("a.ts", imports, 100);
    // Excerpt at line 28 puts the window start at line 3, in the middle of the import statement.
    const user = await request(dir, "a.ts:28");
    expect(user).toContain('import {\n  alpha,\n  beta,\n} from "./x";\nimport fs from "node:fs";');
    expect(user.match(/alpha/g)).toHaveLength(1);
    expect(user).toContain("Nearby lines, a.ts lines 1-");
  });

  it("does not repeat imports that fall inside the window", async () => {
    const dir = await project("a.ts", ['import fs from "node:fs";'], 10);
    const user = await request(dir, "a.ts:5");
    expect(user.match(/import fs/g)).toHaveLength(1);
    expect(user).not.toContain("Imports,");
  });

  it("is not fooled by brackets inside strings and comments on an import line", async () => {
    const header = ['import x from "a(b"; // note (', 'import y from \'c[\';', "import z from `d{`;"];
    const user = await request(await project("a.ts", header, 100), "a.ts:80");
    expect(user).toContain("Imports, a.ts lines 1-3");
  });

  it("finds imports after a directive, a shebang and a license header", async () => {
    const header = ["#!/usr/bin/env node", "/*", " * Copyright (c) Someone", " */", "'use strict';", "", 'import a from "./a";'];
    const user = await request(await project("a.js", header, 100), "a.js:90");
    expect(user).toContain("Imports, a.js line 7");
  });

  it("finds imports after a Python module docstring", async () => {
    const header = ['"""Module docs', "spanning lines.", '"""', "import os", "from a import (", "    b,", ")"];
    const user = await request(await project("a.py", header, 100), "a.py:90");
    expect(user).toContain("Imports, a.py lines 4-7");
  });

  it("stops the import block at real code", async () => {
    const header = ['import a from "./a";', "const x = 1;", 'import b from "./b";'];
    const user = await request(await project("a.ts", header, 100), "a.ts:90");
    expect(user).toContain("Imports, a.ts line 1");
  });

  it("sends no imports section for a file without imports", async () => {
    const dir = await project("a.txt", [], 100);
    expect(await request(dir, "a.txt:80")).not.toContain("Imports,");
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
    expect(user).toContain("Enclosing block, a.txt lines 45-49 (before the Excerpt)");
    expect(user).toContain("a.txt lines 51-55 (after the Excerpt)");
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
    expect(user).toContain("Nearby lines, a.txt lines 25-49 (before the Excerpt)");
  });
});

describe("context: as received by the model", () => {
  it("shows the Excerpt, the import block and the nearby lines separately, and nothing from an imported secret file", async () => {
    const CANARY = "CANARY-SECRET-7f3a";
    const dir = await project("a.ts", ['import secrets from "./.env";', 'import fs from "node:fs";', ""], 100);
    await writeFile(join(dir, ".env"), `TOKEN=${CANARY}\n`);

    const requests: ModelRequest[] = [];
    const model: LanguageModel = {
      async *stream(r) {
        requests.push(r);
        yield "ok";
      },
    };
    const events: ExplainEvent[] = [];
    for await (const e of explain({ reference: "a.ts:60-61", cwd: dir, settings, model, signal: new AbortController().signal }))
      events.push(e);

    expect(events.at(-1)?.type).toBe("done");
    const user = requests[0]!.user;
    const [head, ...context] = user.split("\n\nContext (");
    expect(head).toBe("File: a.ts:60-61\n\n```\nline 57\nline 58\n```");
    const contextText = context.join("");
    expect(contextText).toContain('Imports, a.ts lines 1-2:\n\n```\nimport secrets from "./.env";\nimport fs from "node:fs";\n```');
    expect(contextText).toContain("(before the Excerpt)");
    expect(contextText).toContain("(after the Excerpt)");
    expect(contextText).not.toMatch(/line 5[78]\n/);
    // The Context only ever re-uses text from the Excerpt's own, already-checked file.
    expect(user).not.toContain(CANARY);
    expect(requests[0]!.system).not.toContain(CANARY);
  });
});
