# 20: No-network guard

**What to build:** The promise in ADR 0003 is enforced: the only connection the tool opens is to the configured endpoint.

**Blocked by:** 15 (Settings resolution and the global config file)

**Status:** ready-for-agent

- [ ] A CI test runs representative commands and asserts that the only host contacted is the configured endpoint, including on a first run with no config, `--dry-run`, and a failing request
- [ ] The test fails if any update check, telemetry, or other call is introduced (shown by a fixture that adds one)
- [ ] The guard runs in the default CI job, not behind an opt-in flag
