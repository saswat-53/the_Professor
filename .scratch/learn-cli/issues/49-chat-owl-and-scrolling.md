# 49: The chat's owl, and scrolling back through a chat

**What to build:** The animated owl no longer costs the reader their scrollback or their text selection. By default it sits at the top of the conversation and scrolls away with it; `LEARN_OWL=pinned` keeps it fixed to the top and the chat scrolls itself.

**Blocked by:** none

**Status:** implemented, awaiting Linux CI (the new tests use a pseudo-terminal)

**Concepts to look up:** terminal scroll regions (DECSTBM), scrollback, alternate screen, mouse reporting (xterm 1000/1006), cursor position tracking, escape sequences.

## Why

A pinned owl is a scroll region below its rows. A terminal throws away a line that scrolls out of the top of such a region, so a long answer lost its first lines and the reader could not scroll back, or select and copy text.

## Behaviour

- [x] Default (`LEARN_OWL` unset): the owl is drawn at the top of a cleared screen and the chat flows below it as ordinary output; no scroll region, no mouse capture. The terminal's own scrolling, selection and copying all work
- [x] It animates while it is on screen. The cursor is followed from what is written to the chat's streams (`cursor-tracker.ts`); a few rows before the text would push the owl off, it draws one last still frame and stops for good. A resize stops it too
- [x] Its own drawing is never counted as chat text, even though the output it draws on is one of the streams watched
- [x] `LEARN_OWL=pinned`: the old pinned owl, now with scrolling inside the app (`scrollback.ts`): PageUp and PageDown, the trackpad or mouse wheel (the terminal is asked to report the mouse while the chat runs, and gets it back at the end, also on exit), and up and down arrows one line at a time once scrolled back. The bottom row says how far back the reader is; End, Esc or any other key returns to the live view. Scrolling waits while an answer streams
- [x] `LEARN_MOUSE=off` skips the mouse; `LEARN_OWL=static|off` unchanged
- [x] README says how to copy text with the mouse captured (Option or Shift while dragging; in VS Code the `macOptionClickForcesSelection` setting)

## Tests

- [x] Unit: cursor tracker, wrapping and the screen log, the scrollback viewer, mouse-report parsing (both encodings, split across reads), the input filter, the inline owl driver (including "does not count its own drawing")
- [x] End to end on a pseudo-terminal: pinned owl scrolls with keys, wheel and arrows and never types the reports; the default owl sets no region and takes no mouse

## Comments

Not yet seen in every terminal. The pinned mode relies on the terminal reporting the wheel; Terminal.app's support for the SGR encoding was not checked, so the older encoding is parsed too.
