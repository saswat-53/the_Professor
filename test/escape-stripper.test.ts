import { describe, expect, it } from "vitest";
import { createEscapeStripper } from "../src/cli/escape-stripper.js";

const ESC = "\u001b";
const BEL = "\u0007";

/** Feeds the chunks through one stripper, as the CLI feeds streamed text, and joins what comes out. */
const strip = (chunks: string[]) => {
  const feed = createEscapeStripper();
  return chunks.map(feed).join("");
};

/** Every way to cut the input into two chunks, plus one character per chunk. */
const splits = (input: string) => [
  ...Array.from({ length: input.length + 1 }, (_, i) => [input.slice(0, i), input.slice(i)]),
  [...input],
];

// Each case: the input, and what a terminal user should see of it.
const cases: { name: string; input: string; out: string }[] = [
  { name: "a colour CSI sequence", input: `a${ESC}[31mred${ESC}[0mb`, out: "aredb" },
  { name: "a CSI with parameters and an intermediate", input: `a${ESC}[1;2 qb`, out: "ab" },
  { name: "a cursor-move CSI", input: `a${ESC}[2J${ESC}[Hb`, out: "ab" },
  { name: "an OSC ended by BEL (window title)", input: `a${ESC}]0;pwned${BEL}b`, out: "ab" },
  { name: "an OSC ended by ST (ESC backslash)", input: `a${ESC}]8;;http://x${ESC}\\link${ESC}]8;;${ESC}\\b`, out: "alinkb" },
  { name: "a DCS ended by ST", input: `a${ESC}Pq#0;2${ESC}\\b`, out: "ab" },
  { name: "a bare ESC before text", input: `a${ESC}b`, out: "a" },
  { name: "a two-byte escape (ESC c, reset)", input: `a${ESC}cb`, out: "ab" },
  { name: "an escape with an intermediate (ESC ( B)", input: `a${ESC}(Bb`, out: "ab" },
  { name: "a bare ESC before a newline", input: `a${ESC}\nb`, out: "a\nb" },
  { name: "an ESC inside a CSI starting a new sequence", input: `a${ESC}[1${ESC}[2Jb`, out: "ab" },
  { name: "an ESC inside an OSC that is not ST (it ends the OSC and starts a new sequence)", input: `a${ESC}]0;x${ESC}[31mshown${BEL}b`, out: "ashownb" },
  { name: "the single-byte CSI introducer (0x9B)", input: "a\u009b31mb", out: "ab" },
  { name: "the single-byte OSC introducer (0x9D) ended by BEL", input: `a\u009d0;pwned${BEL}b`, out: "ab" },
  { name: "the single-byte OSC introducer (0x9D) ended by 8-bit ST (0x9C)", input: "a\u009d0;pwned\u009cb", out: "ab" },
  { name: "the single-byte DCS introducer (0x90)", input: "a\u0090q\u009cb", out: "ab" },
  { name: "every other C1 character", input: "a\u0080\u0085\u008e\u0099\u009cb", out: "ab" },
  { name: "control characters except newline and tab", input: "a\u0000\u0007\u0008\r\u000b\u000c\u007fb\tc\nd", out: "ab\tc\nd" },
  { name: "text hidden by carriage return and backspace", input: "safe\rEVIL\b\b\b", out: "safeEVIL" },
  { name: "non-ASCII text, including an emoji", input: "héllo wörld — 日本語 🙂 ÿ", out: "héllo wörld — 日本語 🙂 ÿ" },
  { name: "plain text with a newline and a tab", input: "a\n\tb\n", out: "a\n\tb\n" },
  { name: "an unterminated CSI at the end", input: `done${ESC}[31`, out: "done" },
  { name: "an unterminated OSC at the end", input: `done${ESC}]0;title`, out: "done" },
  { name: "an OSC whose ST is cut after the ESC", input: `done${ESC}]0;title${ESC}`, out: "done" },
  { name: "a lone ESC at the end", input: `done${ESC}`, out: "done" },
  { name: "an unterminated 8-bit OSC at the end", input: "done\u009d0;title", out: "done" },
];

describe("createEscapeStripper", () => {
  for (const { name, input, out } of cases) {
    describe(name, () => {
      it("is removed in one chunk", () => expect(strip([input])).toBe(out));
      it("gives the same output split at every position and one character per chunk", () => {
        for (const chunks of splits(input)) expect(strip(chunks)).toBe(out);
      });
    });
  }

  it("keeps state across chunks, so text after a sequence ends is shown", () => {
    const feed = createEscapeStripper();
    expect(feed(`a${ESC}]0;ti`)).toBe("a");
    expect(feed("tle")).toBe("");
    expect(feed(`${BEL}b`)).toBe("b");
  });

  it("starts each stripper in the ground state", () => {
    createEscapeStripper()(`${ESC}]0;`);
    expect(createEscapeStripper()("plain")).toBe("plain");
  });
});
