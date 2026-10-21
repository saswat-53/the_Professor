# 39: --blame

**What to build:** `learn --blame path:N-M` explains why a range of code changed.

**Blocked by:** 06 (Hardened git runner), 14 (Context report (the gate))

**Status:** ready-for-agent

- [ ] The history of the range is taken from git's line-range log, and the commit messages and patches are given to the model as evidence
- [ ] The prompt tells the model it can only explain what the history shows, and to mark intent not found in a message as a guess
- [ ] The budget applies to the history; Sensitive-file rules apply to the files involved; history is delimited as data
- [ ] The report says plainly that secrets inside history can't be filtered by name
- [ ] A shallow clone adds a note that history is incomplete
