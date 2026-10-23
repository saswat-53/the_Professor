# 04: Reference grammar: line and range

**What to build:** `learn path:N` and `learn path:N-M` explain exactly that line or range. Anything malformed produces a message that says what to fix.

**Blocked by:** 03 (File reading rules)

**Status:** done

- [x] `path:N` makes the Excerpt that single line; `path:N-M` makes it lines N to M inclusive, 1-based, counted after CRLF normalisation
- [x] Line 0, negative numbers, non-integers, and reversed ranges are each rejected with a distinct clear message and exit code 2
- [x] A line or range past the end of the file is rejected with a message that shows the file's real line count
- [x] If a file literally named like `a:b` exists, `learn a:b` reads that file instead of parsing a line number
- [x] A bare word such as `learn debounce` prints a "not supported yet" message, not a crash
- [x] The Reference type in core is open to a new kind: adding a kind means adding a resolver-table entry, not editing the resolvers already there (shown by a test that registers a fake kind). Callers of `buildRequest` cannot yet pass their own resolvers; ticket 35 adds that

## Notes

- Decide on purpose how a lone `\r` is treated. Ticket 03 normalises only `\r\n`, so a bare CR stays in the text; line counting here must match what editors show.

## Comments

- Grammar lives in `src/core/reference.ts`: `parseReference` (an existing file under the literal name wins; then `path:SPEC`; then bare word if no `/`, `\` or `.`), `defaultResolvers` keyed by `kind`, and `resolveReference`. A new kind only adds a resolver entry; `test/reference-grammar.test.ts` registers a fake one.
- Bad input throws `UsageError` (`src/core/errors.ts`); `explain` tags the error event with `kind: "usage"` and the CLI exits 2. Ticket 05 should fold this into the full typed-error set.
- A lone `\r` counts as a line break (as editors show it).
- Excerpt only for now; surrounding context comes in ticket 10.
- Non-integers, an empty spec, open-ended ranges (`5-`) and three-part ranges each have their own message. A token not found as a file says "not found as a file" before "word references are not supported yet", so a typo'd name is not mistaken for a word.
- Known, left for later: a nonexistent Windows path such as `C:\x` would be split at its colon; it is outside the macOS/Linux floor.
- The request header is `File: <label>` where the label is the path as typed (ticket 08 makes it project-relative). The `kind: "usage"` field on error events exists only to carry exit code 2 until ticket 05.
