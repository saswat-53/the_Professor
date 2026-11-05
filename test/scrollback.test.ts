import { describe, expect, it } from "vitest";
import { createScreenLog, createScrollback, wrapLine } from "../src/cli/scrollback.js";

const ESC = "\u001b";
const RESET = `${ESC}[0m`;
const strip = (text: string) => text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");

describe("wrapLine", () => {
  it("cuts a line at the terminal's width", () => {
    expect(wrapLine("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
    expect(wrapLine("", 3)).toEqual([""]);
  });
  it("counts a wide character as two columns and never splits it", () => {
    expect(wrapLine("ab漢cd", 3)).toEqual(["ab", "漢c", "d"]);
  });
  it("does not count colour codes as width, and carries the colour across a cut", () => {
    const [first, second] = wrapLine(`${ESC}[2mabcdef${RESET}`, 3);
    expect(first).toBe(`${ESC}[2mabc${RESET}`);
    expect(second).toBe(`${ESC}[2mdef${RESET}`);
  });
  it("drops cursor-moving escapes, which would move the viewer's own drawing", () => {
    expect(wrapLine(`a${ESC}[5;5Hb${ESC}[2Jc`, 10)).toEqual(["abc"]);
  });
});

describe("createScreenLog", () => {
  it("splits what was written into lines, keeping a half-written last line, and joins writes that continue a line", () => {
    const log = createScreenLog();
    log.append("one\ntw");
    log.append("o\nthree");
    expect(log.lines(80)).toEqual(["one", "two", "three"]);
    log.append("\n");
    expect(log.lines(80)).toEqual(["one", "two", "three"]);
  });
  it("wraps to the width asked for each time, so a resize re-flows it", () => {
    const log = createScreenLog();
    log.append("abcdef\n");
    expect(log.lines(3)).toEqual(["abc", "def"]);
    expect(log.lines(6)).toEqual(["abcdef"]);
  });
  it("can be emptied, and then starts again from nothing", () => {
    const log = createScreenLog();
    log.append("old\nlines\n");
    log.clear();
    expect(log.lines(80)).toEqual([]);
    log.append("new\n");
    expect(log.lines(80)).toEqual(["new"]);
  });
  it("ignores carriage returns and expands tabs", () => {
    const log = createScreenLog();
    log.append("a\r\nb\tc\n");
    expect(log.lines(80)).toEqual(["a", "b    c"]);
  });
  it("keeps only the newest text once it passes its cap, starting at a whole line", () => {
    const log = createScreenLog(20);
    for (let i = 0; i < 10; i++) log.append(`line${i}\n`);
    const lines = log.lines(80);
    expect(lines.at(-1)).toBe("line9");
    expect(lines.length).toBeLessThan(10);
    expect(lines.every((l) => /^line\d$/.test(l))).toBe(true);
  });
});

/** A terminal of `rows` x `columns` that remembers what was written to it. */
function fakeOutput(rows = 24, columns = 20) {
  const writes: string[] = [];
  return { output: { rows, columns, write: (text: string) => void writes.push(text) }, writes };
}
const numbered = (n: number) => Array.from({ length: n }, (_, i) => `row${i + 1}`).join("\n") + "\n";

describe("createScrollback", () => {
  const HEADER = 8; // a 24-row screen: the scrolling area is rows 9-24, so 15 lines of history and a status row

  it("does nothing when everything already fits on the screen", () => {
    const { output, writes } = fakeOutput();
    const log = createScreenLog();
    log.append(numbered(5));
    const sb = createScrollback({ output, log, headerRows: HEADER });
    sb.up();
    expect(sb.active).toBe(false);
    expect(writes).toEqual([]);
  });

  it("paints an earlier page into the scrolling area, with a status row, and never above it", () => {
    const { output, writes } = fakeOutput();
    const log = createScreenLog();
    log.append(numbered(100));
    const sb = createScrollback({ output, log, headerRows: HEADER });
    sb.up();
    expect(sb.active).toBe(true);
    const text = writes.join("");
    // One page back (14 lines, overlapping the live view by one): rows 72-86 of 100, where the live view shows 86-100.
    expect(strip(text)).toContain("row86");
    expect(strip(text)).not.toContain("row100");
    expect(text).toContain(`${ESC}[9;1H`);
    expect(text).not.toContain(`${ESC}[8;1H`);
    expect(text).toContain(`${ESC}[24;1H`);
    expect(strip(text)).toMatch(/scrolled back/);
    // Drawn between a save and a restore of the cursor, so the prompt's place is kept.
    expect(text.startsWith(`${ESC}7`)).toBe(true);
    expect(text.endsWith(`${ESC}8`)).toBe(true);
  });

  it("goes further back with each up, stops at the oldest line, and comes forward with down", () => {
    const { output, writes } = fakeOutput(24, 80);
    const log = createScreenLog();
    log.append(numbered(100));
    const sb = createScrollback({ output, log, headerRows: HEADER });
    for (let i = 0; i < 20; i++) sb.up();
    expect(strip(writes.at(-1)!)).toContain("row1");
    expect(strip(writes.at(-1)!)).not.toContain("row100");
    sb.down();
    expect(sb.active).toBe(true);
    expect(strip(writes.at(-1)!)).toMatch(/lines? below/);
  });

  it("returns to the live view with end: redraws the latest lines and leaves the cursor on the prompt row", () => {
    const { output, writes } = fakeOutput();
    const log = createScreenLog();
    log.append(numbered(100));
    const sb = createScrollback({ output, log, headerRows: HEADER });
    sb.up();
    sb.end();
    expect(sb.active).toBe(false);
    const text = writes.at(-1)!;
    expect(strip(text)).toContain("row100");
    expect(strip(text)).toContain("row86");
    expect(strip(text)).not.toContain("row85");
    expect(strip(text)).not.toMatch(/scrolled back/);
    // 15 lines of history fill rows 9-23, so the prompt belongs on the last row (24).
    expect(text.endsWith(`${ESC}[24;1H`)).toBe(true);
  });

  it("puts the prompt right after the text when the screen is not full yet", () => {
    const { output, writes } = fakeOutput(24, 20);
    const log = createScreenLog();
    log.append(numbered(30));
    const sb = createScrollback({ output, log, headerRows: HEADER });
    sb.up();
    log.append("tail\n");
    sb.end();
    expect(writes.at(-1)!.endsWith(`${ESC}[24;1H`)).toBe(true);
    const short = createScreenLog();
    short.append(numbered(3));
    const w2 = fakeOutput();
    const sb2 = createScrollback({ output: w2.output, log: short, headerRows: HEADER });
    sb2.end();
    expect(w2.writes.at(-1)!.endsWith(`${ESC}[12;1H`)).toBe(true);
  });

  it("goes back to the live view before new text is recorded, so streamed text never lands on the history page", () => {
    const { output, writes } = fakeOutput();
    const log = createScreenLog();
    log.append(numbered(100));
    const sb = createScrollback({ output, log, headerRows: HEADER });
    sb.up();
    const before = writes.length;
    sb.record("fresh\n");
    expect(sb.active).toBe(false);
    expect(writes.length).toBeGreaterThan(before);
    expect(log.lines(20).at(-1)).toBe("fresh");
  });

  it("re-flows to a new width and size", () => {
    const f = fakeOutput(24, 20);
    const log = createScreenLog();
    log.append("x".repeat(40) + "\n" + numbered(60));
    const sb = createScrollback({ output: f.output, log, headerRows: HEADER });
    f.output.rows = 30;
    f.output.columns = 10;
    sb.up();
    expect(f.writes.join("")).toContain(`${ESC}[30;1H`);
  });

  it("moves by a number of lines when asked, for a wheel that turns a few lines at a time", () => {
    const { output, writes } = fakeOutput(24, 80);
    const log = createScreenLog();
    log.append(numbered(100));
    const sb = createScrollback({ output, log, headerRows: HEADER });
    sb.up(3);
    // Three lines back: the page ends at row 97, so row 97 is shown and 98 is not.
    expect(strip(writes.at(-1)!)).toContain("row97");
    expect(strip(writes.at(-1)!)).not.toContain("row98");
    expect(strip(writes.at(-1)!)).toMatch(/3 lines below/);
    sb.down(1);
    expect(strip(writes.at(-1)!)).toMatch(/2 lines below/);
    sb.down(5);
    expect(sb.active).toBe(false);
  });
});
