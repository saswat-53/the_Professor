# 17: Plain and terminal output modes

**What to build:** Output behaves for both humans at a terminal and scripts in a pipe.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** done

- [x] When stdout is not a terminal, output contains no colour and no spinner, asserted by a test that checks piped output for ANSI escape codes
- [x] Status, the Context report, warnings, and errors go to stderr; the explanation alone goes to stdout
- [x] `NO_COLOR` disables colour in terminal mode
- [x] When the output pipe closes early (for example piped to `head`), the process ends quietly with no stack trace
- [x] Terminal mode adds colour to status lines only, never to the model's text

## Comments

- Added beyond the five criteria: a closed stderr is handled like a closed stdout, `--help`/`-h` and `--version`/`-v` print to stdout and exit 0, and a closed pipe exits with the code of any failure already recorded (else 0), tested with a refused file (exit 3).
- Left deliberately: `process.exit` in the pipe handlers (waiting for a closed pipe to drain can hang); `--help --bogus` exits 2, since the argument parser rejects the unknown option before help is looked at; a failure is recorded only once it is found, so a pipe that closes before that point exits 0.
- Follow-up: the usage text is hand-written and can drift from the `options` map in `src/cli/main.ts`. Generate it from the map the next time a flag is added.
- Terminal-mode colour was checked by hand on a pty (`script`): warnings yellow, Context report dim; plain with `NO_COLOR=1`, `TERM=dumb`, or piped; an empty `NO_COLOR=` still colours. No automated pty test.
- The exit-code table, `--help` and `--version` documentation moved to ticket 23 (README).
