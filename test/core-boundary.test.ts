import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ADR 0002: core never imports cli, never touches the terminal, never writes files.
const CORE = join(import.meta.dirname, "../src/core");
const FORBIDDEN = [
  /from\s+["']\.\.\/cli/,
  /process\.(stdout|stderr|argv)/,
  /\b(writeFile|appendFile|mkdir|rm|unlink|rename|createWriteStream)\b/,
];

describe("core boundary (ADR 0002)", () => {
  for (const name of readdirSync(CORE).filter((f) => f.endsWith(".ts"))) {
    it(`${name} stays inside the boundary`, () => {
      const src = readFileSync(join(CORE, name), "utf8");
      for (const rule of FORBIDDEN) expect(src).not.toMatch(rule);
    });
  }
});
