# 42: Find out why a stalled stdout reader hung the second-signal test on Linux

**What to build:** Either a confirmed cause and a decision (fix or document), or proof that only the test was at fault.

**Blocked by:** none

**Status:** needs-investigation

## Symptom

In CI (ubuntu-24.04, Node 22 and 26; Node 24 passed that run), the macOS-only-now test "a second signal (SIGINT/SIGTERM) ends the process at once..." in `test/cli-cancel.test.ts` (commit 8e495d1) hit its 20 s timeout instead of failing an assertion. The earlier version (7ca0e47) failed `aliveAfterFirst` instead. On macOS both pass, 15 of 15 runs. The test is now `skipIf` non-darwin (34b73ad); a timing-free two-SIGINT test runs everywhere.

## What is NOT the cause

Not "pipes are synchronous on Linux": Node's docs say pipes are asynchronous on POSIX. Nothing below is confirmed yet.

## Candidate causes (unconfirmed)

1. The CLI really does not respond to a signal while its stdout reader is stalled (a product problem).
2. The test never reached its trigger (stdout never delivered 1 MB to the reader, so the first SIGINT was never sent) and simply timed out (a test problem).
3. A difference in how Linux handles `child.stdout.pause()` plus `exit`/`close` ordering in the test helper.

## First step: confirm on Linux, before any mitigation

On Linux (Docker, or a throwaway `workflow_dispatch` job), run a plain Node script that writes endlessly to a pipe nobody reads, with a SIGINT handler that logs and exits:

```js
// stall.mjs: node stall.mjs | (sleep 30)   then: kill -INT <pid of node>
process.on("SIGINT", () => { console.error("handler ran"); process.exit(130); });
const chunk = "x".repeat(64 * 1024);
const pump = () => { while (process.stdout.write(chunk)); process.stdout.once("drain", pump); };
pump();
```

Then the same with `dist/cli.js` against a fake server streaming 8 MB, reader stalled, `kill -INT`. Log in the test which of the candidates above happened (did the reader receive 1 MB, did the server see the connection close, did the process exit).

## Only if the product is at fault: candidate mitigations

- A force-exit timer after the first signal (smaller change; covers SIGINT and SIGTERM): if the process has not ended a short time after cancelling, `process.exit`.
- Stop the process from depending on stdout draining (for example a bounded write queue). Larger change.
- Otherwise document it: if the reader of a pipe stops consuming output, `learn` may not end on a signal until the reader drains. Do not add this to the README until the repro confirms it.

- [ ] Cause confirmed on Linux with the plain script and with `dist/cli.js`
- [ ] The macOS-only gate on the stall test is removed, or the reason it stays is written here
- [ ] A decision (fix, force-exit timer, or documented limitation) is recorded in this file
