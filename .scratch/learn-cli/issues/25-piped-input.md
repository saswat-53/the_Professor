# 25: Piped input

**What to build:** `cat file | learn` explains piped text.

**Blocked by:** 14 (Context report (the gate)), 17 (Plain and terminal output modes)

**Status:** ready-for-agent

- [ ] Piped text becomes the Excerpt with no Enclosing block or imports, and an optional `--lang` hint is passed to the model
- [ ] When stdin is an empty terminal, `learn` prints a usage message and does not hang
- [ ] When both a file Reference and piped input are given, the behaviour is defined and documented, and tested
- [ ] The Excerpt size limit applies to piped input
- [ ] The Context report says that filename rules were not applied to this input
