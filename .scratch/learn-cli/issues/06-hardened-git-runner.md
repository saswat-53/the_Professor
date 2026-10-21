# 06: Hardened git runner

**What to build:** Core can run read-only git commands safely, so later features (project root, ignore rules, diff, blame) all share one hardened entry point.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** ready-for-agent

- [ ] Only `log`, `diff`, `blame`, `show`, and `rev-parse` can be run; any other subcommand is rejected before anything is spawned
- [ ] Git is spawned without a shell: a path containing shell metacharacters is handled literally in a real temp repo
- [ ] Every path argument is preceded by `--`, and a ref starting with `-` is rejected
- [ ] A repo configured with an external diff driver and a pager runs neither of them
- [ ] A path outside the project root is rejected
- [ ] Root detection works from a subdirectory, reports "no repo" outside one, and works in a repo with no commits
- [ ] A shallow clone is detected and reported as such to callers
- [ ] All tests use a real temporary git repository
