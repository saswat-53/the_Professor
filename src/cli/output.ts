/** What the output mode depends on; passed in so the decision is a pure function. */
export type Terminal = { stdoutIsTTY: boolean; stderrIsTTY: boolean; env: Record<string, string | undefined> };

/** How output is written. `color` is for status lines on stderr; `stripEscapes` is for the model's text on stdout. */
export type OutputMode = { color: boolean; stripEscapes: boolean };

/**
 * The one decision about who is watching. Terminal mode is stdout being a terminal: the model's text
 * is then stripped of escape sequences, whatever the colour preference, because they are dangerous
 * either way. Colour needs a person watching both streams (if either is piped or redirected the
 * output may end up in a file or another program, where escape codes are noise), and is turned off
 * by NO_COLOR (no-color.org, when non-empty) or TERM=dumb. Plain mode (stdout not a terminal) leaves
 * the text exactly as the model sent it.
 */
export function outputMode({ stdoutIsTTY, stderrIsTTY, env }: Terminal): OutputMode {
  const color = stdoutIsTTY && stderrIsTTY && !env.NO_COLOR && env.TERM !== "dumb";
  return { color, stripEscapes: stdoutIsTTY };
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
