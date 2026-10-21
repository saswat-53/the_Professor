# 38: --diff

**What to build:** `learn --diff` explains the changes the user has made.

**Blocked by:** 06 (Hardened git runner), 14 (Context report (the gate))

**Status:** ready-for-agent

- [ ] `--diff` explains uncommitted changes (staged and unstaged) against HEAD; `--diff <ref>` compares against that ref
- [ ] Untracked files and a repository with no commits are handled
- [ ] The budget applies to the diff; an over-large diff gives the context-too-long error
- [ ] Sensitive-file rules run on every file in the diff; blocked files are named in the report and excluded
- [ ] The diff is delimited as data in the prompt
- [ ] A shallow clone adds a note to the report
