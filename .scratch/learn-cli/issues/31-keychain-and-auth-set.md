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
