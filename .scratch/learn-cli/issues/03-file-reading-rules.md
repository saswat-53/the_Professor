# 03: File reading rules

**What to build:** Pointing `learn` at a file applies the safe-reading rules: only ordinary text files of reasonable size are read, and the content is cleaned before the model sees it.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** ready-for-agent

- [ ] A directory, a device, and a named pipe are refused with a clear message
- [ ] A file over 1 MB is refused, and the size is checked before the file is read
- [ ] A file with a NUL byte in its first 8 KB is refused as binary
- [ ] A file that isn't valid UTF-8 is refused with the message "not UTF-8 text"
- [ ] A BOM is stripped and CRLF is normalised, so the text sent to the fake server contains neither
- [ ] A minified single-line file is read without crashing (its budget handling comes in ticket 13)
