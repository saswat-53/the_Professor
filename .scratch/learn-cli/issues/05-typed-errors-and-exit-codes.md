# 05: Typed errors and exit codes

**What to build:** Every failure the user can hit has a name, a friendly message, and a stable exit code, and raw provider output never reaches the terminal.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** ready-for-agent

- [ ] Fake-server failures map to distinct typed errors: bad key (401), rate limit (429), network failure (connection refused), and model not found (404), each with its own friendly message on stderr
- [ ] Context-too-long and blocked-file errors exist as types and map to exit code 3 (shown by a direct core test; later tickets raise them)
- [ ] Exit codes are 0 success, 1 runtime or provider error, 2 usage or config error, 3 refused
- [ ] A provider error body containing a sentinel string never appears in stdout or stderr
- [ ] After a 429, the fake server has seen exactly one request (no automatic retry)
- [ ] A failure after a large streamed output still flushes all the output before the process ends (the exit code is set, not forced)
