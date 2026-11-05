import { columnsOf, graphemes } from "./footer.js";

export interface CursorTracker {
  /** Feeds in text exactly as it is written to the terminal. */
  feed(text: string): void;
  /** The row the cursor is on, counted from 0 at the top of the screen (an estimate that errs on the side of too far down). */
  readonly row: number;
  /** True once the text has been long enough to scroll the screen; after that the row means nothing and stays on the last one. */
  readonly scrolled: boolean;
}

/**
 * Follows where the cursor is on the screen from what is written to it: a newline goes down a row, a long line wraps, colour codes take no
 * room. It exists so something drawn at a fixed place on the screen can tell when that place has scrolled away. It is told the cursor's row
 * to start from. The one cursor move readline uses to redraw a line (back to column 1) is understood; others are ignored. A terminal that wraps
 * differently from this (an unusual character width) can make it a row or two out, so callers keep a margin.
 */
export function createCursorTracker({ rows, columns, startRow }: { rows: number; columns: number; startRow: number }): CursorTracker {
  let row = startRow;
  let col = 0;
  let scrolled = false;
  /** A control sequence that began in an earlier write and has not ended yet. */
  let pending = "";

  const down = () => {
    if (row >= rows - 1) scrolled = true;
    else row += 1;
  };
  const put = (width: number) => {
    // A line that fills the width wraps when the next character arrives, not before.
    if (col + width > columns) {
      down();
      col = 0;
    }
    col += width;
  };

  return {
    feed(text) {
      let input = pending + text;
      pending = "";
      let i = 0;
      while (i < input.length) {
        const ch = input[i]!;
        if (ch === "\u001b") {
          const rest = input.slice(i);
          const csi = /^\u001b\[([0-?]*)[ -/]*([@-~])/.exec(rest);
          if (csi) {
            if (csi[2] === "G") col = Math.max(0, (Number.parseInt(csi[1] ?? "", 10) || 1) - 1);
            i += csi[0].length;
            continue;
          }
          // `ESC [` and some parameters with no final byte yet: wait for the rest.
          if (/^\u001b(\[[0-?]*[ -/]*)?$/.test(rest)) {
            pending = rest;
            return;
          }
          // Some other escape: skip the ESC and the character after it.
          i += 2;
          continue;
        }
        if (ch === "\n") {
          down();
          col = 0;
          i += 1;
        } else if (ch === "\r") {
          col = 0;
          i += 1;
        } else if (ch === "\t") {
          col = Math.min(columns - 1, col + (8 - (col % 8)));
          i += 1;
        } else if (ch < " ") {
          i += 1;
        } else {
          // Take a run of ordinary text and place it a grapheme at a time.
          let end = i;
          while (end < input.length && input[end]! >= " " && input[end] !== "\u001b") end += 1;
          for (const g of graphemes(input.slice(i, end))) put(columnsOf(g));
          i = end;
        }
      }
      input = "";
    },
    get row() {
      return row;
    },
    get scrolled() {
      return scrolled;
    },
  };
}
