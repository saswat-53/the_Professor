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
- The gitignore check uses `git check-ignore --no-index`, so a file committed and only later ignored is still refused (tested); so is one added with `git add -f`.
- Decision: if git cannot run, the gitignore half fails closed (the read is refused with the git error). The denylist needs no git and is checked first; a directory that is not a repo just has no gitignore rules.
- Decision: the localhost exemption is the parsed URL host, exactly `localhost`, `127.0.0.1` or `[::1]` (case-insensitive), as the parsed host: spellings the URL parser normalises to loopback (`127.1`, `2130706433`, `[0:0:0:0:0:0:0:1]`) are exempt too (tested). `localhost.`, `0.0.0.0`, `127.0.0.2` and `::ffff:127.0.0.1` are not exempt.
- `--allow-sensitive` is a flag only (no env var, not implied by `--root`).
- `BlockedFileError` carries `file` and `rule`; the CLI adds the `--allow-sensitive` advice.
- Denylist extended with `.git-credentials`, `.pypirc`, `.htpasswd`, `.aws/credentials`, `.docker/config.json`, `.kube/config`, `.git/config`, `*.tfstate`, `*.tfvars`.
- Global ignore: contrary to the assumption, the hardened runner does *not* isolate git from the user's global ignore. It removes `GIT_CONFIG*` overrides but leaves `HOME`, so `~/.config/git/ignore` and `core.excludesFile` are consulted (tested with a fake `HOME`). Nested `.gitignore` files and `.git/info/exclude` work too (tested). Known limit instead: a machine with a global ignore the user didn't intend as a "don't share" signal will see extra refusals; `--allow-sensitive` overrides.
- Denylist adds `.envrc`, `.vault-token`, `*.kdbx` (`*.keystore` and `terraform.tfstate.backup` were already covered; tested). The `secret` rule matches only whole name parts (`my-secrets.json`), not `*secret*`; no broader wildcards on purpose, to avoid false refusals that push users to `--allow-sensitive`.
- A gitignore refusal now says where the pattern came from, via `git check-ignore -v` (for example `ignored by ~/.config/git/ignore:1, pattern "globally.txt"`), so a cloned repo's `core.excludesFile` or a global ignore is easy to spot. `BlockedFileError.source` carries it. A `!` pattern in the verbose output is a negation, not a match. A repo config pointing `core.excludesFile` elsewhere can only add refusals, never remove them.
- The test file captures `HOME` at load and restores it in `afterAll`; vitest isolates files per worker, and the suite passes under `--sequence.shuffle` (run three times).
- The `check-ignore -v` parse only words the message. The decision fails closed: any output refuses unless the first line is positively a `!` negation (git reports those with exit 0). Output that cannot be parsed refuses with "ignored by git (details unavailable)". The line splits at the first tab and the first `:<digits>:`, so a colon in the pattern and a space in the file name are harmless (tested). The home directory is shown as `~` only when it is a whole leading path segment, so the full `/Users/...` path is never printed for it.
- Two ignore sources matching one file: git prints a single line, the pattern it applied (checked by hand: root `*.log`, a nested `!keep.log` and an `info/exclude` entry give only the nested negation), so a deeper negation allows the file, as git decides (tested end to end). If git ever printed more than one line, the decision is to refuse rather than guess which line wins (unit-tested).
- Errors may print absolute paths outside home in full (for example `/etc/...`); the README's "Reporting bugs" section tells people to read error text before pasting it publicly.
- Gitignore is checked on both the resolved target and the link's own path (directory resolved, final name kept), like the denylist: a link `x.log` matching `*.log` that points at an unignored file is refused (tested).
- Denylist adds only well-known credential names: `service-account*.json` (GCP keys), `token.txt`, `*.token` (incl. `.token`), `id_token`. `client_secret*.json`, `credentials.json`, `secrets.yml/.yaml` and `*.secret` were already caught by the whole-name-part `secret` rule (now tested). Principle: each entry is a commonly used credential file name, never a guess; no `*secret*` / `*token*` wildcards.
- `BlockedFileError.reason` is a tagged union: `{ kind: "denylist", name }` or `{ kind: "gitignore", source?, line?, pattern? }` (fields absent only when git's output could not be read; still refused). `rule` is a convenience getter. Ticket 14 (Context report) should branch on `reason.kind`, not parse messages.
- The core boundary test has a new read rule: only `read-file.ts` may open files (`readFile`, `open`, `createReadStream`, ...); everything else in core must go through `createFileReader`, so ticket 10+ cannot bypass the sensitive-file check.
- The README says plainly that the denylist is a safety net, not a guarantee; a key hardcoded in source passes every rule until content scanning exists. The piped/clipboard note remains for tickets 14 and 24.
