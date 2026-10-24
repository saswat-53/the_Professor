# 43: Dependency telemetry scan

**What to build:** The installed dependency tree is checked for packages that phone home, because `ai` and `@ai-sdk/openai-compatible` are the likeliest source of a network call the no-network guard (20) cannot see.

**Blocked by:** 20 (No-network guard)

**Status:** ready-for-agent

- [ ] A script scans the installed dependency tree (from the lockfile) against a checked-in list of known telemetry, analytics, and update-check packages, and fails naming each match and the dependency path that pulls it in
- [ ] The scan also fails on any dependency whose install scripts (`preinstall`, `install`, `postinstall`) are not on a checked-in allowlist
- [ ] It runs in the default CI job, and CI re-runs it whenever `package-lock.json` changes (it is part of the normal run, so a changed lockfile cannot skip it)
- [ ] A fixture dependency tree containing a listed package shows the scan failing
- [ ] ADR 0003 and the README line name this scan as the separate check on dependencies
