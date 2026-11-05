import { INVISIBLE } from "./escape-stripper.js";

/** The characters to show: C0 controls except newline and tab, DEL, the 8-bit controls, and the characters the escape stripper treats as invisible. */
const SHOWN = new RegExp(`[\\u0000-\\u0008\\u000b-\\u001f\\u007f]|[\\u0080-\\u009f]|${INVISIBLE.source}`, "g");

/**
 * The text with its control characters made visible instead of removed, for the request that `--dry-run` and `--show-prompt` print: that
 * output exists to show exactly what is sent, so taking characters out of it would show something else. A C0 control becomes its picture
 * from the Unicode "control pictures" block (ESC is `\u241b`, BEL is `\u2407`), and the others, which have none, their code (`<U+009B>`).
 * Newlines and tabs are layout and stay. A text that already holds one of the pictures is not told apart from an escape shown this way.
 */
export function visibleControls(text: string): string {
  return text.replace(SHOWN, (ch) => {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f) return String.fromCharCode(0x2400 + code);
    if (code === 0x7f) return "\u2421";
    return `<U+${code.toString(16).toUpperCase().padStart(4, "0")}>`;
  });
}
