# 36: /save notes

**What to build:** The user can keep what they learned as markdown notes. This is the one place the tool ever writes.

**Blocked by:** 32 (Interactive chat basics)

**Status:** ready-for-agent

- [ ] `/save` writes one markdown file per Session, named by date and a sanitised slug, inside the notes directory (default `~/learn-notes`), and appends glossary entries to a single glossary file there
- [ ] The final path is checked with real paths to be inside the notes directory; a slug such as `../../x` stays inside
- [ ] A file is never overwritten: a second save the same day gets a new name
- [ ] Each note begins with a warning that it contains code
- [ ] This is the only module on the write allowlist of the boundary check from ticket 02
