# 26: Clipboard input (--clip)

**What to build:** `learn --clip` explains whatever is on the clipboard.

**Blocked by:** 25 (Piped input)

**Status:** ready-for-agent

- [ ] The clipboard tool is started with fixed arguments and no shell; nothing from the user or the clipboard is interpolated into the command (shown by a test with metacharacters on a fake clipboard)
- [ ] On macOS and Linux the right tool is used for the platform
- [ ] When the tool is missing, the error names the missing tool and says how to install it or to use piped input instead
- [ ] Clipboard text is handled like piped input: Excerpt only, size limit applied, and the report says filename rules were not applied
- [ ] The no-network guard (test/no-network.test.ts) gains a case for clipboard input (`--clip`): the only connection is the configured endpoint, and `--dry-run` opens none
- [ ] The guard's spawn check (git only) is updated to allow the platform's clipboard tool for `--clip` runs and nothing else
