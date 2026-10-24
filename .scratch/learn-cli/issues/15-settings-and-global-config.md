# 15: Settings resolution and the global config file

**What to build:** Level, base URL, model, and context budget can be set once in a global config file and overridden by environment variables and flags.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** done

- [x] Precedence is flag, then environment (`LEARN_LEVEL`, `LEARN_MODEL`, `LEARN_BASE_URL`, `LEARN_CONTEXT_BUDGET`), then config file, then default, tested for every setting
- [x] The config is read only from the per-user config location (honouring the standard config-directory variable); a config file in the project is ignored
- [x] An unknown key produces a warning that names it; an invalid value produces an error naming the key and the file, exit code 2
- [x] A missing config file produces a first-run message with an example whose alternative provider lines are marked as alternatives
- [x] `~` in the notes directory setting is expanded
- [x] Provider and model settings use the same resolution mechanism as level, with no duplicated precedence logic

## Comments

- From ticket 14: the resolved settings should carry the endpoint as one value (`Endpoint` from `resolveEndpoint` in `src/core/sensitive.ts`: parsed host plus `local`). Today `resolveBudget` (`src/core/budget.ts`) calls `isLocalHost(baseUrl)`, a second parse of the same string in a different place, while the file reader and the Context report use the reader's one parse. They cannot disagree today, but make the budget take its "local" from the resolved endpoint too, so one parse decides the budget default, the sensitive-file exemption, the report's `local` flag, and the host named in its notes.

- Done: `src/core/settings.ts` (one table, one precedence loop; TOML via `smol-toml`; file read in the CLI so core stays read-free). `resolveBudget` now takes the `Endpoint` from the file reader, so one parse decides the budget default, the exemption and the report. `notes_dir` is resolved (with `~`) but not yet consumed (ticket 36). Concepts: precedence/resolution table, XDG base directories, TOML, pure core with I/O at the edge.
- Hardening pass: `--root`/`--allow-sensitive` stay flag-only (env and config forms warn by name, never apply); rejected base URLs are echoed without userinfo (`redactUrl`); TOML errors give file, line and column but never the source line; an empty string is "unset" for every setting and source; the config is read with `readTextFile` (regular files only, 64 KB cap) and any failure is exit 2 naming the file. Open for ticket 16: `--dry-run` and `--show-prompt` print the resolved base URL as given, so a URL with userinfo would be printed there.
