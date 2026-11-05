# 45: Chat footer and prompt

**What to build:** A one-line footer printed above each chat prompt (project, focused reference, model, level, tokens, context fill), and a rule and `❯ ` prompt on a colour terminal, from a pure `renderFooter(stats, width)` in `src/cli/`.

**Blocked by:** 44 (Capture token usage into SessionStats)

**Status:** blocked by 44

**Concepts to look up:** pure render functions, snapshot testing, ANSI SGR and CSI sequences, display width versus string length (wide and combining characters), `process.stdout.columns` and the resize event, Unicode bidi and zero-width characters.

## Behaviour

- [ ] In a terminal chat, the footer is printed once, as dim text on one line, above each prompt, and once after a cancelled answer. Scrollback is untouched: nothing is pinned, no scroll region is set, no cursor save/restore is used (ADR 0004)
- [ ] Fields, in order: `project · file:range · model · level · tokens · fill`; cost is never shown
- [ ] `file:range` is the latest Reference (including one added with `@other.ts`, and the resolved file and range for a bare word); piped or clipboard input shows `stdin` or `clipboard`
- [ ] Tokens show reported figures plainly and estimated figures with `~`
- [ ] Fill is shown for local endpoints only: the last request's input tokens over `--context-window`, labelled as the last request (for example `last 3.1k/4k (76%)`), dim, yellow above 70%, red above 90%; `~` when estimated. Hosted endpoints show no percentage and no window; there is no built-in window table
- [ ] The width is read from `process.stdout.columns` before each render (so a resize is honoured) and measured as display width after stripping ANSI; the footer is always one line, never wrapping
- [ ] On narrow terminals fields drop in this order: project, level, `file:range`, tokens; the file path is first truncated from the left (`…/auth.ts:40-60`) before it is dropped; below about 40 columns only `model` and fill remain (on a hosted endpoint: `model` alone); if even that does not fit, `model` is truncated from the right
- [ ] The prompt is a rule above and `❯ ` on a colour terminal, and a plain `> ` otherwise (`NO_COLOR`, `TERM=dumb`); with `NO_COLOR` the footer prints uncoloured with no rule glyphs. Colour and mode come from the existing `outputMode` decision, not a second check
- [ ] No footer is printed when stdin or stdout is not a terminal (chat already refuses to start then)
- [ ] The owl banner and mascot are unchanged and the footer does not draw over them
- [ ] `renderFooter` lives in `src/cli/`; core only supplies `SessionStats`

## Safety case: hostile names and no absolute paths

Project names, file names, reference labels and model names are untrusted text that ends up on the user's terminal.

- [ ] A project directory or file whose name contains ESC, CSI or OSC sequences, BEL, newline, carriage return, tab, 8-bit C1 characters, bidi overrides or zero-width characters renders with all of those removed (the existing escape stripper is reused, not copied), and the footer is still one line
- [ ] Names containing wide (CJK, emoji) and combining characters are measured by display width, so the footer never exceeds the terminal width; a very long name (thousands of characters) is truncated, never wrapped
- [ ] An empty name after stripping falls back to a fixed placeholder, not a blank field
- [ ] No absolute path ever appears in the footer: paths are project-relative; a symlink is shown by the project-relative path it was referenced by; a path that cannot be made relative to the project root shows the file name only; the home directory and `--root` value are never printed
- [ ] Tests build real temporary directories with hostile names (seam 2, CLI as a black box, a fake server) and assert on the bytes written to the terminal stream, not only on the visible text

## Break it

- [ ] Skip the stripper for the project name: the hostile-name test must fail
- [ ] Measure with `string.length` instead of display width: the wide-character test must fail
- [ ] Read the width once at startup: the resize test must fail
- [ ] Print the absolute path when the relative one is empty: the no-absolute-path test must fail
- [ ] Let colour be decided by a second check: the `NO_COLOR`/`dumb` test must fail

## Glossary

- [x] `GLOSSARY.md` has a **Footer** entry covering the field order, the drop order, the display-width rule, the escape-stripping rule and the local-only fill

## CI

This ticket depends on terminal width, resize and process timing, so it is not done until a green Linux CI run (Node 22, 24 and 26 on ubuntu-24.04) is recorded here. Prefer waiting on observable output over fixed sleeps, and make a failure say when the test setup, not the product, is at fault. Until then the status stays "implemented, awaiting Linux CI".

## Comments
