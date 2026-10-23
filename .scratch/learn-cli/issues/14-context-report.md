# 14: Context report (the gate)

**What to build:** Before anything is sent, `learn` tells the user exactly what it is about to send. This ticket is the gate: it is blocked by typed errors (05), project root (08), Sensitive files (09), and the budget (13), so being blocked by it means being blocked by all of them. Anything that sends real files to a provider is blocked by this ticket.

**Blocked by:** 05 (Typed errors and exit codes), 08 (Project root and path escape (Q27)), 09 (Sensitive files (Q2, ADR 0001)), 13 (Context budget and Excerpt limit)

**Status:** done

- [x] A Context report on stderr lists each file and line range sent, the method that found the Enclosing block ("heuristic" or "fallback window"), and anything dropped for budget
- [x] The report appears before the first streamed output and never on stdout
- [x] When the endpoint is local, the report includes a note that Ollama's context window is small by default and how to raise it: the app's context-length slider, or starting the server with the context-length environment variable, checked with `ollama ps`
- [x] The report is built from the same data as the request, shown by a test that compares the two
- [x] A file refused by a Sensitive-file rule appears in the report as refused with the rule's name, not as content

- From ticket 13 (decision): when dropped imports had straddled the nearby lines, the import statement's tail lines that sat inside the normal window are removed but are not counted in `Context.dropped.lines` today, so the report would understate by those lines. Decision: count them, as an explicit `importTail` number on `Dropped` (computed in `fitToBudget`, `src/core/budget.ts`), and have the report print them with the imports entry (for example "imports dropped, including 1 line of the import statement inside the window") so every omitted line in the file can be accounted for. The report also names the Budget and its source ("local endpoint budget 8,000"); if it needs the source, pass the `Budget` object to `gatherContext` instead of the bare number.
- From ticket 13 (reminder): `describe()` in `src/cli/main.ts` is an `instanceof` chain with two hints; switch to a lookup keyed by error type when a third hint arrives.

## Comments

- Decision: `prepareRequest` (core/explain.ts) returns `{ request, report }`; `buildRequest` is kept as a wrapper. `ContextReport` is data (core/report.ts: `buildContextReport`, `refusedReport`, `formatContextReport`) and is built from the same Excerpt and Context that `formatRequest` uses. `explain` yields it as a `context-report` event before any text, carrying the `ContextReport` data (not rendered text); the CLI formats it and writes it to stderr. `--dry-run` prints it too.
- Decision: `Dropped.importTail` counts the straddling import statement's lines inside the window, separate from `lines`; `Budget` is passed to the report from `resolveBudget`, so `gatherContext` still takes the bare number.
- Decision: a refused Sensitive file yields a refused report event and then the error, so the rule shows twice on the terminal (report line, then the error message).
- Changed test: `cli-errors.test.ts` "starts the error on a fresh line" now expects the report first, then a blank line and the error; the fresh-line check is kept.
- Not done: `describe()` in `src/cli/main.ts` still has two hints, so no lookup yet.
- Decision: the budget line reads "local endpoint budget 8,000 characters (default)" (also "hosted endpoint budget 24,000 ...", and "budget 500 characters (setting)").
- Added: a table test of report vs request over six cases (imports kept, dropped whole, dropped with an import tail, Enclosing block, fallback window, trimmed), and a canary test on the report path (`.env`, gitignored file and ordinary file; `--dry-run`, `--show-prompt`, streaming; no canary, API-key canary or temp HOME path in stdout, stderr, the request body or the report events). Ticket 21 still owns the `--allow-sensitive` canary case and the full gate.
