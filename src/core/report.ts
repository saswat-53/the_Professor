import type { BlockedFileError } from "./errors.js";
import type { Budget, Dropped } from "./budget.js";
import type { Context } from "./context.js";
import type { Excerpt } from "./reference.js";

export interface ReportedRange {
  part: "imports" | "before" | "excerpt" | "after";
  start: number;
  end: number;
}

/**
 * What is about to be sent, as data. It is built from the Excerpt and the Context that formatRequest
 * turns into the request, so the two cannot disagree. A frontend prints it with `formatContextReport`.
 */
export type ContextReport =
  | {
      kind: "sent";
      /** The file the lines came from, or null for input with no file behind it. */
      path: string | null;
      /** In file order. */
      ranges: ReportedRange[];
      method: "heuristic" | "fallback window" | null;
      finder: string | null;
      dropped?: Dropped;
      budget: Budget;
      /** The endpoint is on this machine, so Ollama's context window may matter. */
      local: boolean;
    }
  | { kind: "refused"; file: string; rule: string };

export function buildContextReport(excerpt: Excerpt, context: Context | null, budget: Budget, local: boolean): ContextReport {
  const source = excerpt.source;
  const ranges: ReportedRange[] = [];
  if (source) {
    if (context?.imports) ranges.push({ part: "imports", start: context.imports.start, end: context.imports.end });
    if (context?.before) ranges.push({ part: "before", start: context.before.start, end: context.before.end });
    ranges.push({ part: "excerpt", start: source.start, end: source.end });
    if (context?.after) ranges.push({ part: "after", start: context.after.start, end: context.after.end });
  }
  return {
    kind: "sent",
    path: source?.path ?? null,
    ranges,
    method: context ? (context.method === "enclosing-block" ? "heuristic" : "fallback window") : null,
    finder: context?.finder ?? null,
    ...(context?.dropped && { dropped: context.dropped }),
    budget,
    local,
  };
}

export const refusedReport = (err: BlockedFileError): ContextReport => ({ kind: "refused", file: err.file, rule: err.rule });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const PART_LABEL = { imports: "imports", before: "before the Excerpt", excerpt: "the Excerpt", after: "after the Excerpt" } as const;

/** The report as the text a frontend shows the user before anything is sent. */
export function formatContextReport(report: ContextReport): string {
  if (report.kind === "refused") {
    return `Context report\n  refused: ${report.file} (rule: ${report.rule}); its content is not sent`;
  }
  const out = ["Context report: this is what will be sent"];
  if (report.path === null) out.push("  the input text only (no file behind it, so no Context)");
  else {
    out.push(`  ${report.path}`);
    for (const r of report.ranges) out.push(`    ${r.start === r.end ? `line ${r.start}` : `lines ${r.start}-${r.end}`}: ${PART_LABEL[r.part]}`);
    if (report.method) out.push(`  Enclosing block found by: ${report.method}${report.finder && report.finder !== "none" ? ` (${report.finder})` : ""}`);
  }
  const { dropped } = report;
  if (dropped) {
    const parts: string[] = [];
    if (dropped.imports) {
      parts.push(
        dropped.importTail > 0
          ? `imports dropped, including ${plural(dropped.importTail, "line")} of the import statement inside the window`
          : "imports dropped",
      );
    }
    if (dropped.lines > 0) parts.push(`${plural(dropped.lines, "nearby line")} dropped`);
    out.push(`  dropped for budget: ${parts.join("; ")}`);
  }
  out.push(`  budget: ${report.budget.chars.toLocaleString("en-US")} (${report.budget.source}) characters`);
  if (report.local) {
    out.push(
      "  note: Ollama's context window is small by default; raise it with the app's context-length slider, or start the server with OLLAMA_CONTEXT_LENGTH set, and check with `ollama ps`",
    );
  }
  return out.join("\n");
}
