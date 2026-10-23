# 10: Context: Enclosing-block interface, fallback window, imports

**What to build:** The Excerpt arrives with useful Context: the file's imports and either an Enclosing block or a fixed window of surrounding lines. The block finder is an interface so a better one can replace it later.

**Blocked by:** 04 (Reference grammar: line and range)

**Status:** ready-for-agent

- [ ] The Enclosing-block finder is defined as an interface, with a built-in implementation that finds nothing, so every file takes the fallback path
- [ ] When no Enclosing block is found, the Context is the 25 lines on either side of the Excerpt (fewer at the file's edges)
- [ ] The file's import block is included in the Context
- [ ] Contract tests are written against the interface, not the implementation, covering found, not found, and nested cases, so a future finder can reuse them
- [ ] The text sent to the fake server shows the Excerpt clearly separated from its Context

## Comments

- Decision: each line is sent once. The Context holds the lines *before* and *after* the Excerpt (inside the Enclosing block or the 25-line window), never the Excerpt again. Imports are all-or-nothing: if the import block reaches into the nearby lines, the nearby lines grow upward to take it whole. Ticket 13 trims farthest-first from the Excerpt over these two sides, and counts the Excerpt once, toward its 50% limit.
