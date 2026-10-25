/** Process exit codes, one per family of failure; scripts can rely on them. */
export const ExitCode = { Runtime: 1, Usage: 2, Refused: 3, Cancelled: 130 } as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** Every failure the user can hit: a friendly message plus the exit code the CLI ends with. */
export abstract class LearnError extends Error {
  abstract readonly exitCode: ExitCode;
}

/** The user's input was wrong or unsupported. */
export class UsageError extends LearnError {
  override name = "UsageError";
  readonly exitCode = ExitCode.Usage;
}

/** The path the user named does not exist. */
export class FileNotFoundError extends UsageError {
  override name = "FileNotFoundError";
}

/** What a search could not look at, so "not found" is not mistaken for "does not exist". */
export interface SearchLimits {
  /** Files left out by a safety rule (Sensitive, git-ignored, a link). Only the count is given: a name or rule could reveal what a file holds. */
  skipped?: number;
  /** The most files a search reads; set when the project had more and the rest were not searched. */
  truncatedAt?: number;
}

/** The sentences that say what a search did not cover. Empty when it covered everything. */
export function describeSearchLimits({ skipped = 0, truncatedAt }: SearchLimits): string[] {
  const out: string[] = [];
  if (skipped > 0) out.push(`${skipped} file${skipped === 1 ? " was" : "s were"} skipped because ${skipped === 1 ? "it is" : "they are"} excluded by a safety rule`);
  if (truncatedAt !== undefined) out.push(`the search stopped at its limit of ${truncatedAt.toLocaleString("en-US")} files, so a definition may be in a file that was not searched`);
  return out;
}

/** A word Reference matched no definition in the project. A frontend can tell this apart from a bad argument (for example to suggest a command). */
export class WordNotFoundError extends UsageError {
  override name = "WordNotFoundError";
  constructor(
    readonly word: string,
    /** How many files were read and searched. */
    readonly searched: number,
    readonly limits: SearchLimits = {},
  ) {
    super([`no definition of "${word}" found in the project (searched ${searched} file${searched === 1 ? "" : "s"})`, ...describeSearchLimits(limits)].join("; "));
  }
}

/** Learn declined to send something to the model, on purpose. */
export abstract class RefusedError extends LearnError {
  readonly exitCode = ExitCode.Refused;
}

export type FileRefusal = "not-regular" | "too-large" | "binary" | "not-utf8" | "changed";

/** A file failed the reading rules, so it was not read (or not used). */
export class FileRefusedError extends RefusedError {
  override name = "FileRefusedError";
  constructor(
    readonly reason: FileRefusal,
    path: string,
    /** What is wrong with the file, without the path: "not a regular file". */
    readonly detail: string,
  ) {
    super(`${path}: ${detail}`);
  }
}

/**
 * Why a file counted as sensitive, as data a frontend can branch on. For `gitignore`, the fields
 * are absent only when git's report could not be read; the file is refused either way.
 */
export type BlockReason =
  | { kind: "denylist"; name: string }
  | { kind: "gitignore"; source?: string; line?: number; pattern?: string };

/** The file is on the sensitive list and no consent was given. */
export class BlockedFileError extends RefusedError {
  override name = "BlockedFileError";
  constructor(
    readonly file: string,
    readonly reason: BlockReason,
  ) {
    super(`${file}: blocked because it may hold secrets (rule: ${blockedBy(reason)})`);
  }
  /** Short label for the rule: the denylist entry's name, or "gitignore". */
  get rule(): string {
    return ruleName(this.reason);
  }
}

/** Short label for the rule: the denylist entry's name, or "gitignore". */
export const ruleName = (reason: BlockReason): string => (reason.kind === "denylist" ? reason.name : "gitignore");

function blockedBy(reason: BlockReason): string {
  if (reason.kind === "denylist") return reason.name;
  const where =
    reason.source === undefined
      ? "ignored by git (details unavailable)"
      : `ignored by ${reason.source}:${reason.line}, pattern "${reason.pattern}"`;
  return `gitignore, ${where}`;
}

/** The material would not fit the model's budget. */
export class ContextTooLongError extends RefusedError {
  override name = "ContextTooLongError";
}

/** A Session cannot hold what it is asked to: its pinned part is over the cap, or a question cannot fit beside it. */
export class SessionTooLongError extends ContextTooLongError {
  override name = "SessionTooLongError";
}

/** Every file in the diff is one a safety rule leaves out, so there is nothing left to send. */
export class DiffExcludedError extends RefusedError {
  override name = "DiffExcludedError";
}

/** The file resolves outside the project root; `--root` widens the root for one run. */
export class PathEscapeError extends RefusedError {
  override name = "PathEscapeError";
}

/** Git refused the repository because another user owns it; learn never overrides that. */
export class UntrustedRepoError extends RefusedError {
  override name = "UntrustedRepoError";
}

/** The user stopped the request (Ctrl-C, SIGTERM). The CLI may swap in the exit code of the signal it received. */
export class CancelledError extends LearnError {
  override name = "CancelledError";
  readonly exitCode = ExitCode.Cancelled;
  constructor() {
    super("cancelled");
  }
}

/** The provider or the network failed: worth retrying or fixing configuration, not the input. */
export abstract class RuntimeError extends LearnError {
  readonly exitCode = ExitCode.Runtime;
}

export class BadKeyError extends RuntimeError {
  override name = "BadKeyError";
}
export class RateLimitError extends RuntimeError {
  override name = "RateLimitError";
}
export class NetworkError extends RuntimeError {
  override name = "NetworkError";
}
export class ModelNotFoundError extends RuntimeError {
  override name = "ModelNotFoundError";
}
/** Anything else the provider did wrong; the message is generic because raw output is never shown. */
export class ProviderError extends RuntimeError {
  override name = "ProviderError";
}

/** A local failure with no type of its own, such as a missing file; its message is the system's. */
export class UnexpectedError extends RuntimeError {
  override name = "UnexpectedError";
}

/** `/save` or `/glossary` could not write inside the notes directory (it cannot be created, is not a directory, or a path resolved outside it). */
export class NotesError extends RuntimeError {
  override name = "NotesError";
}

/** The model's reply to `/quiz` was not the five questions asked for, so there is no quiz. */
export class QuizError extends RuntimeError {
  override name = "QuizError";
}
