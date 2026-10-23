import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { READ_ALLOWLIST, RULE, WRITE_ALLOWLIST, findViolations } from "./support/boundary.js";

const CORE = join(import.meta.dirname, "../src/core");

describe("core boundary (ADR 0002)", () => {
  const files = readdirSync(CORE, { recursive: true, encoding: "utf8" }).filter((f) => /\.[cm]?tsx?$/.test(f));
  it("scans at least one core file", () => expect(files.length).toBeGreaterThan(0));
  for (const path of files) {
    it(`${path} stays inside the boundary`, () => {
      expect(findViolations(path, readFileSync(join(CORE, path), "utf8"))).toEqual([]);
    });
  }
});

describe("boundary checker catches violations", () => {
  const cases = [
    { label: "import from cli", source: `import { x } from "../cli/main.js";`, rule: RULE.cli },
    { label: "side-effect import from cli", source: `import "../cli/main.js";`, rule: RULE.cli },
    { label: "dynamic import from cli", source: `await import("../cli/main.js");`, rule: RULE.cli },
    { label: "stdout", source: `process.stdout.write("hi");`, rule: RULE.stdio },
    { label: "argv", source: `const a = process.argv;`, rule: RULE.stdio },
    { label: "destructured stdout", source: `const { stdout } = process;`, rule: RULE.stdio },
    { label: "readline", source: `import { createInterface } from "node:readline/promises";`, rule: RULE.terminal },
    { label: "side-effect terminal import", source: `import "node:readline";`, rule: RULE.terminal },
    { label: "ink", source: `import { render } from "ink";`, rule: RULE.terminal },
    { label: "chalk subpath", source: `import c from "chalk/source";`, rule: RULE.terminal },
    { label: "writeFile import", source: `import { writeFile } from "node:fs/promises";`, rule: RULE.write },
    { label: "createWriteStream call", source: `fs.createWriteStream("x");`, rule: RULE.write },
    { label: "cpSync call", source: `cpSync(a, b);`, rule: RULE.write },
    { label: "readFile call", source: `const t = await fs.promises.readFile(p, "utf8");`, rule: RULE.read },
    { label: "readFileSync import", source: `import { readFileSync } from "node:fs";`, rule: RULE.read },
    { label: "open import", source: `import { open } from "node:fs/promises";`, rule: RULE.read },
    { label: "createReadStream call", source: `createReadStream(p);`, rule: RULE.read },
  ];
  for (const { label, source, rule } of cases) {
    it(`flags ${label}`, () => {
      expect(findViolations("fixture.ts", source).map((v) => v.rule)).toContain(rule);
    });
  }

  it("process.stdout.write triggers only the stdout rule", () => {
    expect(findViolations("f.ts", `process.stdout.write("x");`).map((v) => v.rule)).toEqual([RULE.stdio]);
  });

  it("a generic something.write(...) triggers no rule", () => {
    expect(findViolations("f.ts", `something.write("x");\nwriter.write(data);`)).toEqual([]);
  });

  it("reports the line number and offending text", () => {
    expect(findViolations("f.ts", `/* a\nb */\nconst ok = 1;\nprocess.stdout.write("x");`)).toEqual([
      { rule: RULE.stdio, line: 4, text: `process.stdout.write("x");` },
    ]);
  });

  it("passes clean code", () => {
    expect(findViolations("clean.ts", `export const add = (a: number, b: number) => a + b;`)).toEqual([]);
  });

  it("ignores words in comments and does not flag ../client", () => {
    const src = `// rm and rename and process.stdout\n/* writeFile( */\nimport { c } from "../client.js";`;
    expect(findViolations("clean.ts", src)).toEqual([]);
  });

  it("reading through the reader or reading metadata is fine", () => {
    const src = `import { stat, realpath } from "node:fs/promises";\nconst t = await reader.read(p);\nconst x = readTextFile(p);\nhandle.read(buf, 0, 1, 0);\nreadFile?: (p: string) => void;`;
    expect(findViolations("f.ts", src)).toEqual([]);
  });

  it("only the file-reading module may open files", () => {
    expect(READ_ALLOWLIST).toEqual(["read-file.ts"]);
    expect(findViolations("read-file.ts", `const h = await open(path, "r");`)).toEqual([]);
    expect(findViolations("explain.ts", `const h = await open(path, "r");`).map((v) => v.rule)).toEqual([RULE.read]);
  });

  it("allowlist is empty until the notes writer (ticket 36) lands", () => {
    expect(WRITE_ALLOWLIST).toEqual([]);
  });
});
