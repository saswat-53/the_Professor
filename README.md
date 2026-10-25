# Professor

`learn` is a command-line tool that explains the code you point it at: the *why*, not just the *what*, at your level (beginner, intermediate, or expert). It works with any OpenAI-compatible endpoint, including free local models through Ollama, using your own API key.

> **Status: early development (0.x).** Nothing is published yet, so there is no package to install. Flags, output and config may change before 1.0.
>
> Build from source: `npm install && npm run build`, then run `node dist/cli.js` (or `npm link`). Requires Node 22 or newer; tested on Node 22, 24 and 26.

## Contents

- [Quick start](#quick-start)
- [Privacy and safety](#privacy-and-safety)
- [Ways to give it code](#ways-to-give-it-code)
- [Interactive chat](#interactive-chat)
- [Configuration](#configuration)
- [Options](#options)
- [Exit codes](#exit-codes)
- [Reporting bugs](#reporting-bugs)
- [Design](#design) · [Credits](#credits) · [Licence](#licence)

## Quick start

```sh
learn src/auth.ts            # a whole file
learn src/auth.ts:42         # one line, with its enclosing function
learn src/auth.ts:40-60      # a line range
learn debounce               # a word: finds and explains its definition
```

With no config and no base URL or model set, `learn` prints an example config on stderr and exits 2. Save it as `~/.config/learn/config.toml` and uncomment exactly one provider block, or run `learn init` to be walked through it.

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

### `learn init`

A wizard that asks for a provider preset (Ollama, OpenAI, or another compatible endpoint), base URL, model, the *name* of the environment variable holding your key, level and notes directory. Then it writes `~/.config/learn/config.toml` (or under `XDG_CONFIG_HOME`).

- It never asks for the key itself; it tells you which variable to `export`.
- Needs a terminal (exit 2 without one).
- Nothing is written until the last answer, so Ctrl-C (exit 130) leaves an existing config untouched. The file is written to a temporary name, then renamed into place, owner-only (0600).
- An existing file supplies the defaults and is replaced only after you confirm.
- At the end it can send a one-word test request to your endpoint. A failure is reported, and the config stays saved.

## Privacy and safety

> **Your code leaves your machine.** The endpoint you configure receives the code you ask about: the lines you point at plus nearby lines, imports and the enclosing function. A hosted endpoint is a third party; Ollama on localhost stays on your machine. Choose accordingly.

- **Read-only.** It never modifies your files. The only thing it writes is notes you explicitly save.
- **No telemetry, analytics or update check.** The only network connection is to your configured endpoint (tested for Node-level connections during the covered runs).
- **Keys never touch config files or the command line.** See [API keys](#api-keys).
- **Plain `http` to a non-local host** prints a warning on stderr.

### Sensitive files

Before anything is sent, every file in the request (the one you named and the surrounding context) is checked. A file is **refused** (exit 3, naming the rule) if it likely holds secrets, either:

- by name: `.env`, `.env.*`, SSH keys, `service-account*.json`, names containing `secret`, `credentials` or `private-key`, and more; or
- because git ignores it, even if it is already tracked.

`--allow-sensitive` sends it anyway for one run. It is a flag only, never a config or environment setting, because a leaked key cannot be un-sent.

**Limits of this check.** It is a safety net, not a guarantee. It goes by file names and gitignore rules, so a key hardcoded in an ordinary source file passes every rule. The same goes for history: `--diff <ref>` against anything but HEAD, and `--blame`, can include a secret that was later removed. The Context report says so whenever that applies.

**Localhost is exempt** (`localhost`, `127.0.0.1`, `::1`), since nothing leaves your machine. That trusts the address, not the destination: a tunnel, port forward or local proxy on 127.0.0.1 may lead to a hosted model. Watch for `sensitive-file check skipped: … endpoint is local (host)` in the Context report.

**Project root.** Files must resolve (after symlinks) inside the project root: the git root above the current directory, else the current directory, or the `--root` directory. Anything outside is refused (exit 3).

### API keys

- Read from an environment variable, or from the OS keychain if you stored it with `learn auth set`.
- The environment variable wins when both exist.
- The config names the variable (`key_env = "OPENAI_API_KEY"` under `[provider]`). A hosted endpoint without it set exits 2 naming it; a localhost endpoint needs no key. `--dry-run` never needs the key.
- `learn auth set` takes the key typed with nothing shown, or piped on standard input. It is kept under the service `learn` and the endpoint's host, so it is never used for another host. `learn auth delete` removes it.
- The keychain library (`@napi-rs/keyring`) is an optional dependency. Without it, or on a machine with no keyring, `learn auth set` says so and the environment variable still works.

### The Context report

Before the first streamed output, `learn` prints on **stderr** exactly what it is sending: which files and lines, how the enclosing block was found, what was dropped to fit the budget, and any Sensitive file refused or sent anyway. It includes a budget line in a stable format that scripts can read:

```
local endpoint budget 4,096 characters (default)
hosted endpoint budget 24,000 characters (default)
budget N characters (setting)
```

## Ways to give it code

| Input | Example | Notes |
| --- | --- | --- |
| File, line or range | `learn src/auth.ts:40-60` | Includes surrounding lines, imports and the enclosing block |
| Identifier | `learn debounce` | Searches the project for the definition ([details](#identifier-lookup)) |
| Piped text | `cat file \| learn` | [Details](#piped-and-clipboard-input) |
| Clipboard | `learn --clip` | [Details](#piped-and-clipboard-input) |
| Uncommitted changes | `learn --diff [ref] [-- path...]` | Against HEAD or `ref` |
| Why lines changed | `learn --blame path:N-M` | From `git log -L` |

### Piped and clipboard input

Both are handled the same way: the whole text is the Excerpt, with no Enclosing block or imports. `--lang <name>` (for example `--lang python`) tells the model the language. The Excerpt size limit applies, and input over 1 MiB is refused (exit 3). The Context report says `no filename checks applied`, because there is no filename for the Sensitive-file rules to check; what you send goes as it is.

**Piped (`cat file | learn`)**
- If you give both a file Reference and piped input, the file wins and standard input is not read.
- With neither (a terminal on stdin, or an empty pipe), `learn` prints the usage and exits 2.

**Clipboard (`--clip`)**
- Reads with `pbpaste` on macOS; on Linux with `wl-paste` (tried first under Wayland) or `xclip` (tried first otherwise), falling back to the other if the first is missing.
- The tool is started directly with fixed arguments, never through a shell.
- If none is installed, `learn` names them and how to install one (for example `sudo apt install xclip`). Piping works everywhere.
- If the clipboard has no text (an image, say), it says so. If the tool cannot reach a display, it says so and does not try the other tool.
- Cannot be combined with a file reference (exit 2): both were asked for by name, whereas a pipe may be there by accident.
- Standard input is not read.

### Identifier lookup

`learn debounce` (a word, not a file or `path:N-M`) searches the project's source files for the best definition and explains it.

**Ranking.** A source file beats a test file; then a `function`, `class`, `def` or similar declaration beats a `const`/`let` or property bound to the name, which beats a method; then the shallower path wins. The definition's whole block is the Excerpt (up to 80 lines, else just its first line), and the Context report names the file and lines. If a word is defined in several files, the report says `chose X; also found in Y, Z` (five at most, then a count), each as `file:N-M`, so you can ask for another by reference.

**What is searched.** Only source files (by extension) inside the project root. Never searched, whatever `--allow-sensitive` or a local endpoint says, because the search reads files nobody pointed at:
- Sensitive files and git-ignored files (even tracked ones)
- symbolic links
- vendored and build directories such as `node_modules`, `.venv`, `dist` and `build`

**Not found.** `learn` says so (exit 2) and gives a count of files skipped by a safety rule (never a name or rule, since either could reveal what a file holds). For a lowercase word, the error also lists the valid commands.

**Limits.** At most 20,000 source files are read; if the project has more, the error (or the Context report, if something was found) says the search stopped. A search over 10,000 files of 200 lines takes about 1.3 seconds, mostly reading files.

### Reserved words

`learn auth` is a reserved subcommand (not available yet; exits 2). A bare word that is not a command or an existing file is looked up as an identifier. A file named `init` is still reachable as `./init`.

## Interactive chat

`--chat` keeps a Session going after the explanation, with follow-up questions at a `learn>` prompt. It needs a terminal (exit 2 otherwise) and cannot be combined with `--dry-run`. Follow-ups carry the earlier turns, so the model remembers them.

### Typing and leaving

- Type a question and press Enter.
- **Multi-line paste:** type `<<<` on its own line, paste, then `>>>` on its own line. (These markers are used because code contains `"""` and trailing backslashes.)
- **Leave:** `/exit`, Ctrl-D, or Ctrl-C at the prompt (exit 0).
- **Cancel an answer:** Ctrl-C while streaming cancels only that answer, and that turn is not remembered. A second Ctrl-C exits immediately. SIGTERM ends the chat with 143.
- Anything typed or pasted while an answer streams is discarded. The note gives only the number of lines, never their text, so a pasted block cannot turn into several questions.

### Attaching code with `@`

| Write | Meaning |
| --- | --- |
| `@path` or `@path:10-20` | Attach a file or range |
| `@"my file.ts"` or `@my\ file.ts` | Paths with spaces |
| `@debounce` | Attach that word's definition, if the project has one ([lookup rules](#identifier-lookup)) |

A token counts only if it follows whitespace and either names an existing file or looks like a path (has a `/` or an extension), so `me@example.com` is left alone. A bare `@word` with no definition (like `@Injectable`) stays plain text.

- Each attached file gets the same Sensitive-file check, project-root check and Excerpt limit as the first Reference (a whole file over the limit asks for a range), and a Context report is printed before the answer.
- Files attached to one message must fit in half the context budget; the error names the file that went over.
- A file mentioned twice is attached once, with a note.
- If any attachment fails, you get an inline error and the message is not sent.

### The transcript cap

The transcript sent with each question is capped so a long chat stays inside the model's window:

- **Hosted endpoint:** four times the context budget (96,000 characters by default).
- **Local endpoint:** derived from `--context-window` ([see Configuration](#context-window)).

Over the cap, the oldest follow-up turns are dropped, a question and its answer together. The first Excerpt with its Context, the first explanation, and the most recent turns are kept. The Context report printed before the answer names the dropped turns and any `@file` material that went with them. Two edge cases:

- If a message only fits once every follow-up is gone, the most recent turns go too, and the model will not remember them.
- If the first Excerpt and explanation alone exceed the cap, `learn` says so and does not start the chat (exit 3). A single message too big to fit beside them is refused and the chat goes on.

### Chat commands

| Command | What it does |
| --- | --- |
| `/save [slug]` | Write the Session as a markdown note |
| `/glossary term: meaning` | Add a line to the glossary |
| `/quiz` | Test yourself on the Session |
| `/exit` | Leave the chat |

The Session lives in memory until you save it; nothing else is ever written.

**Notes (`/save` and `/glossary`).** Both write only inside the notes directory (`notes_dir`, default `~/learn-notes`, created private if missing).

- `/save` makes one file named by date and a sanitised slug (the default is your Reference), such as `2026-10-25-src-auth-ts-40-60.md`. It never overwrites: a second save the same day becomes `...-2.md`.
- The file is checked, with symlinks resolved, to be inside the notes directory, and is readable only by you.
- It begins with a warning that it contains code (your Excerpt, questions and the answers), so check it for secrets before sharing. Turns dropped to fit the cap are not in the note. Terminal escape sequences are removed.
- If the Session included a normally excluded file (via `--allow-sensitive`, or because the endpoint is local), the note says so under its first line.
- `glossary.md` is refused if it is a symlink or has more than one hard link.
- `notes_dir` must be an absolute path or start with `~/`. A relative value, or `~name`, is refused with the key and file named, so notes can never land in whatever project you ran `learn` from by accident.
- If the notes directory is inside a git work tree, `learn` warns once, before the first write, that the notes could be committed by accident. Add the folder to `.gitignore` or choose another.

**Quiz (`/quiz`).**

1. One request asks the model for five questions as JSON. A malformed reply gives an error and no quiz.
2. You answer each in your own words, one at a time. The model grades the answer and ends with a suggested answer.
3. `/skip` passes a question; `/quit` stops the quiz (so does Ctrl-C while a grade is streaming). A pasted `<<<`…`>>>` block works as an answer.

The quiz and its grading are not added to the Session (so they are not in `/save` notes), and no score or history is kept. The questions and your answers are sent to the configured endpoint like any other message, along with the Session.

## Configuration

Each setting comes from, in order of priority:

1. its flag
2. its environment variable: `LEARN_BASE_URL`, `LEARN_MODEL`, `LEARN_LEVEL`, `LEARN_CONTEXT_BUDGET`, `LEARN_CONTEXT_WINDOW`
3. the config file: `~/.config/learn/config.toml`, or `$XDG_CONFIG_HOME/learn/config.toml` when that variable is an absolute path (unset or relative falls back to `~/.config`)
4. a default

Run `learn <file>` with no config to see an example.

**Flag-only settings.** `--root` and `--allow-sensitive` can only be set by flag. `root` or `allow_sensitive` in the config file, and `LEARN_ROOT` or `LEARN_ALLOW_SENSITIVE` in the environment, are ignored with a warning.

### Base URL and value rules

- Keys never go in the URL: a base URL with a username or password is refused. A URL's path is printed after normalisation (dots resolved, host lowercased, default port dropped), so never put a key there either.
- A base URL cannot carry a query or fragment (the request path is added after it).
- Stray whitespace around a flag or variable, such as a trailing newline from `$(cat file)`, is trimmed; a whitespace-only value counts as not set.
- Values in the config file are taken as written, so a stray space there is an error. The file is edited on purpose, while a shell variable often picks up a trailing newline.

### Context window

An OpenAI-compatible endpoint does not report its real window, so for a local endpoint (`localhost`, `127.0.0.1`) you state it in tokens with `context_window` (config), `LEARN_CONTEXT_WINDOW` or `--context-window`. The default is 4096, Ollama's default below 24 GiB of VRAM.

- **Budget.** Unless you set `--context-budget`, the local default budget follows the window: a third of its prompt share, so 4,096 characters with the default window.
- **Chat cap.** `--chat` keeps a quarter of the window free for the answer, counts the rest at four characters a token, and takes the system prompt off. 4096 tokens gives about 10,900 characters.
- **Raising it.** Do it after raising Ollama's own length (the app's context-length slider, or `OLLAMA_CONTEXT_LENGTH`; `ollama ps` shows what is allocated).
- **Hosted endpoints.** Setting `context_window` prints a warning and is ignored; the hosted window is far larger than the cap the budget gives.

## Options

| Option | What it does |
| --- | --- |
| `--level <beginner\|intermediate\|expert>` | How much background to assume (default `intermediate`) |
| `--root <dir>` | Treat this directory as the project root. Flag only |
| `--allow-sensitive` | Send Sensitive files anyway, for this run. Flag only |
| `--clip` | Explain the clipboard text |
| `--lang <name>` | Language hint for piped or clipboard input |
| `--diff [ref] [-- path...]` | Explain uncommitted changes (see below) |
| `--blame path:N-M` | Explain why a range of lines changed (see below) |
| `--chat` | Keep a Session going after the explanation ([chat](#interactive-chat)) |
| `--dry-run` | Print the Context report and the exact request (both on stderr), send nothing. Needs no API key |
| `--show-prompt` | Run normally and also print the request on stderr (see warning below) |
| `--base-url`, `--model`, `--context-budget`, `--context-window` | Override those settings for one run |
| `-h`, `--help` | Print usage and the exit-code table to stdout, exit 0 |
| `-v`, `--version` | Print the version to stdout, exit 0 |

A flag's value may not start with `-`: `--model --dry-run` is a usage error (exit 2), not a model called `--dry-run`.

**`--show-prompt` warning.** With `--chat` it prints every follow-up request too, including all earlier turns, so the first Excerpt (and anything secret-looking in it) appears again each turn. That is what is sent, but do not paste this output into a bug report.

### `--diff [ref] [-- path...]`

Explains your uncommitted changes (staged and unstaged, plus untracked files as new files) against HEAD, or against `ref`.

- `-- path...` limits it to those files or directories, as in git. A path before the `--` is a conflicting file reference.
- Every changed file goes through the Sensitive-file rules. Excluded files are named in the Context report and their changes are not sent.
- The diff must fit the budget (exit 3 otherwise).

### `--blame path:N-M`

Explains why a range of lines changed. The history comes from git's line-range log (`git log -L`, which follows the lines through edits and renames). The commit messages and patches go to the model as evidence; it is told it can only explain what the history shows and must mark intent no message states as a guess.

- The file, and every earlier name of it, goes through the Sensitive-file rules (a blocked one refuses the request).
- **Secrets inside history can't be filtered by name.** A secret committed in an ordinary file and later removed is still in the patches, and the Context report says so.
- A shallow clone adds a note that history is incomplete.
- The history must fit the budget (exit 3 otherwise).

### Output streams

Output goes to stdout; the Context report, warnings and errors go to stderr. When stdout is a terminal, escape sequences and control characters in the model's text are removed (the text is untrusted); when piped, it is left exactly as sent. If the output pipe closes early (`learn file | head`), the run ends quietly with the exit code of any failure already found, else 0.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Runtime or provider error |
| 2 | Usage or config error |
| 3 | Refused: a Sensitive file, a file that fails the reading rules, a file outside the project root, an excerpt over budget, or a git repository owned by another user (git's own safety check, never overridden) |
| 130 | Cancelled by Ctrl-C (SIGINT) while a request is running |
| 143 | Cancelled by SIGTERM |

In `--chat`, Ctrl-C at the idle `learn>` prompt is an ordinary way to leave and exits 0, as in `python` or `sqlite3`; 130 stays for cancelling a request. Ctrl-C during a streaming answer cancels only that answer.

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
