# 17: Plain and terminal output modes

**What to build:** Output behaves for both humans at a terminal and scripts in a pipe.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** done

- [x] When stdout is not a terminal, output contains no colour and no spinner, asserted by a test that checks piped output for ANSI escape codes
- [x] Status, the Context report, warnings, and errors go to stderr; the explanation alone goes to stdout
- [x] `NO_COLOR` disables colour in terminal mode
- [x] When the output pipe closes early (for example piped to `head`), the process ends quietly with no stack trace
- [x] Terminal mode adds colour to status lines only, never to the model's text
