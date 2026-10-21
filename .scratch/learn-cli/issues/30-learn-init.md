# 30: learn init wizard

**What to build:** A new user is guided to a working global config without editing a file by hand.

**Blocked by:** 29 (Switch to commander and subcommand routing), 15 (Settings resolution and the global config file)

**Status:** ready-for-agent

- [ ] `learn init` asks for provider preset, base URL, model, the name of the key variable, level, and notes directory, then writes the global config
- [ ] It refuses to run when there is no terminal, exiting 2 with a message
- [ ] Ctrl-C leaves any existing config untouched
- [ ] The config is written atomically with owner-only permissions (a test interrupts the write and finds no partial file)
- [ ] It never asks for the key value; it tells the user which variable to export
- [ ] An optional test request confirms the setup, and failures are reported with the typed error messages
