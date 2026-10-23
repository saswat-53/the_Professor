# 13: Context budget and Excerpt limit

**What to build:** Big files can't blow the model's window or the user's bill: the Context is trimmed to a budget, and an Excerpt that is itself too large is refused with advice.

**Blocked by:** 10 (Context: Enclosing-block interface, fallback window, imports), 05 (Typed errors and exit codes)

**Status:** ready-for-agent

- [ ] The default budget is 24,000 characters for hosted endpoints and 8,000 when the base URL host is localhost, 127.0.0.1, or ::1; a budget setting can override it (flag only for now; ticket 15 adds env and config)
- [ ] Over budget, Context is dropped farthest from the Excerpt first, including inside an Enclosing block
- [ ] The Excerpt is never trimmed; if it exceeds 50% of the active budget the run fails by raising `ContextTooLongError`, exit code 3 (shown by a CLI test), and a "narrow your range" hint
- [ ] A minified single-line file is refused with that same message
- [ ] Tests assert the exact lines kept and dropped for a known file
