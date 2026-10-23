# 23: README

**What to build:** A newcomer can install, configure, and trust the tool from the README alone.

**Blocked by:** 22 (Live verification: Ollama first, then one hosted provider)

**Status:** ready-for-agent

- [ ] States plainly that the configured endpoint receives the user's code, and lists the no-telemetry, no-update-check, only-your-endpoint promises
- [ ] Documents the exit-code table (0 success, 1 runtime or provider error, 2 usage or config error, 3 refused, plus 130/143 once ticket 19 lands), the example config with the alternative lines marked as alternatives, and the supported Node versions
- [ ] Explains Sensitive-file refusal, `--allow-sensitive`, and the localhost exemption
- [ ] Documents `--show-prompt`, `--dry-run`, `--root`, and `--level`
- [ ] States that the 0.x versions may change before 1.0
