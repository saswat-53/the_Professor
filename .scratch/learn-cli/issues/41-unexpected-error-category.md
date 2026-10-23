# 41: Separate unexpected failures from network failures

**What to build:** A bug inside learn, or a malformed response mid-stream, is reported as an unexpected error and not as a network problem, so users debug in the right direction.

**Blocked by:** 05 (Typed errors and exit codes)

**Status:** ready-for-agent

- [ ] Only failures with no HTTP status that come from the connection itself (refused, reset, DNS, timeout) become the network error
- [ ] Any other non-API failure, including a parse error mid-stream, becomes `UnexpectedError` with a generic message that says it is probably a bug in learn
- [ ] Tests: a fake server sending malformed stream data gives the unexpected message, and a refused connection still gives the network message
- [ ] Schedule: do this soon, right after 06 or whenever it fits, not in Milestone 2. A mid-stream parse error reading as "could not reach the provider" would mislead debugging during the next tickets
- [ ] Ticket 27 (Anthropic provider) and 28 (Gemini provider) follow the same classification rule, so a new adapter does not copy the old default
