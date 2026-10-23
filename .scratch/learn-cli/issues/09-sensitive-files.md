# 09: Sensitive files (Q2, ADR 0001)

**What to build:** Files that likely hold secrets are refused by default, wherever in the Excerpt or Context they appear, and the user is told which rule applied.

**Blocked by:** 03 (File reading rules), 05 (Typed errors and exit codes), 06 (Hardened git runner), 07 (Teaching prompt, Level, and --show-prompt), 08 (Project root and path escape (Q27))

**Status:** done

- [x] A gitignored file and files matching the built-in denylist (environment files, private-key and certificate files, key-named files) are refused by raising `BlockedFileError`, which exits 3 (shown by a CLI test asserting the exit code)
- [x] The error names the exact rule that blocked the file (for example "gitignore" or a denylist pattern)
- [x] Any read of a Sensitive file through the file reader is refused whatever feature asked for it (shown by a test that asks the reader directly for a second, blocked path while the Reference itself is allowed). Features that gather more files repeat this check in their own tickets: `@file` (33) and diff (38)
- [x] `--allow-sensitive` overrides the refusal for that run
- [x] When the base URL host is localhost, 127.0.0.1, or ::1, the refusal is skipped; hosts such as `localhost.evil.example` and `127.0.0.1.evil.example` are not exempt
- [x] `--show-prompt` and `--dry-run` never print blocked content: the blocked-file check runs before either prints anything, shown by a test with a canary string in a blocked file
- [x] The check lives in file reading, so no caller can bypass it

## Comments

- Only the Excerpt read goes through `createFileReader` so far; Context gathering (ticket 10+) and `@file` (33) / diff (38) must use the same reader and add their own canary tests.
- Template env files (`.env.example`) are blocked too: no exemption, `--allow-sensitive` is the escape hatch.
- Tracked files that match a gitignore pattern are not reported by `git check-ignore`, so they pass the gitignore rule.
