# 18: Stateful terminal-escape stripper

**What to build:** In terminal mode, nothing the model says can move the cursor, retitle the window, or hide text.

**Blocked by:** 17 (Plain and terminal output modes)

**Status:** ready-for-agent

- [ ] Control characters other than newline and tab are removed from the model's output in terminal mode
- [ ] The stripper is stateful across chunks: for every sequence in the test set, splitting the input at every possible position (including one character per chunk) gives the same output as the unsplit input
- [ ] The test set covers CSI sequences, OSC ended by BEL, OSC ended by ST, a bare ESC, and the 8-bit C1 characters (0x80 to 0x9F), including the single-byte CSI and OSC introducers
- [ ] Printable text, including non-ASCII letters, is unchanged
- [ ] An unterminated sequence at the end of the stream is discarded, not emitted
- [ ] Plain mode leaves the model's text untouched
