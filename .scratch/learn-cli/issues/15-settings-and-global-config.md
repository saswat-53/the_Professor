# 15: Settings resolution and the global config file

**What to build:** Level, base URL, model, and context budget can be set once in a global config file and overridden by environment variables and flags.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** ready-for-agent

- [ ] Precedence is flag, then environment (`LEARN_LEVEL`, `LEARN_MODEL`, `LEARN_BASE_URL`, `LEARN_CONTEXT_BUDGET`), then config file, then default, tested for every setting
- [ ] The config is read only from the per-user config location (honouring the standard config-directory variable); a config file in the project is ignored
- [ ] An unknown key produces a warning that names it; an invalid value produces an error naming the key and the file, exit code 2
- [ ] A missing config file produces a first-run message with an example whose alternative provider lines are marked as alternatives
- [ ] `~` in the notes directory setting is expanded
- [ ] Provider and model settings use the same resolution mechanism as level, with no duplicated precedence logic

## Comments

- From ticket 14: the resolved settings should carry the endpoint as one value (`Endpoint` from `resolveEndpoint` in `src/core/sensitive.ts`: parsed host plus `local`). Today `resolveBudget` (`src/core/budget.ts`) calls `isLocalHost(baseUrl)`, a second parse of the same string in a different place, while the file reader and the Context report use the reader's one parse. They cannot disagree today, but make the budget take its "local" from the resolved endpoint too, so one parse decides the budget default, the sensitive-file exemption, the report's `local` flag, and the host named in its notes.
