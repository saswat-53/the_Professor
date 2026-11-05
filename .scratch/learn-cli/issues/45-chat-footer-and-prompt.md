# 45: Chat footer and prompt

**What to build:** A one-line footer printed above each chat prompt (project, focused reference, model, level, tokens, context fill), and a rule and `❯ ` prompt on a colour terminal, from a pure `renderFooter(stats, width)` in `src/cli/`.

**Blocked by:** 44 (Capture token usage into SessionStats)

**Status:** implemented, awaiting Linux CI (and 44's own CI run)

**Concepts to look up:** pure render functions, snapshot testing, ANSI SGR and CSI sequences, display width versus string length (wide and combining characters), `process.stdout.columns` and the resize event, Unicode bidi and zero-width characters.

## Behaviour

- [x] In a terminal chat, the footer is printed once, as dim text on one line, above each prompt, and once after a cancelled answer. Scrollback is untouched: nothing is pinned, no scroll region is set, no cursor save/restore is used (ADR 0004) (tested: one footer per prompt, once after a cancel, dim as a whole. Nothing pinned and no scroll-region or cursor save/restore code exists in the footer path, but no test asserts the absence of those sequences)
- [x] Fields, in order: `project · file:range · model · level · tokens · fill`; cost is never shown
- [x] `file:range` is the latest Reference (including one added with `@other.ts`, and the resolved file and range for a bare word); piped or clipboard input shows `stdin` or `clipboard` (tested: file, `@file` (last one wins, unchanged when an attach fails), piped, clipboard, `--diff`, `--blame`, and a bare word, both as the first reference and as `@word` in a follow-up, which shows the definition it resolved to, `src/util.ts:4-10`, never the word)
- [x] Tokens show reported figures plainly and estimated figures with `~`
- [x] Fill is shown for local endpoints only: the last request's input tokens over `--context-window`, labelled as the last request (for example `last 3.1k/4k (76%)`), dim, yellow above 70%, red above 90%; `~` when estimated. Hosted endpoints show no percentage and no window; there is no built-in window table (the ticket's example `last 3.1k/4k` is really `last 3.1k/4.1k`: 4096 is shown as 4.1k)
- [x] The width is read from `process.stdout.columns` before each render (so a resize is honoured) and measured as display width after stripping ANSI; the footer is always one line, never wrapping
- [x] On narrow terminals fields drop in this order: project, level, `file:range`, tokens; the file path is first truncated from the left (`…/auth.ts:40-60`) before it is dropped; below about 40 columns only `model` and fill remain (on a hosted endpoint: `model` alone); if even that does not fit, `model` is truncated from the right
- [x] The prompt is a rule above and `❯ ` on a colour terminal, and a plain `> ` otherwise (`NO_COLOR`, `TERM=dumb`); with `NO_COLOR` the footer prints uncoloured with no rule glyphs. Colour and mode come from the existing `outputMode` decision, not a second check
- [x] No footer is printed when stdin or stdout is not a terminal (chat already refuses to start then) (by the existing test "`--chat` without a terminal refuses with exit 2", which shows the chat never starts, so no footer is printed)
- [x] The owl banner and mascot are unchanged and the footer does not draw over them (no commit since the mascot landed touches src/cli/mascot or owl.ts. Tested with the animated owl on, in a pty: it claims the rows below its 8-row header as the scrolling area, the rule and footer then arrive uninterrupted inside it, with none of the owl's cursor save or addressing codes among them, and the terminal is handed back after the last footer. Reasoning: a frame is one write and so is the header, so a frame can land between them but never inside. Not covered: how it looks on screen in a real terminal emulator, and the static-owl path, whose banner is printed once and is unchanged)
- [x] `renderFooter` lives in `src/cli/`; core only supplies `SessionStats`

## Safety case: hostile names and no absolute paths

Project names, file names, reference labels and model names are untrusted text that ends up on the user's terminal.

- [x] A project directory or file whose name contains ESC, CSI or OSC sequences, BEL, newline, carriage return, tab, 8-bit C1 characters, bidi overrides or zero-width characters renders with all of those removed (the existing escape stripper is reused, not copied), and the footer is still one line (newline, CR, tab, bidi and zero-width are tested in `footer.test.ts`; 8-bit C1 characters rely on the escape stripper's own tests, since the stripper is reused)
- [x] Names containing wide (CJK, emoji) and combining characters are measured by display width, so the footer never exceeds the terminal width; a very long name (thousands of characters) is truncated, never wrapped (tested at every width with wide, combining and emoji names, and with names of 5,000 characters in the project, the file and the model, in ASCII, CJK and emoji: never wider than the terminal, never more than one line; a very long path keeps as many trailing directories as fit, then the file name and lines)
- [x] An empty name after stripping falls back to a fixed placeholder, not a blank field
- [x] No absolute path ever appears in the footer: paths are project-relative; a symlink is shown as the project-relative path of the file it points to (core resolves links to their real path, so `link.ts` shows as `real.ts`); a path outside the project root is refused before it could be shown; the home directory and the `--root` value are never printed (tested with a plain file, a symlink, an absolute-path argument, and `--root` typed both absolute and relative (`..`): the typed value and the parent directories never appear; the temp and home directories never appear either)
- [x] Tests build real temporary directories with hostile names (seam 2, CLI as a black box, a fake server) and assert on the bytes written to the terminal stream, not only on the visible text

## Break it

- [x] Skip the stripper for the project name: the hostile-name test must fail (mutant "names not cleaned" fails the hostile-name tests)
- [x] Measure with `string.length` instead of display width: the wide-character test must fail (fails four tests)
- [x] Read the width once at startup: the resize test must fail (fails the resize test)
- [x] Print the absolute path when the relative one is empty: the no-absolute-path test must fail (the mutant actually run was "show the project as its absolute path", which fails all three hostile-name and path tests)
- [x] Let colour be decided by a second check: the `NO_COLOR`/`dumb` test must fail (the mutant "colour ignores NO_COLOR and dumb" fails both no-colour tests)

## Glossary

- [x] `GLOSSARY.md` has a **Footer** entry covering the field order, the drop order, the display-width rule, the escape-stripping rule and the local-only fill

## CI

This ticket depends on terminal width, resize and process timing, so it is not done until a green Linux CI run (Node 22, 24 and 26 on ubuntu-24.04) is recorded here. Prefer waiting on observable output over fixed sleeps, and make a failure say when the test setup, not the product, is at fault. Until then the status stays "implemented, awaiting Linux CI".

## Comments

### Progress (commits b7c54bd, ff634d1, 4dc8865, 348c23b, 17f7931, e349de1, 6d16a02, 3089086, a4f0651, 39f86ac, 96df95c)

Local evidence only (macOS): the full suite passed 6 of 6 and 8 of 8 consecutive runs after the fixes below. Not yet done:

- [ ] A green Linux CI run (Node 22, 24 and 26 on ubuntu-24.04), with `test/cli-usage.test.ts` run several times (it now includes the animated-owl test, which depends on timer-driven frames): the chat tests drive a pty, and the cancel and resize tests depend on how output is chunked and on the window-size signal arriving before the next footer is built.

Things found along the way:

- A pty test that waits on text and then waits on text that can arrive in the same read is racy: the helper marks its place after everything read so far. The first version of the cancel test failed about 3 runs in 8 for that reason (the product was right). It now waits for the next prompt directly. Other pty tests were checked and do not have that shape; older ones in `cli-chat.test.ts` have not been audited.
- On a terminal that is not `TERM=dumb`, readline writes its own cursor-control codes in front of the prompt, so a test cannot wait for `\n❯ ` or `\n> `; the colour tests wait for `❯ ` or for the footer text instead.
- Not part of this ticket: the Context report prints a file name raw, so a hostile file name can put escape sequences on the terminal through it (the footer is clean). Suggested as its own ticket.

