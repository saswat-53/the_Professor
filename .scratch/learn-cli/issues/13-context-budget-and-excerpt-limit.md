# 13: Context budget and Excerpt limit

**What to build:** Big files can't blow the model's window or the user's bill: the Context is trimmed to a budget, and an Excerpt that is itself too large is refused with advice.

**Blocked by:** 10 (Context: Enclosing-block interface, fallback window, imports), 05 (Typed errors and exit codes)

**Status:** done

- [x] The default budget is 24,000 characters for hosted endpoints and 8,000 when the base URL host is localhost, 127.0.0.1, or ::1; a budget setting can override it (flag only for now; ticket 15 adds env and config)
- [x] Over budget, Context is dropped farthest from the Excerpt first, including inside an Enclosing block
- [x] The Excerpt is never trimmed; if it exceeds 50% of the active budget the run fails by raising `ContextTooLongError`, exit code 3 (shown by a CLI test), and a "narrow your range" hint
- [x] A minified single-line file is refused with that same message
- [x] Tests assert the exact lines kept and dropped for a known file

## Comments

- From ticket 10: Context carries `before` and `after` sections (see `src/core/context.ts`), so no line is sent twice and the Excerpt is counted once. Trim each side from the Excerpt outward. Imports are one whole section: drop it entirely or keep it, never cut it.

- From ticket 10: the nearby lines can start above the usual 25-line window when an import block reaches into them (they grow upward to take it whole), so a file with a very long import block gives a large Context. Rule: if keeping the imports whole would exceed the budget, drop the imports whole, shrink the nearby lines back to their normal span, and say so in the Context report. Never send half an import block.

- Decision: the Budget counts code only (the Excerpt's text, plus each Context line and its newline); labels, fences and the system prompt are extra. Length is JavaScript string length (an emoji counts as 2): an estimate, not a token count. Written in the glossary's Budget entry.
- Decision: the refusal names the limit and where it came from ("24,000-character budget (hosted default)", "local default", or "setting"); the CLI adds a `--context-budget` hint, core does not. On a local endpoint a whole-file Reference over 4,000 characters is therefore refused.
- Decision: imports are dropped whole and first. When they had straddled the nearby lines, the lines shrink back to their normal span minus the tail of the import statement (they restart on the first line after it), so a half import is never sent.
- Decision: the trim keeps the nearest lines, one side then the other, ties to the side before the Excerpt, and stops at the first line that does not fit (so one oversized line ends the walk on both sides). Each side stays unbroken. The logic is `fitToBudget` in `src/core/budget.ts`, pure and tested apart from `gatherContext`.
- Decision: the core validates the budget too (`isValidBudget`, `UsageError`), shared with the CLI flag check, so any frontend gets it.
- Changed tests: two in `file-reading.test.ts` raise the budget so they still test the 1 MB and minified reading rules; no assertion was weakened. Refusal of a minified file at the default budgets is tested in `context-budget.test.ts`.
- Handed to ticket 14: `Context.dropped` carries what was dropped as data only; nothing prints it yet. The import-tail lines are not in `dropped.lines`; the decision to count them is recorded in ticket 14.
- Handed to ticket 15: `LEARN_CONTEXT_BUDGET` and the config key; the flag is the only source for now.
