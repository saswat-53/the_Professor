# 06: Hardened git runner

**What to build:** Core can run read-only git commands safely, so later features (project root, ignore rules, diff, blame) all share one hardened entry point.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** done

- [x] Only `log`, `diff`, `blame`, `show`, and `rev-parse` can be run; any other subcommand is rejected before anything is spawned
- [x] Git is spawned without a shell: a path containing shell metacharacters is handled literally in a real temp repo
- [x] Every path argument is preceded by `--`, and a ref starting with `-` is rejected
- [x] A repo configured with an external diff driver and a pager runs neither of them
- [x] A path outside the project root is rejected
- [x] Root detection works from a subdirectory, reports "no repo" outside one, and works in a repo with no commits
- [x] A shallow clone is detected and reported as such to callers
- [x] All tests use a real temporary git repository
