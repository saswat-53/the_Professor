# 08: Project root and path escape (Q27)

**What to build:** `learn` knows what the project is and refuses to read outside it, even through symlinks.

**Blocked by:** 03 (File reading rules), 06 (Hardened git runner)

**Status:** done

- [x] The project root is the nearest git root above the current directory, or the current directory when there is no repo
- [x] A Reference that resolves, after symlinks are followed, outside the root is refused with exit code 3 and a message that mentions `--root`
- [x] A symlink inside the project that points outside it is refused; a symlink that stays inside works, and the file is read through its resolved path
- [x] The `File: <label>` header sent to the model shows a project-relative path, never an absolute one containing the user's home directory
- [x] `--root <dir>` lets the user widen the root for one run; there is no environment variable or config setting for it (shown by a test that sets both and sees them ignored)
- [x] When the root is the user's home directory, a warning is printed on stderr
- [x] Path comparisons use relative paths of real paths, so a sibling directory with a shared name prefix (such as `app` and `app-secrets`) is not mistaken for inside the root

## Comments

**Done in `a34afe0` and `7836fa0`.**

Concepts to look up: symlink escape, `realpath`, relative-path containment (`path.relative`, never a string prefix), case-insensitive filesystems (`realpath.native` returns the true letter case), information leak through labels, typed errors with exit codes.

Decisions:
- **No repo, file elsewhere:** the root is only the current directory, so the file is refused unless `--root` is given. Running from `~` with no repo makes the whole home folder the root, which triggers the home warning. Recorded in GLOSSARY.md under "Project root".
- **`--root` must be an existing directory.** `--root /` is refused (exit 2) because labels would become absolute paths that include the home directory.
- **A missing file** is a `FileNotFoundError` (usage family, exit 2) with "no such file". It is not a raw Node error.
- **Reading a file now returns its text and its project-relative name,** so resolvers can't build a label from what the user typed.

Open items:
- A file could be swapped for a symlink between the escape check and the read (TOCTOU). Low risk, since the attacker needs write access inside the project. A fix needs `O_NOFOLLOW` or re-checking the opened file's path. Not scheduled.
- `findProjectRoot` runs twice per run (once for the home warning, once in `buildRequest`).
- Context files (tickets 10 to 13) must go through `locateFile` too.
- A missing path outside the root reports "no such file" before any root check, so it reveals whether the file exists. Minor.
