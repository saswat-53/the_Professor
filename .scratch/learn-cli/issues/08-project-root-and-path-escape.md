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
