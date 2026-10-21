# 16: API key from a named environment variable, and secrets hygiene

**What to build:** The key lives only in the environment variable the config names, and nothing the tool prints can leak it.

**Blocked by:** 15 (Settings resolution and the global config file)

**Status:** ready-for-agent

- [ ] The config holds the variable's name; the key is read only from that variable; there is no key flag and no key field in the config
- [ ] A missing variable produces an error that names it and exits 2; for localhost endpoints the variable is optional
- [ ] A sentinel key value never appears in stdout, stderr, `--show-prompt`, or `--dry-run` output, and the Authorization header is never printed
- [ ] Plain `http` to a non-local host produces a warning on stderr
- [ ] The request sent to the fake server carries the key in the standard Authorization header
