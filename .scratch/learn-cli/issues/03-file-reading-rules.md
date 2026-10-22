# 03: File reading rules

**What to build:** Pointing `learn` at a file applies the safe-reading rules: only ordinary text files of reasonable size are read, and the content is cleaned before the model sees it.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** done

- [x] A directory, a device, and a named pipe are refused with a clear message
- [x] A file over 1 MB is refused, and the size is checked before the file is read
- [x] A file with a NUL byte in its first 8 KB is refused as binary
- [x] A file that isn't valid UTF-8 is refused with the message "not UTF-8 text"
- [x] A BOM is stripped and CRLF is normalised, so the text sent to the fake server contains neither
- [x] A minified single-line file is read without crashing (its budget handling comes in ticket 13)

## Comments

- Rules live in `src/core/read-file.ts` (`readTextFile`), the default reader for `buildRequest`. Order: `stat` (regular file, size <= 1 MB) before any read, then NUL sniff on the first 8 KB, then strict UTF-8 decode (BOM dropped by the decoder), then CRLF to LF.
- Tests: `test/file-reading.test.ts` goes through `explain()` with real temp files (incl. a FIFO and `/dev/null`, skipped on Windows); one CLI test checks the exit code and stderr message.
- A symlink is followed by `stat`, so a link to a regular file works. Escape and sensitive-file checks belong to tickets 08 and 09.
- Race hardening: the path is `stat`ed first (opening a FIFO would block), then opened, then `fstat`ed on the handle; the dev/inode and file type must match, and at most 1 MB + 1 bytes are read. `test/file-reading-race.test.ts` mocks the first `stat` to report a small size or a different inode. No no-follow flag is used, so symlinked files behave as before; symlink handling stays in ticket 08.
- Known, left on purpose: refusals are plain `Error`s with exit 1 (ticket 05 changes this to typed refusals, exit 3); a lone `\r` is untouched (see ticket 04).
