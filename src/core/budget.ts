import type { LineSpan } from "./context.js";
import { ContextTooLongError, UsageError } from "./errors.js";
import type { Excerpt } from "./reference.js";
import { resolveEndpoint } from "./sensitive.js";
import type { Endpoint } from "./sensitive.js";

/**
 * The Budget counts code only: the Excerpt's text, and each Context line plus its newline. The fixed
 * prompt text (labels, fences, the system prompt) is extra. Length is JavaScript string length, so an
 * emoji counts as 2; it is an estimate of size, not a token count.
 */
export const HOSTED_BUDGET = 24_000;
export const LOCAL_BUDGET = 8_000;

/** Where a budget came from, so a refusal can say which limit the user hit. */
export type BudgetSource = "hosted default" | "local default" | "setting";
export interface Budget {
  chars: number;
  source: BudgetSource;
}

/** `endpoint` is the one parse of the base URL (`resolveEndpoint`), shared with the file reader and the report. */
export function resolveBudget(endpoint: Endpoint, setting?: number): Budget {
  if (setting !== undefined) return { chars: setting, source: "setting" };
  return endpoint.local ? { chars: LOCAL_BUDGET, source: "local default" } : { chars: HOSTED_BUDGET, source: "hosted default" };
}

export const defaultBudget = (baseUrl: string) => resolveBudget(resolveEndpoint(baseUrl)).chars;

/** The Excerpt is never trimmed, so one that leaves no room for Context is refused instead. */
export const isValidBudget = (chars: number) => Number.isInteger(chars) && chars > 0;

export function assertExcerptFits(excerpt: Excerpt, { chars, source }: Budget): void {
  if (!isValidBudget(chars)) throw new UsageError(`the context budget must be a whole number of characters above 0, got ${chars}`);
  if (excerpt.text.length > chars / 2) {
    throw new ContextTooLongError(
      `the Excerpt is ${excerpt.text.length} characters, over half of the ${chars.toLocaleString("en-US")}-character budget (${source}); narrow your range (for example file:40-60)`,
    );
  }
}

/** What the budget cost, for the Context report. */
export interface Dropped {
  imports: boolean;
  /** Nearby lines lost to trimming. Does not include `importTail`. */
  lines: number;
  /** Lines of a dropped import statement that sat inside the normal window, so every omitted line is accounted for. */
  importTail: number;
}

/**
 * Fits the Context to `room` characters (the budget minus the Excerpt). `normal` is the Enclosing
 * block or window; `importSpan` the file's import block. Two passes, farthest from the Excerpt first:
 *
 * 1. Imports are all-or-nothing, and the farthest, so they are dropped whole before any nearby line.
 *    Imports that reached into `normal` had grown the nearby lines upward to take them whole;
 *    dropping them shrinks the nearby lines back, minus the tail of the statement (never half an import).
 * 2. Still over, keep the lines nearest the Excerpt, one side then the other (a greedy two-pointer
 *    walk outward), and stop at the first line that does not fit. Each side stays one unbroken run
 *    reaching the Excerpt; equal distances go to the side before it.
 */
export function fitToBudget(
  lines: readonly string[],
  range: LineSpan,
  normal: LineSpan,
  importSpan: LineSpan | null,
  room: number,
): { imports?: LineSpan; span: LineSpan; dropped?: Dropped } {
  const cost = (from: number, to: number) => lines.slice(from - 1, to).reduce((n, l) => n + l.length + 1, 0);
  const nearby = (s: LineSpan) => cost(s.start, range.start - 1) + cost(range.end + 1, s.end);

  const straddled = importSpan !== null && importSpan.start < normal.start && importSpan.end >= normal.start ? importSpan : null;
  const separate = importSpan !== null && importSpan.end < normal.start ? importSpan : null;
  let span: LineSpan = straddled ? { start: straddled.start, end: normal.end } : { ...normal };
  let imports = separate ?? undefined;
  let droppedImports = false;
  let importTail = 0;

  if ((separate ? cost(separate.start, separate.end) : 0) + nearby(span) > room) {
    droppedImports = separate !== null || straddled !== null;
    imports = undefined;
    if (straddled) {
      span = { start: Math.min(range.start, Math.max(normal.start, straddled.end + 1)), end: normal.end };
      importTail = span.start - normal.start;
    }
  }

  const before = span.end - span.start + 1;
  if (nearby(span) > room) {
    let used = 0;
    let up = range.start;
    let down = range.end;
    while (up > span.start || down < span.end) {
      const takeUp = up > span.start && (down >= span.end || range.start - (up - 1) <= down + 1 - range.end);
      const line = takeUp ? up - 1 : down + 1;
      const c = cost(line, line);
      if (used + c > room) break;
      used += c;
      if (takeUp) up--;
      else down++;
    }
    span = { start: up, end: down };
  }
  const lost = before - (span.end - span.start + 1);
  return { ...(imports && { imports }), span, ...((droppedImports || lost > 0) && { dropped: { imports: droppedImports, lines: lost, importTail } }) };
}
