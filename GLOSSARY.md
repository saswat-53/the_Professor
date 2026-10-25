# Professor

A learning tool that helps developers understand code they don't fully get, by explaining the why behind code they point it at.

## Language

**Reference**:
What the user supplies to say which code they want explained: a file, a line, a line range, a word, piped input, clipboard content, or a git change.
_Avoid_: Target, selection, query, input

**Excerpt**:
The exact code a Reference resolves to, together with its **label**: the name shown to the model and the user for where it came from (for example `src/auth.ts:40-60`).
_Avoid_: Snippet, selection, chunk

**Context**:
The material gathered around an Excerpt to make it understandable: nearby lines, imports, and the enclosing block.
_Avoid_: Surroundings, background, scope

**Enclosing block**:
The smallest named function, method, or class (or class-like declaration such as an interface, struct, or namespace) that contains an Excerpt. An anonymous callback passed as an argument does not count; the named function around it does.
_Avoid_: Parent, container, scope

**Block finder**:
The replaceable component that locates the Enclosing block for an Excerpt, or finds nothing. The built-in one for brace languages (TypeScript, JavaScript, Java, Kotlin, C-family, C#, Go, Rust, PHP, Swift) scans for balanced braces, skipping strings and comments. When a finder finds nothing, Context falls back to a fixed window of nearby lines. The Python one reads indentation (a block runs from its first decorator to its last indented statement; blank lines, comments and multi-line strings do not end it early). A tree-sitter one may follow.
_Avoid_: Parser, scanner, locator

**Line span**:
A start and end line number in a file, 1-based and inclusive. A one-line span has the same start and end.
_Avoid_: Range (a Reference's `N-M` is the user's spelling; a span is the internal value), region

**Context report**:
The statement shown to the user of exactly what was sent to the model: which files, which lines, which method found the Enclosing block, and what was dropped to fit the budget (including the tail of an import statement that sat inside the window). It names the Budget and its source, notes Ollama's small default context window on a local endpoint, shows a Sensitive file as refused with the rule's name, and says when one was sent anyway: overridden by `--allow-sensitive`, or its check skipped because the endpoint is local, each naming the rule and the host. A whole-file Reference is named and marked as having no surrounding Context. Piped and clipboard input are also marked `no filename checks applied`, since they have no filename for a rule to check. Printed on stderr before the first streamed output, built from the same data as the request.
_Avoid_: Manifest, log, summary

**Budget**:
The most characters of Excerpt plus Context sent in one request: 24,000 for hosted endpoints, 8,000 for localhost, 127.0.0.1 and ::1 (those spellings only: `127.1` or `[0:0:0:0:0:0:0:1]` count as hosted), or whatever the context-budget setting says (`--context-budget`, `LEARN_CONTEXT_BUDGET`, or `context_budget` in the config file, in that order). Over budget, Context is dropped farthest from the Excerpt first (imports whole, before any nearby line). The Excerpt is never trimmed: one over half the Budget is refused (so on a local endpoint a whole-file Reference over 4,000 characters is). The Budget counts code only: the Excerpt's text and each Context line plus its newline; the fixed prompt text (labels, fences, system prompt) is extra. Length is JavaScript string length, so an emoji counts as 2: an estimate of size, not a token count.
_Avoid_: Limit, quota, window (the "window" is the fixed lines around an Excerpt)

**Project root**:
The directory learn treats as "the project": the git root above the current directory, else the current directory itself, or the `--root` directory when given. Files must resolve (after symlinks) inside it, and labels are written relative to it. With no repo and no `--root`, a file elsewhere is outside the root and refused.
_Avoid_: Workspace, base directory

**Session**:
One conversation: the first explanation of a Reference plus its follow-up questions.
_Avoid_: Chat, thread, conversation

**Session cap**:
The most characters of transcript (earlier turns plus the new question) a Session sends. Hosted endpoint: four times the Budget. Local endpoint: derived from the **Context window** (a quarter kept free for the answer, four characters a token, less the system prompt). Over the cap the oldest follow-up turns are dropped in question-and-answer pairs; the **pinned** part (the first Excerpt, its Context and the first explanation) and the most recent turns stay. A Session whose pinned part alone exceeds the cap is refused before the chat starts.
_Avoid_: Limit, truncation

**Pinned part**:
The first turn of a Session (the first Excerpt, its Context and the first explanation). Trimming never drops it. A **turn** is one question and its answer; turn 1 is the first explanation, follow-ups count from 2.

**Context window**:
The model's size in tokens, set with `context_window` / `LEARN_CONTEXT_WINDOW` / `--context-window` (default 4096, Ollama's default). Used only to derive the Session cap on a local endpoint, because an OpenAI-compatible endpoint does not report its real window.

**Chat**:
The interactive loop (`--chat`) over a Session: a `learn>` prompt where the user types follow-up questions. A multi-line paste goes between a `<<<` line and a `>>>` line. The Session is the conversation; the Chat is only how a terminal user drives it.

**Mention**:
An `@path` or `@path:N-M` token in a Chat question that attaches a file to that message. It counts only after whitespace and only if it names an existing file or looks like a path; it then goes through the same Sensitive-file check, Project root check and Excerpt limit as any Reference, and appears in the Context report for that message.
_Avoid_: Tag

**Plain mode / Terminal mode**:
Whether stdout is a terminal. In terminal mode the model's text has escape sequences, control characters (except newline and tab) and invisible bidi and zero-width characters removed, since the model's text is untrusted and could move the cursor, retitle the window or disguise a command. Colour on status lines is a separate choice (both streams terminals, `NO_COLOR` unset, `TERM` not `dumb`); stripping stays on whatever the colour preference. In plain mode (piped or redirected) the text is exactly as the model sent it. Decided in one place, `outputMode`.
_Avoid_: Interactive mode, TTY mode

**Level**:
How much background the learner is assumed to have: beginner, intermediate (the default), or expert. Set by `--level`, `LEARN_LEVEL`, or `level` in the config file, in that order.
_Avoid_: Mode, difficulty, skill

**Exit code**:
The number `learn` ends with, promised to script users: 0 success, 1 runtime or provider error, 2 usage or config error, 3 refused (a Sensitive file, a file that fails the reading rules, a file outside the Project root, or an Excerpt over budget), 130 cancelled by Ctrl-C (SIGINT), 143 cancelled by SIGTERM.
_Avoid_: Status code, return code

**Init wizard**:
`learn init`: asks for a provider **preset** (a set of defaults for base URL, model and key variable name: Ollama, OpenAI, or another OpenAI-compatible endpoint), the base URL, model, the *name* of the key variable, Level and notes directory, then writes the global config atomically (owner-only). It never asks for the key itself, needs a terminal, and writes nothing until the last answer, so Ctrl-C leaves any existing config untouched.
_Avoid_: Setup, installer

**Sensitive file**:
A file whose content must not be sent to a model without explicit consent, because it likely holds secrets.
_Avoid_: Secret file, protected file, private file

**Flag-only setting**:
A setting that widens what is read or sent (`--root`, `--allow-sensitive`) and so can be turned on only by a command-line flag for one run. The same names in an environment variable (`LEARN_ROOT`, `LEARN_ALLOW_SENSITIVE`) or the config file are ignored, with a warning that names them. A persistent file or variable can never silently widen access.
_Avoid_: Safety setting, override

**Key variable (`key_env`)**:
The name, set as `key_env` under `[provider]` in the config file, of the environment variable that holds the API key. It is the first place the key is looked for, ahead of the OS keychain entry for the endpoint's host (`learn auth set`): there is no key flag and no key field in the config (`--api-key` is an unknown option; `api_key` in the file is an unknown key, ignored with a warning that names the key, never its value). The value must look like a variable name, so a key pasted there is refused unechoed. A hosted endpoint needs a key from this variable or from the keychain (neither: exit 2, naming the variable); optional for a local one. `--dry-run` never needs it. Error messages may name the variable, never its value.
_Avoid_: API key setting, key field

**Keychain entry**:
A key stored in the OS keychain by `learn auth set`, under the service name `learn` and the base URL's host (plus `:port` when the URL names a non-default port), so a key stored for one host is never used for another. Used only when the key variable is unset or empty (the environment wins), and never for a local endpoint unless `key_env` is named. `learn auth delete` removes it. It comes from the optional dependency `@napi-rs/keyring`, loaded on first use; without it, or on a machine with no keyring, `learn auth set` fails saying so (exit 1) and the key variable still works. The key is typed with nothing shown, or piped on standard input, and never printed.
_Avoid_: Saved key, credential

**Base URL**:
Where requests are sent: an `http` or `https` URL written as `scheme://host[:port][/path]`, with no username, password, query or fragment in it (the key goes in the environment variable named by `key_env`). It is only ever printed through one function, which parses it and shows protocol, host and path, with a note of what was removed (`(removed: credentials, query, fragment)`). A value that does not parse as a web URL, or holds a backslash, whitespace or control character, is shown as `(value hidden)` and none of it is printed. The path is printed as the URL parser normalises it (it identifies the endpoint, so a key must never be put in it), and a key typed as the host prints as a lowercased host. Errors that reject a base URL name only protocol and host; `--dry-run` and `--show-prompt` keep the path, since they show what will be sent.
_Avoid_: Endpoint (the Endpoint is the parsed host plus whether it is local)
