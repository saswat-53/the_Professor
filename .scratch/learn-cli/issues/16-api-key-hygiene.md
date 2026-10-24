# 16: API key from a named environment variable, and secrets hygiene

**What to build:** The key lives only in the environment variable the config names, and nothing the tool prints can leak it.

**Blocked by:** 15 (Settings resolution and the global config file)

**Status:** done

- [x] The config holds the variable's name; the key is read only from that variable; there is no key flag and no key field in the config
- [x] A missing variable produces an error that names it and exits 2; for localhost endpoints the variable is optional
- [x] A sentinel key value never appears in stdout, stderr, `--show-prompt`, or `--dry-run` output, and the Authorization header is never printed
- [x] Plain `http` to a non-local host produces a warning on stderr
- [x] The request sent to the fake server carries the key in the standard Authorization header
- [x] Re-run the canary test in `test/context-report.test.ts` against the named variable (today the CLI reads `LEARN_API_KEY` directly): the key actually used in a request, seen as the Authorization header at the fake server, never appears in stdout, stderr, `--show-prompt`, `--dry-run`, the request body or the Context report

## Decisions

- On a hosted endpoint a missing key (exit 2) is reported before a blocked-file refusal (exit 3), because the key is resolved before the request is built. Deliberate: a run that cannot send anything fails on setup first. Do not reorder without a reason.
- `--dry-run` skips the key check (nothing is sent). `key_env` must look like a variable name, so a pasted key is refused without being echoed.
- The plain-http warning lives next to `isLocalHost` in `src/core/sensitive.ts`; 401/403 errors name the variable (`check $NAME`), never its value.
