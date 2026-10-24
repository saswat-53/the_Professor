# 18: Stateful terminal-escape stripper

**What to build:** In terminal mode, nothing the model says can move the cursor, retitle the window, or hide text.

**Blocked by:** 17 (Plain and terminal output modes)

**Status:** done

- [x] Control characters other than newline and tab are removed from the model's output in terminal mode
- [x] The stripper is stateful across chunks: for every sequence in the test set, splitting the input at every possible position (including one character per chunk) gives the same output as the unsplit input
- [x] The test set covers CSI sequences, OSC ended by BEL, OSC ended by ST, a bare ESC (which, as in a terminal, also takes the character after it), and the 8-bit C1 characters (0x80 to 0x9F), including the single-byte CSI and OSC introducers
- [x] Printable text, including non-ASCII letters, is unchanged
- [x] An unterminated sequence at the end of the stream is discarded, not emitted
- [x] Plain mode leaves the model's text untouched

## Comments

- `createEscapeStripper()` in `src/cli/escape-stripper.ts` is a state machine (ground, esc, csi, string, string-esc) returned as a closure, so state carries across chunks. Applied in `main.ts` when stdout is a TTY; it is separate from `NO_COLOR`, which only concerns colour.
- Choices: an ESC (or a CAN/SUB) breaks off a CSI or OSC and is read afresh, so a "terminated by something else" OSC cannot swallow the text after it; `\r` and DEL are removed with the other control characters; `ESC` followed by a printable character is a two-byte escape and both are dropped.
- Tests: every case is run unsplit, split at every position, and one character per chunk. A spawned-CLI test pins that plain (piped) mode leaves escapes untouched. Terminal-mode wiring was checked by hand on a pty (`script`): the output was `abcd`. No automated pty test (agreed seam).
- Added after review: bidi marks and overrides, zero-width characters (including ZWJ and ZWNJ), line and paragraph separators and the BOM are also removed in terminal mode. Cost: an emoji joined with ZWJ shows as its parts, and Persian/Indic text that relies on ZWNJ loses it on screen. Not in the original five criteria.
- Review follow-ups: an unterminated sequence holds back at most `MAX_HELD` (256) characters, then is dropped and output resumes, so a stray `ESC ]` cannot hide a whole reply (the "discarded at the end of the stream" criterion still holds for anything shorter). Invisible characters are U+200B to U+200F, U+202A to U+202E, U+2060, U+2066 to U+2069 and U+FEFF; U+2028/2029, Arabic and Hebrew pass through (tested). `outputMode` in `src/cli/output.ts` is now the one terminal decision, for colour and stripping alike (stripping stays on under `NO_COLOR`). "Plain mode" and "terminal mode" are in the glossary. The `ESC b` swallowing `b` is deliberate; the bare-ESC criterion's wording was corrected.
- Supersedes the earlier comment above: the first review-fix commit removed U+2028/2029 and U+061C/U+2061-2064 too; those now pass through, to match the agreed list.
- Correction to the invisible-character list: ZWJ and ZWNJ (U+200C, U+200D) are real text (emoji sequences, Persian, Indic scripts) and now pass through, as do LRM and RLM (U+200E, U+200F), which hide nothing. Still stripped: U+200B, U+202A to U+202E, U+2060, U+2066 to U+2069, U+FEFF. Tests pin that a ZWJ family emoji, a flag, Persian with ZWNJ, Malayalam, Arabic and Hebrew pass unchanged.
- Re-checked on a pty after the `outputMode` change (a fake server sending a title OSC split across chunks, SGR, CR, U+202E, ZWJ emoji, Persian ZWNJ): in a terminal the escapes, CR and U+202E are gone, ZWJ and ZWNJ kept, status line coloured; with `NO_COLOR=1` stripping is the same and there is no colour; piped to `cat` the text arrives raw.
