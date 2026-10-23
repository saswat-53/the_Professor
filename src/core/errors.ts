/** Process exit codes, one per family of failure; scripts can rely on them. */
export const ExitCode = { Runtime: 1, Usage: 2, Refused: 3 } as const;
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
    message: string,
  ) {
    super(message);
  }
}

/** The file is on the sensitive list and no consent was given. */
export class BlockedFileError extends RefusedError {
  override name = "BlockedFileError";
}

/** The material would not fit the model's budget. */
export class ContextTooLongError extends RefusedError {
  override name = "ContextTooLongError";
}

/** The file resolves outside the project root; `--root` widens the root for one run. */
export class PathEscapeError extends RefusedError {
  override name = "PathEscapeError";
}

/** Git refused the repository because another user owns it; learn never overrides that. */
export class UntrustedRepoError extends RefusedError {
  override name = "UntrustedRepoError";
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
