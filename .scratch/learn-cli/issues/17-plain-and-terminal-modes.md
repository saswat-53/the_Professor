# 17: Plain and terminal output modes

**What to build:** Output behaves for both humans at a terminal and scripts in a pipe.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** ready-for-agent

- [ ] When stdout is not a terminal, output contains no colour and no spinner, asserted by a test that checks piped output for ANSI escape codes
- [ ] Status, the Context report, warnings, and errors go to stderr; the explanation alone goes to stdout
- [ ] `NO_COLOR` disables colour in terminal mode
- [ ] When the output pipe closes early (for example piped to `head`), the process ends quietly with no stack trace
- [ ] Terminal mode adds colour to status lines only, never to the model's text
