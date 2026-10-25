# 36: /save notes

**What to build:** The user can keep what they learned as markdown notes. This is the one place the tool ever writes.

**Blocked by:** 32 (Interactive chat basics)

**Status:** done

- [x] `/save` writes one markdown file per Session, named by date and a sanitised slug, inside the notes directory (default `~/learn-notes`), and appends glossary entries to a single glossary file there
- [x] The final path is checked with real paths to be inside the notes directory; a slug such as `../../x` stays inside
- [x] A file is never overwritten: a second save the same day gets a new name
- [x] Each note begins with a warning that it contains code
- [x] This is the only module on the write allowlist of the boundary check from ticket 02

## Comments

- Code: `src/core/notes.ts` (`saveNote`, `appendGlossaryEntry`), the one entry on the write allowlist (`WRITE_ALLOWLIST` in `test/support/boundary.ts`, whose pinned test now expects exactly `["notes.ts"]`). The chat commands are in `src/cli/chat.ts`; `main.ts` supplies them with the notes directory.
- **Decision, glossary entries:** the ticket does not say where entries come from. They are typed by the user: `/glossary term: meaning` (a separate command, not `/save`), so no extra model call and nothing generated is stored unseen. `/save [name]` writes the note only; the optional name sets the slug (default: the Reference as typed, or `clipboard` / `piped input`).
- Concepts: exclusive create (`O_EXCL`, the `wx` flag) makes "never overwrite" atomic, where check-then-write would race; `O_NOFOLLOW` refuses a symlink planted at `glossary.md`; `realpath` then `isInside` is the check that a path stays in the directory (the slug is also reduced to `[a-z0-9-]`, so two defences); a fence longer than any backtick run in the stored text keeps pasted code from closing the markdown fence; control characters are stripped because a note may later be `cat`ted into a terminal.
- Limits: turns the Session cap dropped are not in the note. Notes are owner-only (0600), the directory 0700 when created. `learn init`'s prompt no longer says "coming later".
