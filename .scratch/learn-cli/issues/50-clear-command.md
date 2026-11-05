# 50: `/clear` starts a fresh chat

**What to build:** A chat command that empties the Session and the screen, so the reader can start over without leaving and re-running `learn`.

**Blocked by:** 49 (it restarts the owl)

**Status:** implemented, awaiting Linux CI

**Concepts to look up:** erase-in-display (`ESC[2J`) and erase-saved-lines (`ESC[3J`), state reset, table-driven commands.

## Behaviour

- [x] `/clear` is one entry in the command table, so `/help`, `--help` and the README list it from the one source
- [x] `Session.clear()` forgets every turn, the usage and the focused file; the next question is turn 1 and nothing earlier is sent again. The endpoint, model and level stay, and the model is told, as in an open chat, that it may be asked a general question or shown code (the guidance is added once however often it is cleared)
- [x] The screen and the terminal's saved lines are erased (`ESC[3J ESC[2J ESC[H`), so nothing of the old chat is left to scroll up to. Notes saved on disk stay
- [x] The owl in the conversation is drawn again and animates, with its room counted afresh; the pinned owl stays and its scrolling area is blanked; the still owl is shown again
- [x] The footer is back to 0 tokens, and `/quiz` and `/save` say there is nothing yet

## Tests

- [x] Session: forgets turns, usage and focus, sends no history after, keeps endpoint and model, does not stack the guidance, harmless when never started
- [x] Command table: the new entry, the exact generated section, and the "effects" map (typed by the table's names, so a command without a stated effect does not compile)
- [x] End to end: after `/clear` the request carries only the system prompt and the new question; on the default owl the erase sequence goes out and the owl is drawn again

## Comments

`/clear` also erases the terminal's saved lines, because a screen cleared without that still scrolls back to the old chat. A clear that keeps the reader's scrollback could be a later option.
