# 46: One command table for `--help` and `/help`

**What to build:** A single table of chat commands (`/save`, `/glossary`, `/quiz`, `/exit`, `/quit`, and the new `/help`) from which chat dispatch, the unknown-command message, `/help` and the "Chat commands" section of `--help` are all generated.

**Blocked by:** none (independent of 44 and 45)

**Status:** ready

**Concepts to look up:** table-driven dispatch, single source of truth, discriminated unions, exhaustiveness checks, snapshot testing of help text.

## Behaviour

- [ ] Each chat command is one entry: name (and aliases such as `/quit`), usage line, one-line help text, and its handler. Chat dispatch looks commands up in the table; the `if` chain in `chat.ts` goes away
- [ ] `/help` in chat prints the command section from the table; the `CHAT_HELP` string and the hard-coded list in the "is not a command" message are generated from the table too
- [ ] `learn --help` keeps commander's output and gains a "Chat commands" section generated from the same table; nothing else in `--help` changes (usage forms, options, exit codes stay as they are)
- [ ] `--help`, `--version` and `/help` make no network call and need no terminal, config or API key
- [ ] The chat's multi-line paste convention and Ctrl-C/Ctrl-D behaviour stay documented in the help output, as they are in `CHAT_HELP` today
- [ ] `--usage` (ticket 44) appears in `--help` once that ticket lands; this ticket does not depend on it

## Safety case: help text cannot go missing

- [ ] The entry type makes `help` and `usage` required, so a command without them does not compile
- [ ] A test iterates the real table and fails when any command has an empty or whitespace-only help text or usage line
- [ ] A test fails when a command is handled by dispatch but is not in the table (dispatch is driven by the table, so this is checked by sending every name the dispatcher accepts through `/help`'s output), and when a table entry has no handler
- [ ] A snapshot of the "Chat commands" section catches accidental changes; the section is small

## Break it

- [ ] Add a command to the table with an empty help string: the empty-help test must fail
- [ ] Add a handler without a table entry: the dispatch/table consistency test must fail
- [ ] Remove `/quiz` from the table: the snapshot and the dispatch test must both fail

## Glossary

- [ ] `GLOSSARY.md` has a **Chat command** entry saying the table is the one place commands are defined

## Comments
