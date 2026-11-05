import { describe, expect, it } from "vitest";
import { createCursorTracker } from "../src/cli/cursor-tracker.js";

const ESC = "\u001b";

describe("createCursorTracker", () => {
  it("starts on the row it is given and moves down a row for each newline", () => {
    const t = createCursorTracker({ rows: 24, columns: 80, startRow: 8 });
    expect(t.row).toBe(8);
    t.feed("one\ntwo\n");
    expect(t.row).toBe(10);
  });
  it("wraps a long line onto the next row, counting wide characters as two columns", () => {
    const t = createCursorTracker({ rows: 24, columns: 10, startRow: 0 });
    t.feed("a".repeat(25));
    expect(t.row).toBe(2);
    const w = createCursorTracker({ rows: 24, columns: 10, startRow: 0 });
    w.feed("漢".repeat(6));
    expect(w.row).toBe(1);
  });
  it("does not wrap a line that exactly fills the width until another character comes", () => {
    const t = createCursorTracker({ rows: 24, columns: 10, startRow: 0 });
    t.feed("a".repeat(10));
    expect(t.row).toBe(0);
    t.feed("b");
    expect(t.row).toBe(1);
  });
  it("ignores colour codes, and treats carriage return and the cursor-to-column-1 move as going back to the start of the row", () => {
    const t = createCursorTracker({ rows: 24, columns: 10, startRow: 0 });
    t.feed(`${ESC}[2m${"a".repeat(8)}${ESC}[0m`);
    expect(t.row).toBe(0);
    // A readline redraw: back to column 1, clear, write the prompt and line again. It does not add rows.
    t.feed(`${ESC}[1G${ESC}[0J${"b".repeat(8)}`);
    t.feed(`\r${"c".repeat(8)}`);
    expect(t.row).toBe(0);
  });
  it("reports the screen as scrolled once the cursor would pass the last row, and never counts past it", () => {
    const t = createCursorTracker({ rows: 5, columns: 80, startRow: 3 });
    expect(t.scrolled).toBe(false);
    t.feed("\n");
    expect(t.row).toBe(4);
    expect(t.scrolled).toBe(false);
    t.feed("\n");
    expect(t.scrolled).toBe(true);
    expect(t.row).toBe(4);
  });
  it("counts text split across writes the same as one write", () => {
    const a = createCursorTracker({ rows: 24, columns: 10, startRow: 0 });
    const b = createCursorTracker({ rows: 24, columns: 10, startRow: 0 });
    a.feed("hello wor");
    a.feed("ld again\nx");
    b.feed("hello world again\nx");
    expect(a.row).toBe(b.row);
  });
  it("copes with an escape sequence cut in two between writes", () => {
    const t = createCursorTracker({ rows: 24, columns: 10, startRow: 0 });
    t.feed(`${ESC}[3`);
    t.feed("1mabc");
    expect(t.row).toBe(0);
    t.feed("d".repeat(8));
    expect(t.row).toBe(1);
  });
});
