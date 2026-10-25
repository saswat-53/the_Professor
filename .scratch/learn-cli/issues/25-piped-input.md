# 25: Piped input

**What to build:** `cat file | learn` explains piped text.

**Blocked by:** 14 (Context report (the gate)), 17 (Plain and terminal output modes)

**Status:** done

- [x] Piped text becomes the Excerpt with no Enclosing block or imports, and an optional `--lang` hint is passed to the model
- [x] When stdin is an empty terminal, `learn` prints a usage message and does not hang
- [x] When both a file Reference and piped input are given, the behaviour is defined and documented, and tested
- [x] The Excerpt size limit applies to piped input
- [x] The Context report says that filename rules were not applied to this input
- [x] The no-network guard (test/no-network.test.ts) gains a case for piped input (`cat file | learn`): the only connection is the configured endpoint, and `--dry-run` opens none
- [x] Secret-canary case in `test/secret-canary.test.ts` (ticket 21): a canary piped in has no filename, so no filename rule can catch it; the test asserts the Context report says "no filename checks applied" (the wording is pinned by the test), and that a canary API key still appears in no output and no request body
