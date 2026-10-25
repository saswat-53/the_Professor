# 32: Interactive chat basics

**What to build:** After the first explanation, the user can keep asking questions in the same Session.

**Blocked by:** 14 (Context report (the gate)), 17 (Plain and terminal output modes), 19 (Cancellation: Ctrl-C and SIGTERM)

**Status:** done

- [x] Follow-up questions get answers that remember the earlier explanation (the fake server receives the earlier turns)
- [x] The Session lives in memory only and nothing is written to disk
- [x] The chat refuses to start when there is no terminal, with a message and exit code 2
- [x] A documented multi-line input convention lets a user paste code
- [x] Ctrl-C during a response cancels only that response; Ctrl-C at an idle prompt ends the chat
- [x] The interface uses readline, and core has no knowledge of it

## Comments

**Implemented** (commits `7a9eb02`, `a90f438`, `328a5b0`; Linux CI green).

Decisions made along the way:
- **Entry point:** the ticket named none, so it is `learn <file> --chat`. It cannot be combined with `--dry-run` (exit 2).
- **No terminal:** stdin and stdout must both be terminals; otherwise exit 2 with "needs a terminal", before any request is sent.
- **Multi-line input:** a line of `<<<` opens a paste block and `>>>` closes it. Chosen over `"""` or a trailing backslash because code contains both.
- **Ending the chat:** `/exit`, `/quit`, Ctrl-D, or Ctrl-C at the idle prompt, all exit 0 (like `python` or `sqlite3`). 130 stays for cancelling a request; SIGTERM ends with 143. Documented in the README exit codes.
- **Ctrl-C during an answer:** cancels only that answer. A cancelled or failed turn is not added to the Session.
- **Typed-ahead input:** anything typed or pasted while an answer streams is discarded; the note gives a count only, never the text.
- **Architecture:** `Session` and `followUp` are in core (`src/core/session.ts`, no I/O). Requests gained an optional `history`. readline lives only in `src/cli/chat.ts`. Memory only; nothing written to disk.
- **Safety path:** every turn reuses the first turn's model client, endpoint and key; `--show-prompt` prints each follow-up including earlier turns (README warns it repeats the first Excerpt). A multi-turn canary test checks the key appears only in the Authorization header and the Excerpt is never echoed.
- **Glossary:** added **Chat** (the interactive loop over a Session).

Handed to ticket 34 (not done here):
- **Interim hard cap:** a question that would pass 4x the context budget (2x on local endpoints, since small local windows such as Ollama's default of about 4k tokens would silently lose the start of the chat) is refused with a "Session too long" error. 34 should replace this with dropping oldest turns in pairs, keeping the first Excerpt, Context and explanation pinned, and derive the local cap from the real context window.

Not taken from the review (judgement calls): `followUp` repeats part of `explain`'s stream loop, and `runChat` is one long function.
