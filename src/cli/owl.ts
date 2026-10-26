/** The owl in a mortarboard, drawn with Unicode block characters (which every terminal font has). */
const OWL = [
  " ▄▄▄▄▄▄▄▄▄ ",
  " ▀▀▀▀█▀▀▀▀ ",
  " ▐▛█▙▄▟█▜▌ ",
  " ▐▌▀▀▼▀▀▐▌ ",
  "  ▜▄▄▄▄▄▛  ",
];

/** Text beside the owl, one entry per owl row; the owl's own rows stay aligned because every OWL row is the same width. */
const WORDS = ["", "Professor", "ask me about this code", "/exit to leave", ""];

/** ANSI SGR: yellow for the owl, dim for the words. Only used when `color` is on (see outputMode). */
const YELLOW = "33";
const DIM = "2";

const paint = (code: string, text: string) => (text === "" ? text : `\u001b[${code}m${text}\u001b[0m`);

/**
 * The chat banner: the owl with a few words beside it, ending in a newline. Pure, so it is tested
 * without a terminal; the caller decides whether to show it at all (a terminal, not a pipe).
 */
export function owlBanner({ color }: { color: boolean }): string {
  const lines = OWL.map((row, i) => {
    const words = WORDS[i] ?? "";
    // Trailing padding is dropped when nothing follows the owl, so both modes print the same visible text.
    if (words === "") return color ? paint(YELLOW, row.trimEnd()) : row.trimEnd();
    return color ? `${paint(YELLOW, row)} ${paint(DIM, words)}` : `${row} ${words}`;
  });
  return `${lines.join("\n")}\n`;
}
