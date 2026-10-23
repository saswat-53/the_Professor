/** The user's input was wrong or unsupported; the CLI reports it with exit code 2. */
export class UsageError extends Error {
  override name = "UsageError";
}
