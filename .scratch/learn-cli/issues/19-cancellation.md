# 19: Cancellation: Ctrl-C and SIGTERM

**What to build:** The user can stop a request at any time and nothing hangs.

**Blocked by:** 05 (Typed errors and exit codes)

**Status:** ready-for-agent

- [ ] Ctrl-C during a streaming response aborts the request (the fake server sees the connection close) and exits with code 130
- [ ] SIGTERM does the same and exits with code 143
- [ ] A cancel before the first byte arrives also ends cleanly
- [ ] Partial output already printed stays printed, with a newline-terminated final line
- [ ] A core test cancels through the abort signal and sees a cancelled error event with no further text
