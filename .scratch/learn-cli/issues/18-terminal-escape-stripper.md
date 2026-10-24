# 18: Stateful terminal-escape stripper

**What to build:** In terminal mode, nothing the model says can move the cursor, retitle the window, or hide text.

**Blocked by:** 17 (Plain and terminal output modes)

**Status:** done

- [x] Control characters other than newline and tab are removed from the model's output in terminal mode
- [x] The stripper is stateful across chunks: for every sequence in the test set, splitting the input at every possible position (including one character per chunk) gives the same output as the unsplit input
- [x] The test set covers CSI sequences, OSC ended by BEL, OSC ended by ST, a bare ESC, and the 8-bit C1 characters (0x80 to 0x9F), including the single-byte CSI and OSC introducers
- [x] Printable text, including non-ASCII letters, is unchanged
- [x] An unterminated sequence at the end of the stream is discarded, not emitted
- [x] Plain mode leaves the model's text untouched

## Comments

- `createEscapeStripper()` in `src/cli/escape-stripper.ts` is a state machine (ground, esc, csi, string, string-esc) returned as a closure, so state carries across chunks. Applied in `main.ts` when stdout is a TTY; it is separate from `NO_COLOR`, which only concerns colour.
- Choices: an ESC (or a CAN/SUB) breaks off a CSI or OSC and is read afresh, so a "terminated by something else" OSC cannot swallow the text after it; `\r` and DEL are removed with the other control characters; `ESC` followed by a printable character is a two-byte escape and both are dropped.
- Tests: every case is run unsplit, split at every position, and one character per chunk. A spawned-CLI test pins that plain (piped) mode leaves escapes untouched. Terminal-mode wiring was checked by hand on a pty (`script`): the output was `abcd`. No automated pty test (agreed seam).
