# 29: Switch to commander and subcommand routing

**What to build:** The CLI can route subcommands such as `init` and `auth` without changing any behaviour users already rely on.

**Blocked by:** 17 (Plain and terminal output modes), 05 (Typed errors and exit codes)

**Status:** ready-for-agent

- [ ] Every existing command and flag behaves identically (the existing black-box tests pass unchanged)
- [ ] A usage error exits with code 2, not the library's default
- [ ] An unknown subcommand prints a usage message listing the valid ones
- [ ] `learn --help` documents the exit-code table
