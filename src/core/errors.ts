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
