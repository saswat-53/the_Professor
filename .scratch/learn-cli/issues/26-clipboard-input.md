# 26: Clipboard input (--clip)

**What to build:** `learn --clip` explains whatever is on the clipboard.

**Blocked by:** 25 (Piped input)

**Status:** ready-for-agent

- [ ] The clipboard tool is started with fixed arguments and no shell; nothing from the user or the clipboard is interpolated into the command (shown by a test with metacharacters on a fake clipboard)
- [ ] On macOS and Linux the right tool is used for the platform
- [ ] When the tool is missing, the error names the missing tool and says how to install it or to use piped input instead
- [ ] Clipboard text is handled like piped input: Excerpt only, size limit applied, and the report says filename rules were not applied
