# 46: One command table for `--help` and `/help`

**What to build:** A single table of chat commands (`/save`, `/glossary`, `/quiz`, `/exit`, `/quit`, and the new `/help`) from which chat dispatch, the unknown-command message, `/help` and the "Chat commands" section of `--help` are all generated.

**Blocked by:** none (independent of 44 and 45)

**Status:** in progress: the table, dispatch, `/help` and the unknown-command message are done; `--help` and the glossary entry are not

**Concepts to look up:** table-driven dispatch, single source of truth, discriminated unions, exhaustiveness checks, snapshot testing of help text.

## Behaviour

- [x] Each chat command is one entry in `src/cli/chat-commands.ts`: name, aliases, usage line, one-line help text, and whether it takes words. Its handler is in a map in `chat.ts` typed by the table's names (`satisfies Record<ChatCommandName, …>`), because the handlers need readline, the Session and the mascot and `--help` must be able to import the table without them. Chat dispatch looks commands up in the table; the `if` chain is gone (a command typed with words it does not take, such as `/exit now`, is still an ordinary question, as before; a test pins that)
- [x] `/help` in chat prints the command section from the table; the `CHAT_HELP` string and the hard-coded list in the "is not a command" message are generated from the table too (the opening help, `/help` and the unknown-command message are all generated; the message now also says `/help` shows what each does)
- [ ] `learn --help` keeps commander's output and gains a "Chat commands" section generated from the same table; nothing else in `--help` changes (usage forms, options, exit codes stay as they are)
- [ ] `--help`, `--version` and `/help` make no network call and need no terminal, config or API key
- [x] The chat's multi-line paste convention and Ctrl-C/Ctrl-D behaviour stay documented in the help output, as they are in `CHAT_HELP` today (tested against the generated help text)
- [x] `--usage` (ticket 44) appears in `--help` once that ticket lands; this ticket does not depend on it (done in ticket 44)

## Safety case: help text cannot go missing

- [x] The entry type makes `help` and `usage` required, so a command without them does not compile (the `ChatCommand` interface; `takesArgs` is required too)
- [x] A test iterates the real table and fails when any command has an empty or whitespace-only help text or usage line
- [x] A command handled but not in the table, or in the table but not handled, does not compile (the handler map is typed by the table's names), and a runtime test types every command's own usage line and every alias into the real chat and checks each is recognised and does its job; the expected effects are in a map typed by the table's names too, so a new command stops the test compiling until its effect is stated
- [x] The "Chat commands" section is checked as an exact literal (stricter than a snapshot file); it is small

## Break it

- [x] Add a command to the table with an empty help string: the empty-help test must fail (mutants: blank help, usage not starting with the name, a duplicate alias)
- [x] Add a handler without a table entry: it does not compile; and a table entry without a handler does not compile either (both mutants run, `tsc` fails with a clear message)
- [x] Remove `/quiz` from the table: the snapshot and the dispatch test must both fail (the table tests fail, and so does the type check, since the handler map then has a command the table lacks)

## Glossary

- [ ] `GLOSSARY.md` has a **Chat command** entry saying the table is the one place commands are defined

## Comments
