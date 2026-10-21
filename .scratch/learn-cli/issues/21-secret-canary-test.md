# 21: Secret-canary test

**What to build:** A planted secret can never leave through any path the tool has.

**Blocked by:** 07 (Teaching prompt, Level, and --show-prompt), 09 (Sensitive files (Q2, ADR 0001)), 14 (Context report (the gate)), 16 (API key from a named environment variable, and secrets hygiene)

**Status:** ready-for-agent

- [ ] A canary string in a Sensitive file never appears in the request body, stdout, stderr, `--show-prompt` output, or `--dry-run` output, whether the file is the Reference or would contribute to the Context
- [ ] A canary API key value never appears in any of those places either
- [ ] With `--allow-sensitive`, the canary does appear in the request (the override is respected), and the Context report says so
- [ ] The test runs against a real temp project with a gitignored file and a denylisted file
