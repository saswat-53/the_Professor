# 48: A bare `learn` opens an empty chat

**What to build:** `learn` with no Reference, on a terminal, opens a chat with nothing attached; the user asks, or attaches code with `@`.

**Blocked by:** none

**Status:** implemented, awaiting review

**Concepts to look up:** REPL, TTY detection, pinned context, system prompt as behaviour.

## Behaviour

- [x] `learn` and `learn --chat` with stdin and stdout both terminals and no Reference, `--clip`, `--diff` or `--blame` open an empty chat; nothing is sent until the first question
- [x] The first question is turn 1 and is pinned; `Session.startEmpty` (core) makes this, the CLI only calls it
- [x] An open Session's system prompt says no code is attached yet, so a general question is not forced into the four code headings
- [x] `/save` and `/quiz` refuse with a clear message while nothing has been asked, and send nothing
- [x] `--dry-run` and `--usage` with nothing to explain still print usage and exit 2; piped input still wins (and still needs no terminal)
- [x] USAGE, README and GLOSSARY updated

## Comments

Teaching prompt unchanged for sessions that start from a Reference.
