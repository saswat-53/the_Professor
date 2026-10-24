/** Where the stripper is within an escape sequence. */
type State =
  | "ground" // ordinary text
  | "esc" // after ESC, deciding what kind of sequence this is
  | "csi" // inside a control sequence (cursor moves, colours), until its final character
  | "string" // inside OSC/DCS/SOS/PM/APC (window titles, links), until BEL or ST
  | "string-esc"; // inside a string, just after an ESC (which may start ST)

const ESC = 0x1b;
const BEL = 0x07;
const CAN = 0x18;
const SUB = 0x1a;
const CSI_8BIT = 0x9b;
const ST_8BIT = 0x9c;

/**
 * The most characters one escape sequence may hold back. A real title or hyperlink is far shorter;
 * a longer one is a sequence that never closes, and holding on to it would hide the rest of the reply.
 */
export const MAX_HELD = 256;

/** The characters that open a string sequence, after ESC (OSC `]`, DCS `P`, SOS `X`, PM `^`, APC `_`) or as one 8-bit character (0x9D, 0x90, 0x98, 0x9E, 0x9F). */
const STRING_INTRODUCERS = new Set("]PX^_");
const STRING_INTRODUCERS_8BIT = new Set([0x90, 0x98, 0x9d, 0x9e, 0x9f]);

/**
 * Characters that are not control codes but hide or reorder text on screen: zero-width characters and
 * bidi marks (U+200B to U+200F), bidi embeddings and overrides (U+202A to U+202E), bidi isolates
 * (U+2066 to U+2069), the word joiner (U+2060) and the BOM (U+FEFF). Only these invisible controls go:
 * the right-to-left letters themselves (Arabic, Hebrew) pass through, and so do U+2028 and U+2029.
 */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;

/**
 * Returns a function that removes terminal escape sequences and control characters from streamed
 * text, so what the model says cannot move the cursor, retitle the window, or hide text. Only
 * newline and tab survive of the control characters, and invisible characters that reorder or hide
 * text (see INVISIBLE) go too, which also splits an emoji joined with ZWJ into its parts.
 *
 * It is a state machine, because a sequence can be split across chunks: the state lives in the
 * returned function, and one stripper must see one stream from the start. An unterminated sequence
 * at the end of the stream is dropped, never emitted, and one that runs past MAX_HELD characters is
 * dropped at that point, after which normal output resumes. A sequence that is broken off by something
 * that cannot belong to it (a newline in a CSI, an ESC in an OSC) ends there, and that character is
 * read afresh, as terminals do.
 */
export function createEscapeStripper(): (chunk: string) => string {
  let state: State = "ground";

  /** Handles one character in the current state; returns the character if it is to be shown. */
  const step = (ch: string, code: number): string => {
    switch (state) {
      case "ground":
        if (code === ESC) state = "esc";
        else if (code === CSI_8BIT) state = "csi";
        else if (STRING_INTRODUCERS_8BIT.has(code)) state = "string";
        else if (ch === "\n" || ch === "\t") return ch;
        else if (code >= 0x20 && code < 0x7f) return ch;
        else if (code > 0x9f) return INVISIBLE.test(ch) ? "" : ch;
        return "";
      case "esc":
        if (ch === "[") state = "csi";
        else if (STRING_INTRODUCERS.has(ch)) state = "string";
        else if (code >= 0x20 && code <= 0x2f) return ""; // an intermediate: the sequence goes on
        else if (code >= 0x30 && code <= 0x7e) state = "ground"; // the final character
        else {
          state = "ground";
          return step(ch, code);
        }
        return "";
      case "csi":
        if (code >= 0x20 && code <= 0x3f) return ""; // parameters and intermediates
        state = "ground";
        if (code >= 0x40 && code <= 0x7e) return ""; // the final character
        return code === CAN || code === SUB ? "" : step(ch, code);
      case "string":
        if (code === BEL || code === ST_8BIT || code === CAN || code === SUB) state = "ground";
        else if (code === ESC) state = "string-esc";
        return "";
      case "string-esc":
        // Anything but a backslash is not ST: the OSC ends, and the ESC begins a sequence of its own.
        state = "esc";
        return step(ch, code);
    }
  };

  /** How many characters the sequence in progress has held back so far. */
  let held = 0;

  return (chunk) => {
    let out = "";
    for (let i = 0; i < chunk.length; i++) {
      out += step(chunk[i]!, chunk.charCodeAt(i));
      if (state === "ground" || ++held >= MAX_HELD) {
        state = "ground";
        held = 0;
      }
    }
    return out;
  };
}
