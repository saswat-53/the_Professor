import type { BlockFinder, LineSpan } from "./context.js";

/** A statement as Python reads it: physical lines joined by brackets, backslashes or triple quotes. */
interface LogicalLine {
  start: number;
  end: number;
  /** Width of the leading whitespace, tabs counted to the next multiple of 8 like Python does. */
  indent: number;
  /** The code with strings blanked and comments dropped. */
  code: string;
}

const DEFINITION = /^(?:async\s+def|def|class)\b/;

function indentWidth(whitespace: string): number {
  let width = 0;
  for (const ch of whitespace) width = ch === "\t" ? width + 8 - (width % 8) : width + 1;
  return width;
}

/**
 * Splits the file into logical lines by scanning once. Strings (including triple-quoted ones) and
 * comments are skipped so their contents cannot look like code. Returns null when a string never
 * closes, because every later line would then be misread.
 */
function logicalLines(lines: readonly string[]): LogicalLine[] | null {
  const text = lines.join("\n");
  const result: LogicalLine[] = [];
  let line = 1;
  let depth = 0;
  let current: LogicalLine | null = null;
  let lineStart = 0; // index of the first character of the current physical line

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") {
      line++;
      lineStart = i + 1;
      if (current && depth === 0 && text[i - 1] !== "\\") {
        result.push(current);
        current = null;
      }
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f") {
      if (current && !current.code.endsWith(" ")) current.code += " ";
      continue;
    }
    if (ch === "#") {
      const end = text.indexOf("\n", i);
      i = (end === -1 ? text.length : end) - 1;
      continue;
    }
    if (!current) {
      current = { start: line, end: line, indent: indentWidth(text.slice(lineStart, i)), code: "" };
    }
    current.end = line;
    if (ch === '"' || ch === "'") {
      const quote = text.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      let j = i + quote.length;
      for (; j < text.length; j++) {
        if (text[j] === "\\") j++;
        else if (text.startsWith(quote, j)) break;
        else if (text[j] === "\n" && quote.length === 1) break; // unterminated single-line string
      }
      if (j >= text.length && quote.length === 3) return null;
      const end = text.startsWith(quote, j) ? j + quote.length : j;
      for (let k = i; k < end; k++) if (text[k] === "\n") line++;
      current.end = line;
      current.code += '""';
      i = end - 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    current.code += ch;
  }
  if (current) result.push(current);
  return result;
}

/** Every def and class, from its first decorator to the end of its indented body. */
function findBlocks(lines: readonly string[]): LineSpan[] | null {
  const statements = logicalLines(lines);
  if (!statements) return null;
  const blocks: LineSpan[] = [];
  for (let i = 0; i < statements.length; i++) {
    const head = statements[i]!;
    if (!DEFINITION.test(head.code)) continue;
    let end = head.end;
    for (let j = i + 1; j < statements.length && statements[j]!.indent > head.indent; j++) end = statements[j]!.end;
    let start = head.start;
    for (let j = i - 1; j >= 0 && statements[j]!.indent === head.indent && statements[j]!.code.startsWith("@"); j--) {
      start = statements[j]!.start;
    }
    blocks.push({ start, end });
  }
  return blocks;
}

/** Finds the Enclosing block for Python by indentation; any other extension finds nothing. */
export const pythonBlockFinder: BlockFinder = {
  name: "python",
  find({ path, lines }, range) {
    if (!path.toLowerCase().endsWith(".py")) return null;
    let best: LineSpan | null = null;
    for (const b of findBlocks(lines) ?? []) {
      if (b.start > range.start || b.end < range.end) continue;
      if (!best || b.end - b.start < best.end - best.start) best = b;
    }
    return best;
  },
};
