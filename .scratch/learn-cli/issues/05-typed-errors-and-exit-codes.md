# 05: Typed errors and exit codes

**What to build:** Every failure the user can hit has a name, a friendly message, and a stable exit code, and raw provider output never reaches the terminal.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** done

- [x] Fake-server failures map to distinct typed errors: bad key (401), rate limit (429), network failure (connection refused), and model not found (404), each with its own friendly message on stderr
- [x] Context-too-long and blocked-file errors exist as types and map to exit code 3 (shown by a direct core test; later tickets raise them)
- [x] Exit codes are 0 success, 1 runtime or provider error, 2 usage or config error, 3 refused
- [x] A provider error body containing a sentinel string never appears in stdout or stderr
- [x] After a 429, the fake server has seen exactly one request (no automatic retry)
- [x] The file-reading refusals from ticket 03 (directory, device, pipe, too large, binary, not UTF-8) become typed refusals that exit 3, and the CLI refusal test in `test/cli.test.ts` and the message-text matches in `test/file-reading.test.ts` are updated to match
- [x] The temporary `kind: "usage"` field on error events and the `instanceof UsageError` checks in `src/cli/main.ts` (added in ticket 04) are replaced by the typed errors, and exit code 2 for malformed `path:N-M` references still holds
- [x] A failure after a large streamed output still flushes all the output before the process ends (the exit code is set, not forced)

## Comments

Review follow-ups (not done here):
- `AbortError` currently surfaces as a generic provider error; ticket 19 should map it to exit 130.
- Non-`APICallError` failures are reported as network errors: now ticket 41. `Retry-After` on a 429: ticket 40.
- GLOSSARY entries for the exit-code families: done. README table: ticket 23.
- Test `run` helper moved to `test/support/cli.ts`.
