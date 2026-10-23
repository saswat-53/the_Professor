import { fenceCode } from "./prompt.js";
import type { Excerpt } from "./reference.js";

/** 1-based, inclusive line numbers. */
export interface LineSpan {
  start: number;
  end: number;
}

/**
 * Finds the Enclosing block: the smallest function, method or class that contains `range`.
 * Returns null when there is none or the finder cannot tell. A finder is a plain dependency,
 * so a better one (for example tree-sitter) can replace the heuristic without touching callers.
 */
export interface BlockFinder {
  /** Names the method in the Context report. */
  readonly name: string;
  find(file: { path: string; lines: readonly string[] }, range: LineSpan): LineSpan | null;
}

/** The built-in finder for now: finds nothing, so every file takes the fallback window. */
export const noBlockFinder: BlockFinder = { name: "none", find: () => null };

/** Lines either side of the Excerpt used when no Enclosing block is found. */
export const WINDOW_LINES = 25;

export interface Context {
  /** The file the Context came from. */
  path: string;
  /** "enclosing-block" or "window": which method chose the nearby lines. */
  method: "enclosing-block" | "window";
  finder: string;
  /** The file's import block, when it lies above the nearby lines. Always whole, never cut. */
  imports?: Section;
  /**
   * The Enclosing block or the window, split around the Excerpt so that every line is sent once
   * (the Excerpt itself travels separately). Either side is absent when the Excerpt touches that edge.
   */
  before?: Section;
  after?: Section;
}
export interface Section extends LineSpan {
  text: string;
}

const IMPORT_START =
  /^\s*(import\b|export\b[^=(]*\bfrom\b|from\s+\S+\s+import\b|#\s*include\b|using\s+\S|use\s+\S|(?:const|let|var)\s+[\w{},\s]+=\s*require\()/;
// Lines that may precede imports without counting as code: blanks, comments, shebang, directives.
const SKIPPABLE = /^\s*($|\/\/|#(?!\s*include)|\/\*|\*|"use strict"|'use strict'|"use client"|'use client')/;
const TRIPLE_QUOTE = /"""|'''/;

/** Strings and comments hold brackets that are not syntax: `import x from "a(b"`. */
const STRINGS_AND_COMMENTS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*|\/\*.*?\*\/|#.*/g;

const depthChange = (line: string) =>
  [...line.replace(STRINGS_AND_COMMENTS, "")].reduce(
    (d, ch) => d + ("([{".includes(ch) ? 1 : ")]}".includes(ch) ? -1 : 0),
    0,
  );

/** The span from the first to the last import statement in the file's leading lines, if any. */
export function findImportBlock(lines: readonly string[]): LineSpan | null {
  let first = 0;
  let last = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (IMPORT_START.test(line)) {
      first ||= i + 1;
      let depth = depthChange(line);
      while (depth > 0 && i + 1 < lines.length) depth += depthChange(lines[++i]!);
      last = i + 1;
    } else if (/^\s*[rRbBuU]?("""|''')/.test(line)) {
      // A module docstring: skip to its closing quotes.
      const opener = line.match(TRIPLE_QUOTE)![0];
      const closesHere = line.indexOf(opener, line.indexOf(opener) + 3) !== -1;
      while (!closesHere && i + 1 < lines.length && !lines[++i]!.includes(opener));
    } else if (!SKIPPABLE.test(line)) {
      break;
    }
  }
  return first ? { start: first, end: last } : null;
}

const section = (lines: readonly string[], span: LineSpan): Section => ({
  ...span,
  text: lines.slice(span.start - 1, span.end).join("\n"),
});

const contains = (outer: LineSpan, inner: LineSpan) => outer.start <= inner.start && outer.end >= inner.end;

/** Gathers the Context around an Excerpt; null when the Excerpt did not come from a file. */
export function gatherContext(excerpt: Excerpt, finder: BlockFinder): Context | null {
  const source = excerpt.source;
  if (!source) return null;
  const lines = source.text.split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  const range = { start: source.start, end: source.end };

  const found = finder.find({ path: source.path, lines }, range);
  // A finder is untrusted input to this function: a block that misses the Excerpt or the file is ignored.
  const block = found && found.start >= 1 && found.end <= lines.length && contains(found, range) ? found : null;
  const span: LineSpan = block
    ? { ...block }
    : { start: Math.max(1, range.start - WINDOW_LINES), end: Math.min(lines.length, range.end + WINDOW_LINES) };

  // Imports are all-or-nothing. One that ends above the nearby lines is sent whole; one that
  // reaches into them pulls the start up to take it whole, so a statement is never cut in half.
  const importSpan = findImportBlock(lines);
  if (importSpan && importSpan.start < span.start && importSpan.end >= span.start) span.start = importSpan.start;
  const imports = importSpan && importSpan.end < span.start ? section(lines, importSpan) : undefined;

  const before = span.start < range.start ? section(lines, { start: span.start, end: range.start - 1 }) : undefined;
  const after = range.end < span.end ? section(lines, { start: range.end + 1, end: span.end }) : undefined;
  return {
    path: source.path,
    method: block ? "enclosing-block" : "window",
    finder: finder.name,
    ...(imports && { imports }),
    ...(before && { before }),
    ...(after && { after }),
  };
}

/** The user message: the Excerpt first, then the Context, each in its own fence so they cannot be confused. */
export function formatRequest(excerpt: Excerpt, context: Context | null): string {
  const parts = [`File: ${excerpt.label}`, fenceCode(excerpt.text)];
  if (context) {
    const { path } = context;
    const range = (s: LineSpan) => (s.start === s.end ? `line ${s.start}` : `lines ${s.start}-${s.end}`);
    parts.push("Context (not the code to explain; it is here to make the Excerpt understandable):");
    if (context.imports) parts.push(`Imports, ${path} ${range(context.imports)}:`, fenceCode(context.imports.text));
    const what = context.method === "enclosing-block" ? "Enclosing block" : "Nearby lines";
    if (context.before) parts.push(`${what}, ${path} ${range(context.before)} (before the Excerpt):`, fenceCode(context.before.text));
    if (context.after) parts.push(`${what}, ${path} ${range(context.after)} (after the Excerpt):`, fenceCode(context.after.text));
  }
  return parts.join("\n\n");
}
