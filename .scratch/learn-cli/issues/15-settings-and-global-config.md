# 15: Settings resolution and the global config file

**What to build:** Level, base URL, model, and context budget can be set once in a global config file and overridden by environment variables and flags.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** done

- [x] Precedence is flag, then environment (`LEARN_LEVEL`, `LEARN_MODEL`, `LEARN_BASE_URL`, `LEARN_CONTEXT_BUDGET`), then config file, then default, tested for every setting
- [x] The config is read only from the per-user config location (honouring the standard config-directory variable); a config file in the project is ignored
- [x] An unknown key produces a warning that names it; an invalid value produces an error naming the key and the file, exit code 2
- [x] A missing config file produces a first-run message (when the base URL or model is also not set by flag or environment) with an example whose alternative provider lines are marked as alternatives
- [x] `~` in the notes directory setting is expanded
- [x] Provider and model settings use the same resolution mechanism as level, with no duplicated precedence logic

## Comments

- From ticket 14: the resolved settings should carry the endpoint as one value (`Endpoint` from `resolveEndpoint` in `src/core/sensitive.ts`: parsed host plus `local`). Today `resolveBudget` (`src/core/budget.ts`) calls `isLocalHost(baseUrl)`, a second parse of the same string in a different place, while the file reader and the Context report use the reader's one parse. They cannot disagree today, but make the budget take its "local" from the resolved endpoint too, so one parse decides the budget default, the sensitive-file exemption, the report's `local` flag, and the host named in its notes.

- Done: `src/core/settings.ts` (one table, one precedence loop; TOML via `smol-toml`; file read in the CLI so core stays read-free). `resolveBudget` now takes the `Endpoint` from the file reader, so one parse decides the budget default, the exemption and the report. `notes_dir` is resolved (with `~`) but not yet consumed (ticket 36). Concepts: precedence/resolution table, XDG base directories, TOML, pure core with I/O at the edge.
- Hardening pass: `--root`/`--allow-sensitive` stay flag-only (env and config forms warn by name, never apply); rejected base URLs are echoed without userinfo (`redactUrl`); TOML errors give file, line and column but never the source line; an empty string is "unset" for every setting and source; the config is read with `readTextFile` (regular files only, 64 KB cap) and any failure is exit 2 naming the file. Open for ticket 16: `--dry-run` and `--show-prompt` print the resolved base URL as given, so a URL with userinfo would be printed there.
- Closed the base URL leak noted above: a base URL with userinfo is refused as a setting (exit 2, "put the key in an environment variable"), since `fetch` rejects such URLs and stripping would send the request without credentials the user thought they gave. `--dry-run` and `--show-prompt` also print the URL through `redactUrl`, the same function the errors use. A missing base URL or model says where it looked.
- Review follow-up: `redactUrl` also cuts query and fragment; an empty `LEARN_ROOT`/`LEARN_ALLOW_SENSITIVE` does not warn; the empty-value rule is tested for every setting and source. Level and budget values from a flag or variable are still echoed as given in "invalid" errors, on purpose: they hold no credentials and the user needs to see the typo.
- Leak fix (found by review): the regex `redactUrl` printed `http://alice:pa` for `http://alice:pa#ss@host/v1`, because `#`, `?` and `@` can sit inside a password and no pattern can tell where credentials end. `redactUrl` now parses with `new URL`: a web URL with a host is shown as protocol, host and path plus a note of what was removed (credentials, query, fragment); anything that does not parse, or parses into a non-web scheme (`user:pass@host` reads `user:` as the scheme), is shown as `(value hidden)`. Pinned in `test/url-redaction.test.ts` for every output path (error, `--dry-run`, `--show-prompt`) from flag, environment and config.
- Backslash case (second review): the parser turns `\` into `/` and drops tabs and newlines, so `http://sk-KEY\@host` printed `http://sk-key/@host`-style output with the key as the host. `redactUrl` now hides any input holding a backslash, whitespace or control character before it parses. Path secrets (`/v1/sk-KEY`) are still printed, by design: the path is part of what identifies the endpoint.
