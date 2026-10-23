# 23: README

**What to build:** A newcomer can install, configure, and trust the tool from the README alone.

**Blocked by:** 22 (Live verification: Ollama first, then one hosted provider)

**Status:** ready-for-agent

- [ ] States plainly that the configured endpoint receives the user's code, and lists the no-telemetry, no-update-check, only-your-endpoint promises
- [ ] Documents the exit-code table (0 success, 1 runtime or provider error, 2 usage or config error, 3 refused, plus 130/143 once ticket 19 lands), the example config with the alternative lines marked as alternatives, and the supported Node versions
- [ ] Explains Sensitive-file refusal, `--allow-sensitive`, and the localhost exemption
- [ ] Documents `--show-prompt`, `--dry-run`, `--root`, and `--level`
- [ ] States that the 0.x versions may change before 1.0

## Comments

- From ticket 14: document the Context report on stderr, including the budget line, a format pinned by a test and so safe for scripts to read: `local endpoint budget 8,000 characters (default)`, `hosted endpoint budget 24,000 characters (default)`, `budget N characters (setting)`.
- From ticket 14: say in one sentence that the local-endpoint exemption from the sensitive-file check trusts the address, not the destination: a tunnel, port forward or local proxy on 127.0.0.1 may lead to a remote or hosted model, and the Context report's "sensitive-file check skipped: … endpoint is local (host)" note is the cue to notice.
