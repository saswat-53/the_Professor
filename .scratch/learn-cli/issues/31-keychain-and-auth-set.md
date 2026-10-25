# 31: OS keychain and learn auth set

**What to build:** Users who don't want a key in their environment can store it in the OS keychain.

**Blocked by:** 29 (Switch to commander and subcommand routing), 16 (API key from a named environment variable, and secrets hygiene)

**Status:** done

- [x] `learn auth set` reads the key with hidden input and stores it under the service name `learn` and the base URL host
- [x] Lookup order is the environment variable named in the config, then the keychain entry for the current host; the environment wins
- [x] A key stored for one host is not used for another host
- [x] The keychain library is an optional dependency loaded only when needed; without it installed, everything else works
- [x] On a machine with no keyring available, the error says so plainly and says the environment variable still works
- [x] The key value is never printed

## Comments

Follow-up decisions (after review):
- **Entry name is host plus port when the URL names a non-default port** (`api.example.com`, `api.example.com:8443`, `[::1]:8080`; `:443` on https counts as default). Derived once, in `resolveEndpoint` (`keyHost`), and used by both the lookup and `learn auth set`/`delete`. The spec said "host"; two servers on one host with different ports must not share a key.
- **Local endpoints skip the keychain** unless the config names `key_env`, so an Ollama run never raises an OS keychain dialog.
- **`learn auth delete`** added (removes the entry for the configured endpoint; nothing stored is a note and exit 0, so it is safe in scripts).
- The key-trimming rule lives in one place (`trimEnds` in settings.ts).
