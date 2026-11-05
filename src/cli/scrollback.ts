import { columnsOf, graphemes } from "./footer.js";

const ESC = "\u001b";
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;
const SAVE = `${ESC}7`;
const RESTORE = `${ESC}8`;
const goTo = (row: number) => `${ESC}[${row};1H`;
const CLEAR_TO_END = `${ESC}[K`;

/** Pieces of a line: a control sequence, or a run of ordinary text. */
const TOKENS = /(\u001b\[[0-?]*[ -/]*[@-~])|(\u001b)|([^\u001b]+)/g;

/**
 * One line of text cut into screen rows of `width` columns. Colour (SGR) sequences take no width and are kept, and the colour in force is
 * closed at the end of a row and opened again at the start of the next, so each row stands alone. Any other control sequence is dropped:
 * the viewer places every row itself, and a stray cursor move would put text somewhere else on the screen.
 */
export function wrapLine(line: string, width: number): string[] {
  const rows: string[] = [];
  let current = "";
  let used = 0;
  let active = "";
  const closeRow = () => {
    rows.push(active ? `${current}${RESET}` : current);
    current = active;
    used = 0;
  };
  for (const [, sequence, , text] of line.matchAll(TOKENS)) {
    if (sequence !== undefined) {
      if (!sequence.endsWith("m")) continue;
      current += sequence;
      active = sequence === RESET || sequence === `${ESC}[m` ? "" : active + sequence;
    } else if (text !== undefined) {
      for (const g of graphemes(text)) {
        const w = columnsOf(g);
        if (used + w > width && used > 0) closeRow();
        current += g;
        used += w;
      }
    }
  }
  rows.push(active ? `${current}${RESET}` : current);
  return rows;
}

/** About two megabytes of text: far more than anyone scrolls back through, small enough never to matter. */
const DEFAULT_CAP = 2_000_000;

export interface ScreenLog {
  /** Adds text exactly as it was written to the terminal; a write may end mid-line. */
  append(text: string): void;
  /** Forgets everything kept. */
  clear(): void;
  /** Everything kept, as screen rows `width` columns wide (so a resized window re-flows it). */
  lines(width: number): string[];
}

/** What the chat has printed, kept as text so it can be shown again. The terminal cannot be asked for it: a line that scrolls out of a pinned-header region is gone. */
export function createScreenLog(cap = DEFAULT_CAP): ScreenLog {
  let text = "";
  return {
    append(more) {
      text += more;
      if (text.length > cap) {
        const cut = text.slice(text.length - cap);
        const newline = cut.indexOf("\n");
        text = newline === -1 ? cut : cut.slice(newline + 1);
      }
    },
    clear() {
      text = "";
    },
    lines(width) {
      if (text === "") return [];
      const parts = text.replace(/\r/g, "").replace(/\t/g, "    ").split("\n");
      if (parts.at(-1) === "") parts.pop();
      return parts.flatMap((part) => wrapLine(part, Math.max(1, width)));
    },
  };
}

/** The terminal as the viewer sees it: where to write, and how big it is right now. */
export interface ScrollbackOutput {
  write(text: string): unknown;
  rows?: number;
  columns?: number;
}

export interface Scrollback {
  /** Remembers text the chat is about to print. If the reader is looking at history, the live view comes back first, so new text never lands on a history page. */
  record(text: string): void;
  /** `lines` further back, by default a page. Does nothing when everything already fits on the screen. */
  up(lines?: number): void;
  /** `lines` forward, by default a page; past the newest line it returns to the live view. */
  down(lines?: number): void;
  /** Back to the live view: the latest lines redrawn, and the cursor on the row where the prompt goes. The caller redraws the prompt. */
  end(): void;
  /** True while a history page is on screen. */
  readonly active: boolean;
}

/**
 * Scrolling inside the pinned-header area, which the terminal cannot do itself. The area under the owl is a scroll region, and a terminal
 * throws away the lines that scroll off the top of one, so scrolling back means redrawing the area from the log. Every row is placed by
 * absolute position between a cursor save and restore, so the prompt keeps its place; the last row of the area says where the reader is.
 */
export function createScrollback({ output, log, headerRows }: { output: ScrollbackOutput; log: ScreenLog; headerRows: number }): Scrollback {
  /** How many lines the view is moved back from the newest; 0 is the live view. */
  let offset = 0;
  const rows = () => output.rows ?? 24;
  const columns = () => Math.max(1, output.columns ?? 80);
  /** Rows of history on a page: the area less the status row. */
  const pageRows = () => Math.max(1, rows() - headerRows - 1);

  /** A page's step: one line of overlap between pages, so the reader keeps their place. */
  const page = () => Math.max(1, pageRows() - 1);

  const paintHistory = () => {
    const all = log.lines(columns());
    const page = pageRows();
    offset = Math.min(Math.max(offset, 0), Math.max(0, all.length - page));
    const end = all.length - offset;
    const shown = all.slice(Math.max(0, end - page), end);
    let text = SAVE;
    for (let i = 0; i < page; i++) text += `${goTo(headerRows + 1 + i)}${shown[i] ?? ""}${RESET}${CLEAR_TO_END}`;
    const note = `── scrolled back · ${offset} ${offset === 1 ? "line" : "lines"} below · PageDown scrolls, End returns ──`;
    text += `${goTo(rows())}${DIM}${Array.from(note).slice(0, columns()).join("")}${RESET}${CLEAR_TO_END}${RESTORE}`;
    output.write(text);
  };

  const self: Scrollback = {
    get active() {
      return offset > 0;
    },
    record(text) {
      if (offset > 0) self.end();
      log.append(text);
    },
    up(lines = page()) {
      const all = log.lines(columns());
      if (all.length <= pageRows()) return;
      offset += Math.max(1, lines);
      paintHistory();
    },
    down(lines = page()) {
      if (offset === 0) return;
      offset -= Math.max(1, lines);
      if (offset <= 0) self.end();
      else paintHistory();
    },
    end() {
      offset = 0;
      const tail = log.lines(columns()).slice(-pageRows());
      let text = "";
      for (let i = 0; i < pageRows(); i++) text += `${goTo(headerRows + 1 + i)}${tail[i] ?? ""}${RESET}${CLEAR_TO_END}`;
      // The status row is cleared too, and the cursor goes to the row after the last line, where the prompt belongs.
      text += `${goTo(rows())}${CLEAR_TO_END}`;
      output.write(`${text}${goTo(headerRows + 1 + Math.min(tail.length, pageRows()))}`);
    },
  };
  return self;
}
