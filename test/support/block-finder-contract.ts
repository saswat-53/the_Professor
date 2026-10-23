import { describe, expect, it } from "vitest";
import type { BlockFinder, LineSpan } from "../../src/core/context.js";

export interface BlockFinderCase {
  name: string;
  path: string;
  text: string;
  range: LineSpan;
  /** The smallest block containing `range`, or null when there is none. */
  expect: LineSpan | null;
}

/** Contract tests for any BlockFinder. A future finder reuses this with its own cases. */
export function blockFinderContract(label: string, finder: BlockFinder, cases: BlockFinderCase[]) {
  describe(`BlockFinder contract: ${label}`, () => {
    it("has a name for the Context report", () => expect(finder.name).not.toBe(""));
    for (const c of cases) {
      it(c.name, () => {
        const lines = c.text.split("\n");
        const found = finder.find({ path: c.path, lines }, c.range);
        expect(found).toEqual(c.expect);
        if (found) {
          expect(found.start).toBeLessThanOrEqual(c.range.start);
          expect(found.end).toBeGreaterThanOrEqual(c.range.end);
          expect(found.start).toBeGreaterThanOrEqual(1);
          expect(found.end).toBeLessThanOrEqual(lines.length);
        }
      });
    }
  });
}
