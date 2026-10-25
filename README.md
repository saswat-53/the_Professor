# Professor

`learn` is a command-line tool that explains the code you point it at, with the *why* and not just the *what*, at your level (beginner, intermediate, or expert). It works with any OpenAI-compatible endpoint, including free local models through Ollama, using your own API key.

**Status: early development.** Nothing is published yet, so there is no package to install; build from source (`npm install && npm run build`, then run `node dist/cli.js`). It needs Node 22 or newer and is tested on Node 22, 24 and 26. It is a 0.x version: flags, output and config may change before 1.0.

## Quick start

```sh
learn src/auth.ts            # a whole file
learn src/auth.ts:42         # one line, with its enclosing function
learn src/auth.ts:40-60      # a line range
```

(Until it is published, run it as `node dist/cli.js`, or link it with `npm link`.) With no config file and no base URL or model set, `learn` prints an example `~/.config/learn/config.toml` on stderr and exits 2. The example, with the provider blocks marked as alternatives (uncomment exactly one):

```toml
level = "intermediate"
notes_dir = "~/learn-notes"

# Alternative 1: Ollama, local and free
# [provider]
# base_url = "http://localhost:11434/v1"
# model = "llama3.1"

# Alternative 2: OpenAI (the key stays in your environment, never in this file)
# [provider]
# base_url = "https://api.openai.com/v1"
# model = "gpt-4o-mini"
# key_env = "OPENAI_API_KEY"
```

Any OpenAI-compatible endpoint works the same way (DeepSeek, for example: `base_url = "https://api.deepseek.com"`).

## Your code leaves your machine

The endpoint you configure **receives the code you ask about**: the lines you point at plus nearby lines, imports and the enclosing function. With a hosted endpoint that is a third party; with Ollama on localhost it stays on your machine. Choose the endpoint accordingly.

## Privacy promise

- Strictly read-only: it never modifies your files. The only thing it will ever write is notes you explicitly save.
- Files that likely hold secrets (`.env`, private keys, gitignored files) are refused by default. This is a safety net, not a guarantee: it goes by file names and gitignore rules, so a key hardcoded in an ordinary source file passes every rule. Only content scanning, a later step, can catch that.
- Your API key is read from an environment variable (later, the OS keychain). It is never stored in a config file or passed on the command line. The config names the variable (`key_env = "OPENAI_API_KEY"` under `[provider]`); a hosted endpoint without that variable set exits 2 naming it, while a localhost endpoint needs no key. `--dry-run` never needs the key. Plain `http` to a non-local host prints a warning on stderr.
- No telemetry, no analytics, no update check. The only network connection is to the endpoint you configure (tested for Node-level connections during the covered runs), and that endpoint receives the code you ask about.

### Sensitive files

Before anything is sent, every file that goes into the request (the one you named and the surrounding context) is checked. A file that likely holds secrets, by name (`.env`, `.env.*`, SSH keys, `service-account*.json`, names containing `secret`, `credentials` or `private-key`, and more) or because git ignores it (even if it is already tracked), is **refused**: exit 3, with the rule's name. Pass `--allow-sensitive` for one run to send it anyway; it is a flag only, never a config or environment setting, because a leaked key cannot be un-sent.

A **localhost** endpoint (`localhost`, `127.0.0.1`, `::1`) is exempt, since nothing leaves your machine. That exemption trusts the address, not the destination: a tunnel, port forward or local proxy on 127.0.0.1 may lead to a remote or hosted model. The Context report's note `sensitive-file check skipped: … endpoint is local (host)` is the cue to notice.

Files must also resolve (after symlinks) inside the project root: the git root above the current directory, else the current directory, or the `--root` directory. A file outside it is refused with exit 3.

### The Context report

Before the first streamed output, `learn` prints on **stderr** exactly what it is sending: which files and lines, how the enclosing block was found, what was dropped to fit the budget, and any Sensitive file refused or sent anyway. It includes a budget line, a format kept stable so scripts can read it:

- `local endpoint budget 8,000 characters (default)`
- `hosted endpoint budget 24,000 characters (default)`
- `budget N characters (setting)`

## Piped input

`cat file | learn` explains the piped text. It is the whole Excerpt, with no Enclosing block or imports. `--lang <name>` (for example `--lang python`) tells the model the language. Piped text has no filename, so the Sensitive-file rules cannot be applied to it; the Context report says `no filename checks applied`, and what you pipe is sent as it is. The Excerpt size limit applies, and input over 1 MiB is refused (exit 3).

If you give both a file Reference and piped input, the file wins and standard input is not read. With neither (a terminal on stdin, or an empty pipe), `learn` prints the usage and exits 2.

## Clipboard input

`learn --clip` explains whatever is on the clipboard, handled like piped input: the whole text is the Excerpt with no Enclosing block or imports, `--lang <name>` works, the Excerpt size limit and the 1 MiB cap apply, and the Context report says `no filename checks applied`. It reads the clipboard with `pbpaste` on macOS, and on Linux with `wl-paste` (under Wayland) or `xclip` (otherwise). The tool is started directly with fixed arguments, never through a shell. If it is not installed, `learn` names it and how to install it (for example `sudo apt install xclip`); piping the text in works everywhere. `--clip` cannot be combined with a file reference (exit 2), and standard input is not read.

## Configuration

Each setting comes from its flag, then its environment variable (`LEARN_BASE_URL`, `LEARN_MODEL`, `LEARN_LEVEL`, `LEARN_CONTEXT_BUDGET`), then the config file (`~/.config/learn/config.toml`, or `$XDG_CONFIG_HOME/learn/config.toml` when that variable is set to an absolute path; if it is unset or relative, `~/.config` is used), then a default. Run `learn <file>` with no config to see an example. Only a flag can set `--root` or `--allow-sensitive`. `root` or `allow_sensitive` in the config file, and `LEARN_ROOT` or `LEARN_ALLOW_SENSITIVE` in the environment, are ignored with a warning.

Keys go in an environment variable, never in the URL at all: a base URL with a username or password is refused, and a URL's path is printed after the URL parser has normalised it (dots resolved, host lowercased, default port dropped), so never put a key there either. A base URL cannot carry a query or fragment (the request path is added after it), and stray whitespace around a flag or variable, such as a trailing newline from `$(cat file)`, is trimmed (a value that is only whitespace counts as not set). Values in the config file are taken as written, so a stray space there is an error: the file is edited on purpose, while a shell variable often picks up a trailing newline.

## Options

| Option | What it does |
| --- | --- |
| `--level <beginner\|intermediate\|expert>` | How much background to assume (default `intermediate`) |
| `--root <dir>` | Treat this directory as the project root. Flag only |
| `--allow-sensitive` | Send Sensitive files anyway, for this run. Flag only |
| `--clip` | Explain the clipboard text (`pbpaste`, `wl-paste` or `xclip`) |
| `--lang <name>` | Language hint for piped or clipboard input |
| `--dry-run` | Print the Context report and the exact request (both on stderr), send nothing. Needs no API key |
| `--show-prompt` | Run normally, and also print the request (system and user prompts) on stderr |
| `--base-url`, `--model`, `--context-budget` | Override those settings for one run |
| `-h`, `--help` | Print usage to stdout, exit 0 |
| `-v`, `--version` | Print the version to stdout, exit 0 |

Output goes to stdout; the Context report, warnings and errors go to stderr. When stdout is a terminal, escape sequences and control characters in the model's text are removed (the text is untrusted); when piped, it is left exactly as sent. If the output pipe closes early (`learn file | head`), the run ends quietly with the exit code of any failure already found, else 0.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Runtime or provider error |
| 2 | Usage or config error |
| 3 | Refused: a Sensitive file, a file that fails the reading rules, a file outside the project root, an excerpt over budget, or a git repository owned by another user (git's own safety check, never overridden) |
| 130 | Cancelled by Ctrl-C (SIGINT) |
| 143 | Cancelled by SIGTERM |

A second Ctrl-C exits immediately.

## Reporting bugs

Error messages can contain file names and paths from your machine (a path outside your home directory is printed in full). Read the text before pasting it into a public issue, and remove anything you don't want shared.

## Design

- [Spec](.scratch/learn-cli/spec.md)
- [Tickets](.scratch/learn-cli/issues/)
- [Decision records](docs/adr/)
- [Glossary](GLOSSARY.md)

## Credits

Planning and development workflow uses the agent skills from [Matt Pocock's skills](https://github.com/mattpocock/skills) (MIT licensed). They are not included in this repository; `skills-lock.json` records the versions used.

## Licence

[MIT](LICENSE)
