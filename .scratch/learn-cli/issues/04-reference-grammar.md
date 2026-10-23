# 04: Reference grammar: line and range

**What to build:** `learn path:N` and `learn path:N-M` explain exactly that line or range. Anything malformed produces a message that says what to fix.

**Blocked by:** 03 (File reading rules)

**Status:** done

- [x] `path:N` makes the Excerpt that single line; `path:N-M` makes it lines N to M inclusive, 1-based, counted after CRLF normalisation
- [x] Line 0, negative numbers, non-integers, and reversed ranges are each rejected with a distinct clear message and exit code 2
- [x] A line or range past the end of the file is rejected with a message that shows the file's real line count
- [x] If a file literally named like `a:b` exists, `learn a:b` reads that file instead of parsing a line number
- [x] A bare word such as `learn debounce` prints a "not supported yet" message, not a crash
- [x] The Reference type in core is open to a new kind: adding a word kind later needs no change to the resolver's callers (shown by a test that registers a fake kind)

## Notes

- Decide on purpose how a lone `\r` is treated. Ticket 03 normalises only `\r\n`, so a bare CR stays in the text; line counting here must match what editors show.

## Comments

- Grammar lives in `src/core/reference.ts`: `parseReference` (an existing file under the literal name wins; then `path:SPEC`; then bare word if no `/`, `\` or `.`), `defaultResolvers` keyed by `kind`, and `resolveReference`. A new kind only adds a resolver entry; `test/reference-grammar.test.ts` registers a fake one.
- Bad input throws `UsageError` (`src/core/errors.ts`); `explain` tags the error event with `kind: "usage"` and the CLI exits 2. Ticket 05 should fold this into the full typed-error set.
- Excerpt only for now; surrounding context comes in ticket 10.
