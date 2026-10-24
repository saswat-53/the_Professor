# 20: No-network guard

**What to build:** The promise in ADR 0003 is enforced: the only connection the tool opens is to the configured endpoint.

**Blocked by:** 15 (Settings resolution and the global config file)

**Status:** done

- [x] A CI test runs representative commands and asserts that the only host contacted is the configured endpoint, including on a first run with no config, `--dry-run`, and a failing request
- [x] The test fails if any update check, telemetry, or other call is introduced (shown by a fixture that adds one)
- [x] The guard runs in the default CI job, not behind an opt-in flag

## Comments

- Implemented in test/no-network.test.ts with the preload test/support/net-spy.mjs. Scope as tested: Node-level connects, DNS lookups (including `resolve*`), UDP, and spawned commands (git only). Not seen: HTTP/2 specifics, a spawned binary's own traffic, code that connects after exit. ADR 0003 and the README line say "tested", not "enforced".
- Not done until the guard is green on Linux CI for Node 22, 24 and 26 (see the CI rule for process-level tests). Follow-ups: 43 (dependency scan), and guard cases added in 25 (piped input) and 26 (clipboard).
- Done: CI run for `b62e247` is green on Node 22, 24 and 26 (ubuntu-24.04). All three criteria met: first run, `--dry-run` and failing request are covered; the self-test fixture (update check plus spawned `node`) makes the guard fail; it runs in the default `npm test` job.
