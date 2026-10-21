# 04: Reference grammar: line and range

**What to build:** `learn path:N` and `learn path:N-M` explain exactly that line or range. Anything malformed produces a message that says what to fix.

**Blocked by:** 03 (File reading rules)

**Status:** ready-for-agent

- [ ] `path:N` makes the Excerpt that single line; `path:N-M` makes it lines N to M inclusive, 1-based, counted after CRLF normalisation
- [ ] Line 0, negative numbers, non-integers, and reversed ranges are each rejected with a distinct clear message and exit code 2
- [ ] A line or range past the end of the file is rejected with a message that shows the file's real line count
- [ ] If a file literally named like `a:b` exists, `learn a:b` reads that file instead of parsing a line number
- [ ] A bare word such as `learn debounce` prints a "not supported yet" message, not a crash
- [ ] The Reference type in core is open to a new kind: adding a word kind later needs no change to the resolver's callers (shown by a test that registers a fake kind)
