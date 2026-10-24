/** What the output mode depends on; passed in so the decision is a pure function. */
export type Terminal = { stdoutIsTTY: boolean; stderrIsTTY: boolean; env: Record<string, string | undefined> };

/**
 * Colour only when a person is watching both streams. If either is piped or redirected the output
 * may end up in a file or another program, where escape codes are noise. NO_COLOR (no-color.org)
 * counts when non-empty.
 */
export function colorEnabled({ stdoutIsTTY, stderrIsTTY, env }: Terminal): boolean {
  if (!stdoutIsTTY || !stderrIsTTY) return false;
  if (env.NO_COLOR) return false;
  return env.TERM !== "dumb";
}

export type StatusKind = "info" | "warning" | "error";

/** ANSI SGR colour codes: dim, yellow, red. */
const CODES: Record<StatusKind, string> = { info: "2", warning: "33", error: "31" };

/** Returns a function that colours a status message line by line, or passes it through when colour is off. */
export function painter(enabled: boolean): (kind: StatusKind, text: string) => string {
  if (!enabled) return (_kind, text) => text;
  return (kind, text) =>
    text
      .split("\n")
      .map((line) => (line === "" ? line : `\u001b[${CODES[kind]}m${line}\u001b[0m`))
      .join("\n");
}
