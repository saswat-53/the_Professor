import { BlockedFileError } from "./errors.js";
import type { Budget, Dropped } from "./budget.js";
import type { Context } from "./context.js";
import type { GatheredDiff } from "./diff.js";
import type { Excerpt, WordSearchNote } from "./reference.js";
import type { SensitiveBypass } from "./sensitive.js";

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
      /** What was pointed at: a file or other input, as the Excerpt's label names it. */
      label: string;
      /** The file the lines came from. Null for a whole-file or other Reference, which gets no Context. */
      path: string | null;
      /** In file order. */
      ranges: ReportedRange[];
      method: "heuristic" | "fallback window" | null;
      finder: string | null;
      dropped?: Dropped;
      budget: Budget;
      /** The endpoint is on this machine, so Ollama's context window may matter. */
      local: boolean;
      /** The input had no filename (piped or clipboard text), so the Sensitive-file rules could not be applied to it. */
      unnamed?: "piped input" | "clipboard text";
      /** Sensitive files that were sent anyway, and why. Absent unless a file actually matched a rule. */
      overrides?: SensitiveBypass[];
      /** A word Reference: the other definitions it found, and the limit if the search was cut short. */
      search?: WordSearchNote;
    }
  | {
      /** `--diff`: the working tree's changes against a revision. */
      kind: "diff";
      against: string;
      /** Files whose changes are sent, by repository-relative name. */
      files: string[];
      /** How many of `files` are untracked and shown as new files. */
      untracked: number;
      /** Changed files left out by a safety rule, with the rule. */
      excluded: { file: string; rule: string }[];
      /** Untracked files that could not be shown as text, with why. */
      skipped: { file: string; why: string }[];
      /** A shallow clone: history, and so any ref to compare with, is incomplete. */
      shallow: boolean;
      /** Against a revision other than HEAD, so content that was later removed can be in the diff. */
      againstHistory: boolean;
      limitedTo?: string[];
      budget: Budget;
      local: boolean;
      overrides?: SensitiveBypass[];
    }
  | { kind: "refused"; file: string; rule: string }
  /** The Session was over its cap, so the oldest turns were left out of this request. Turn 1 is the first explanation. */
  | { kind: "session-trimmed"; turns: number[]; files: string[]; capChars: number };

/** The report says a Sensitive file was sent anyway (`--allow-sensitive`, or a local endpoint). */
export const hasOverride = (report: ContextReport): boolean => (report.kind === "sent" || report.kind === "diff") && (report.overrides?.length ?? 0) > 0;

export function buildDiffReport(diff: GatheredDiff, budget: Budget, local: boolean, bypassed: readonly SensitiveBypass[] = []): ContextReport {
  const { against, files, untracked, excluded, skipped, shallow, againstHistory, limitedTo } = diff;
  return { kind: "diff", against, files, untracked, excluded, skipped, shallow, againstHistory, ...(limitedTo && { limitedTo }), budget, local, ...(bypassed.length > 0 && { overrides: [...bypassed] }) };
}

export function buildContextReport(excerpt: Excerpt, context: Context | null, budget: Budget, local: boolean, bypassed: readonly SensitiveBypass[] = []): ContextReport {
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
    label: excerpt.label,
    path: source?.path ?? null,
    ranges,
    method: context ? (context.method === "enclosing-block" ? "heuristic" : "fallback window") : null,
    finder: context?.finder ?? null,
    ...(context?.dropped && { dropped: context.dropped }),
    budget,
    local,
    ...(excerpt.origin && { unnamed: excerpt.origin === "piped" ? ("piped input" as const) : ("clipboard text" as const) }),
    ...(bypassed.length > 0 && { overrides: [...bypassed] }),
    ...(excerpt.search && { search: excerpt.search }),
  };
}

/** The report for a run that failed: a refused Sensitive file shows as refused, anything else has none. */
export const reportForError = (err: unknown): ContextReport | undefined =>
  err instanceof BlockedFileError ? { kind: "refused", file: err.file, rule: err.rule } : undefined;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const BUDGET_LABEL = { "hosted default": "hosted endpoint budget", "local default": "local endpoint budget", setting: "budget" } as const;
const PART_LABEL = { imports: "imports", before: "before the Excerpt", excerpt: "the Excerpt", after: "after the Excerpt" } as const;

/** `[2, 3, 5]` as `2-3, 5`. */
function ranges(numbers: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i < numbers.length; ) {
    let j = i;
    while (numbers[j + 1] === numbers[j]! + 1) j++;
    out.push(j > i ? `${numbers[i]}-${numbers[j]}` : `${numbers[i]}`);
    i = j + 1;
  }
  return out.join(", ");
}

const overrideLines = (overrides: readonly SensitiveBypass[] = []): string[] =>
  overrides.map((o) =>
    o.by === "flag"
      ? `  overridden: ${o.file} (rule: ${o.rule}) is being sent to ${o.host ?? "the endpoint"} because --allow-sensitive was passed`
      : `  sensitive-file check skipped: ${o.file} (rule: ${o.rule}); endpoint is local (${o.host ?? "unknown host"})`,
  );

function budgetLines(report: { budget: Budget; local: boolean }): string[] {
  const { chars, source } = report.budget;
  const out = [`  ${BUDGET_LABEL[source]} ${chars.toLocaleString("en-US")} characters (${source === "setting" ? "setting" : "default"})`];
  if (report.local) {
    out.push(
      "  note: Ollama's context window is small by default; raise it with the app's context-length slider, or start the server with OLLAMA_CONTEXT_LENGTH set, and check with `ollama ps`",
    );
  }
  return out;
}

/** The report as the text a frontend shows the user before anything is sent. */
export function formatContextReport(report: ContextReport): string {
  if (report.kind === "session-trimmed") {
    const out = [
      `Context report: the Session is over its Session cap of ${report.capChars.toLocaleString("en-US")} characters, so the oldest turns are left out of this request`,
      `  dropped ${report.turns.length === 1 ? "turn" : "turns"} ${ranges(report.turns)} (question and answer; the first explanation and the most recent turns are kept)`,
    ];
    if (report.files.length > 0) out.push(`  dropped @file material: ${report.files.join(", ")}`);
    return out.join("\n");
  }
  if (report.kind === "refused") {
    return `Context report\n  refused: ${report.file} (rule: ${report.rule}); its content is not sent`;
  }
  const out = ["Context report: this is what will be sent"];
  if (report.kind === "diff") {
    out.push(`  the working tree's changes against ${report.against}${report.limitedTo ? `, limited to ${report.limitedTo.join(", ")}` : ""}${report.untracked > 0 ? ` (${plural(report.untracked, "untracked file")} shown as new)` : ""}`);
    for (const file of report.files) out.push(`    ${file}`);
    for (const e of report.excluded) out.push(`  left out: ${e.file} (rule: ${e.rule}); its changes are not sent`);
    for (const s of report.skipped) out.push(`  left out: ${s.file} (${s.why})`);
    if (report.againstHistory) out.push(`  note: this compares against ${report.against}, so the diff can include content that was later removed, such as a secret; the sensitive-file rules go by file name, not content, and cannot filter it`);
    if (report.shallow) out.push("  shallow clone: history is incomplete, so a ref older than this clone's depth cannot be compared");
    out.push(...overrideLines(report.overrides), ...budgetLines(report));
    return out.join("\n");
  }
  if (report.path === null) out.push(`  ${report.label}`, "    the whole text, with no surrounding Context");
  else {
    out.push(`  ${report.path}`);
    for (const r of report.ranges) out.push(`    ${r.start === r.end ? `line ${r.start}` : `lines ${r.start}-${r.end}`}: ${PART_LABEL[r.part]}`);
    if (report.method) out.push(`  Enclosing block found by: ${report.method}${report.finder && report.finder !== "none" ? ` (${report.finder})` : ""}`);
  }
  const { search } = report;
  if (search && search.alsoFound.length > 0) {
    const more = search.more > 0 ? ` and ${search.more} more` : "";
    out.push(`  chose ${report.label}; also found in ${search.alsoFound.join(", ")}${more} (to explain another, give it as file:N-M)`);
  }
  if (search?.truncatedAt !== undefined) {
    out.push(`  search stopped at its limit of ${search.truncatedAt.toLocaleString("en-US")} files, so a better definition may be in a file that was not searched`);
  }
  if (report.unnamed) out.push(`  no filename checks applied: ${report.unnamed} has no filename, so the sensitive-file rules could not be checked; look over it before sending`);
  out.push(...overrideLines(report.overrides));
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
  out.push(...budgetLines(report));
  return out.join("\n");
}
