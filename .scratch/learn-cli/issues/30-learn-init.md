# 30: learn init wizard

**What to build:** A new user is guided to a working global config without editing a file by hand.

**Blocked by:** 29 (Switch to commander and subcommand routing), 15 (Settings resolution and the global config file)

**Status:** implemented, awaiting Linux CI (pty tests)

- [x] `learn init` asks for provider preset, base URL, model, the name of the key variable, level, and notes directory, then writes the global config
- [x] It refuses to run when there is no terminal, exiting 2 with a message
- [x] Ctrl-C leaves any existing config untouched
- [x] The config is written atomically with owner-only permissions (a test interrupts the write and finds no partial file)
- [x] It never asks for the key value; it tells the user which variable to export
- [x] An optional test request confirms the setup, and failures are reported with the typed error messages

## Comments

- Done: `src/core/init.ts` (presets, `renderConfig` via the TOML library so answers are escaped, `testRequest`), `validateSetting` in `settings.ts` (the wizard checks answers with the config reader's own parsers), `src/cli/atomic-write.ts` (temp file `wx` 0600 + rename, `FsOps` seam so a test can fail any step), `src/cli/init.ts` (readline wizard; streams injected). Nothing is written until the last answer, so Ctrl-C or end of input never touches an existing file. Existing config supplies defaults and `context_budget` is carried over. Concepts: atomic write (write-then-rename), dependency injection for terminal I/O, pseudo-terminal (pty) testing.
- Unverified on Linux CI: `test/cli-init.test.ts` drives the real binary on a pty through `test/support/pty-script.py` (waits on output, no fixed sleeps). Mark done after a green run.
- Not done: fsync before the rename (survives a process kill, not a power cut); Anthropic/Gemini presets arrive with tickets 27 and 28.
