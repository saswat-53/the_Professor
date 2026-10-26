import type { Pixels, Rgb } from "./pose.js";

/** `truecolor` is 24-bit RGB; `256` is the xterm palette, for terminals (macOS Terminal.app) that don't do 24-bit. */
export type ColorDepth = "truecolor" | "256";

/** COLORTERM says 24-bit support is there; Apple's Terminal claims xterm-256color but ignores 24-bit codes. */
export function colorDepth(env: Record<string, string | undefined>): ColorDepth {
  return /truecolor|24bit/i.test(env.COLORTERM ?? "") && env.TERM_PROGRAM !== "Apple_Terminal" ? "truecolor" : "256";
}

const cube = (c: number) => Math.round((c / 255) * 5);

/** The SGR parameters that set a colour: `38`/`48` is foreground/background. */
function colorCode(layer: 38 | 48, [r, g, b]: Rgb, depth: ColorDepth): string {
  return depth === "truecolor" ? `${layer};2;${r};${g};${b}` : `${layer};5;${16 + 36 * cube(r) + 6 * cube(g) + cube(b)}`;
}

/**
 * Two pixel rows become one text row. The upper half block `▀` takes the top pixel as its foreground and
 * the bottom pixel as its background, which is how a character cell holds two square-ish pixels.
 * Returns one string per text row, each ending in a reset.
 */
export function renderPixels(pixels: Pixels, depth: ColorDepth): string[] {
  const lines: string[] = [];
  for (let y = 0; y + 1 < pixels.length; y += 2) {
    const upper = pixels[y]!;
    const lower = pixels[y + 1]!;
    let line = "";
    let style = "";
    for (let x = 0; x < upper.length; x++) {
      const top = upper[x];
      const bottom = lower[x];
      let fg = "39";
      let bg = "49";
      let ch = " ";
      if (top && bottom) {
        fg = colorCode(38, top, depth);
        ch = "▀";
        bg = colorCode(48, bottom, depth);
      } else if (top) {
        fg = colorCode(38, top, depth);
        ch = "▀";
      } else if (bottom) {
        fg = colorCode(38, bottom, depth);
        ch = "▄";
      }
      const next = `${fg};${bg}`;
      if (next !== style) {
        line += `\u001b[${next}m`;
        style = next;
      }
      line += ch;
    }
    lines.push(`${line}\u001b[0m`);
  }
  return lines;
}
