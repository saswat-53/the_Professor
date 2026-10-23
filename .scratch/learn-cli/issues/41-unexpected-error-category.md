# 41: Separate unexpected failures from network failures

**What to build:** A bug inside learn, or a malformed response mid-stream, is reported as an unexpected error and not as a network problem, so users debug in the right direction.

**Blocked by:** 05 (Typed errors and exit codes)

**Status:** ready-for-agent

- [ ] Only failures with no HTTP status that come from the connection itself (refused, reset, DNS, timeout) become the network error
- [ ] Any other non-API failure, including a parse error mid-stream, becomes `UnexpectedError` with a generic message that says it is probably a bug in learn
- [ ] Tests: a fake server sending malformed stream data gives the unexpected message, and a refused connection still gives the network message
- [ ] Owner: whoever picks up the first provider ticket after 05 (27 Anthropic provider), since a second adapter would otherwise copy the wrong default
