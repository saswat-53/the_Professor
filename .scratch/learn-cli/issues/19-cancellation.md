# 19: Cancellation: Ctrl-C and SIGTERM

**What to build:** The user can stop a request at any time and nothing hangs.

**Blocked by:** 05 (Typed errors and exit codes)

**Status:** done

- [x] Ctrl-C during a streaming response aborts the request (the fake server sees the connection close) and exits with code 130
- [x] SIGTERM does the same and exits with code 143
- [x] A cancel before the first byte arrives also ends cleanly
- [x] Partial output already printed stays printed, with a newline-terminated final line
- [x] A core test cancels through the abort signal and sees a cancelled error event with no further text

## Comments

- Follow-up found while reviewing: `test/url-redaction.test.ts` failed about 3 runs in 50, alone. Not load, not a timeout, not shared state. Exact failure: `AssertionError: expected 'invalid "provider.base_url" in /var/folders/.../learn-xdg-gPkvu7/learn/config.toml: must not contain a username or password; ...' not to contain 'u7'`. The fake secret `u7` was a substring of the random `mkdtemp` suffix in the config path that error messages print. Fixed by giving every fake secret in `url-redaction.test.ts` and `settings.test.ts` a long, unlikely form (`...-ZX9Q4-NOLEAK`) so random text cannot contain it; no output is filtered. 10 solo runs and the full suite pass after.
- A second SIGINT/SIGTERM now exits at once (`process.exit` with that signal's code) instead of relying on Node's default kill; tested by sending two SIGINTs to a request that never answers.
- Cancel in the middle of an escape sequence: the stripper never emits bytes of an unfinished sequence, so they are dropped; tested on a pseudo-terminal (`test/support/pty-run.py`, skipped if `python3` is missing): stdout shows only the visible text and `cancelled` starts on a fresh line.
- CI failed on Node 22 and 26 (run 40100924107): the second-signal tests saw the process already exited (`aliveAfterFirst` false). The first version signalled as soon as the server saw the request, so on a fast runner the CLI had written less than a pipe buffer and exited cleanly. The test now stops reading stdout after 1 MB and sends the first SIGINT only once the server's 8 MB has all been accepted (a condition, with a 5 s deadline), so the stall is established before the signal. If the setup fails, the assertion message says "the process exited before the stall was established".
- What each test covers: the second-signal pair (SIGINT/SIGTERM) proves the immediate exit is needed (it fails if the `process.exit` line is removed) and that the code is the second signal's; the earlier tests cover the first-signal exit codes, a cancel before the first byte, and the pty cancel mid-escape-sequence.
- Fallback if it still flakes on Linux after one more push: gate that one test to macOS and add a second test with no timing dependence: two SIGINTs back to back, exit 130 within 2 seconds. That one guards the exit code and "does not hang" but cannot prove the second signal was needed.
- Process rule: a test that depends on buffers, sleeps or process timing needs a green CI run (Node 22, 24, 26) before its ticket counts as done. Three tests have now passed on a Mac and failed on CI for this reason (a 4 MB payload, a 1 ms timeout, and this one).
