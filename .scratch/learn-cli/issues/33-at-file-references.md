# 33: @file references in chat

**What to build:** A user can attach code to a question by typing `@path` or `@path:10-20`.

**Blocked by:** 32 (Interactive chat basics)

**Status:** done

- [x] A token is a Reference only when it follows whitespace and either resolves or looks like a path; an email address or a decorator is not mistaken for one
- [x] Quoting and escaping support paths with spaces
- [x] A missing or blocked file produces an inline error and the message is not sent
- [x] Each attached file goes through the Sensitive-file check, the project-root check, and the Excerpt limit; a whole file over the limit asks for a range
- [x] Attached material appears in the Context report for that message

## Comments

**Implemented.** Core `attachReferences`/`findMentions` in `src/core/attachments.ts`; `runChat` takes an `attach` function, so a failed attachment prints an inline error and the message is not sent. The composed message (question plus fenced files) is what the Session records, so later turns still see the attached code. Each attachment is checked separately against the Excerpt limit; there is no total per message yet (the Session cap and ticket 34 cover growth). On a local endpoint the Sensitive-file check is skipped as for the first Reference, so the blocked-file case is tested in core with a hosted URL, not in the pty test.

**Follow-up (same ticket):**
- Combined limit: the Excerpts attached to one message must fit in half the budget together; the error names the file that pushed it over. Ticket 34 builds the Session cap on top.
- A pty test on a hosted-looking endpoint (`127.1`, which learn does not treat as local) proves a Sensitive file is refused inline and never reaches the server. The first explanation still contacts the server (the chat starts after it), so the test asserts that only that request arrived.
- Core tests plant a canary in `.env` and a gitignored file: refused on a hosted endpoint without the secret in the error; with `--allow-sensitive` it is sent and the report names the rule and host.
- Home-directory warning: already printed once at startup for the whole run; a pty test checks attachments do not repeat it.
- A file mentioned twice is attached once, with a note.

Deliberately left: a misspelled extensionless name such as `@Readme` is sent as plain text (treating every `@word` as a file would break `@Override`). Optional later: after sending, note "`@Readme` was not treated as a file" for tokens that start with an uppercase letter or match a near-name of an existing file.
