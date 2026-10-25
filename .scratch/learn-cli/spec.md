Status: ready-for-agent

# Spec: `learn`, a model-agnostic CLI that teaches you the code you point it at

Vocabulary follows `GLOSSARY.md` (Reference, Excerpt, Context, Enclosing block, Session, Level, Sensitive file, Context report). Decisions that are hard to reverse are in `docs/adr/` (0001 refuse sensitive files, 0002 single package with an enforced core boundary, 0003 trusted publishing and the no-surprise-network promise).

## Problem Statement

Developers constantly meet code they don't fully understand: an unfamiliar auth module, a clever helper, a diff in review, a line that "has always been like that". Asking a general chat assistant means copy-pasting code and hand-assembling the surrounding context, and the answers explain *what* the code does rather than *why* it is written that way. Existing coding agents are tied to one vendor, can edit files, and aren't built for learning. Developers also don't want their code, or their API keys, sent anywhere they didn't choose.

## Solution

A command-line tool, `learn`, that you run from inside any project. You point it at a Reference (a file, a line, or a line range, later a word, piped input, the clipboard, or a git change). It resolves the Reference to an Excerpt, gathers Context around it (nearby lines, imports, the Enclosing block), and streams back a teaching-focused explanation that covers the why, scaled to your Level. It is strictly read-only. It works with any OpenAI-compatible endpoint (local Ollama for free, or a hosted provider) using your own key, which is never stored in plain text. It tells you exactly what it sent (the Context report), refuses to send Sensitive files by default, and makes no network call except to the endpoint you configured. Later milestones add multiple providers, an interactive chat with `@file` references, git-aware modes, notes and quizzes, and a floating desktop app on the same core.

## User Stories

### Pointing at code (Milestone 1)
1. As a developer, I want to run `learn` with a file path, so that I get an explanation of that whole file.
2. As a developer, I want to run `learn` with `path:N`, so that I get an explanation of one specific line in its surroundings.
3. As a developer, I want to run `learn` with `path:N-M`, so that I can ask about a precise range.
4. As a developer, I want line numbers to be 1-based and inclusive, so that they match what my editor shows.
5. As a developer, I want a clear message when I give line 0, a negative number, or a non-integer, so that I know what I typed wrong.
6. As a developer, I want a clear error when the range is reversed, so that I can fix it.
7. As a developer, I want the error for a line past the end of the file to tell me the file's real line count, so that I can correct the number.
8. As a developer with a file literally named like `a:b`, I want that file to win over parsing the colon, so that unusual names still work.
9. As a developer, I want a bare word such as `learn debounce` to give a clear "not supported yet" message, so that I understand it isn't a bug.
10. As a developer, I want paths resolved relative to my current directory and checked against the project root, so that I never accidentally point at something outside it.
11. As a developer, I want line counting to ignore Windows line-ending differences, so that line numbers mean the same on every platform.

### Understanding the explanation (Milestone 1)
12. As a learner, I want the explanation to start with a one-line summary, so that I get the gist immediately.
13. As a learner, I want it to cover what the code does, why it is written this way, and common pitfalls, so that I learn the reasoning and not just the behaviour.
14. As a beginner, I want simpler vocabulary and more background, so that I'm not lost.
15. As an expert, I want terse, assumption-heavy explanations, so that I'm not talked down to.
16. As a learner, I want the tool to say "I can't tell from the provided Context" instead of guessing, so that I'm not misled.
17. As a learner, I want the explanation to stream as it is generated, so that I can start reading immediately.
18. As a learner, I want the code I point at to be treated as data and not as instructions to the model, so that a malicious comment can't hijack the explanation.

### Context (Milestone 1)
19. As a developer, I want the Enclosing block included automatically, so that a single line is explained in its function.
20. As a developer, I want the file's import block included, so that the model knows what the names refer to.
21. As a developer, I want a fixed window of lines around the Excerpt when no Enclosing block is found, so that I always get useful Context.
22. As a developer, I want Enclosing-block detection for common languages and a graceful fallback for the rest, so that unfamiliar file types still work.
23. As a developer, I want the Context trimmed to a budget, farthest from the Excerpt first, so that big files don't blow the model's window or my bill.
24. As a developer, I want the Excerpt itself never silently trimmed, so that I know what was asked.
25. As a developer, I want a clear "narrow your range" message when the Excerpt alone exceeds its limit, so that I know what to do.
26. As a developer, I want a Context report on stderr listing the files and lines sent, the method that found the Enclosing block, and anything dropped, so that I can see exactly what the model saw.
27. As a developer using a minified file, I want the budget message and not a crash, so that I understand why it was refused.
28. As a developer using local Ollama, I want a note that its default context window is small and how to raise it, so that I'm not confused by truncated answers.

### Reading files safely (Milestone 1)
29. As a developer, I want only regular files read, so that devices, pipes, and directories can't be pointed at by mistake.
30. As a developer, I want the size checked before reading and files over 1 MB refused, so that nothing huge is loaded into memory.
31. As a developer, I want files containing a NUL byte in their first 8 KB refused as binary, so that garbage isn't sent to a model.
32. As a developer, I want files that aren't valid UTF-8 refused with the message "not UTF-8 text", so that I'm not sent mangled characters.
33. As a developer, I want a BOM stripped and CRLF normalised before the model sees the text, so that the content is clean.
34. As a developer, I want symlinks resolved to their real path and read through that path, so that a symlink can't smuggle in a file from outside the project.

### Privacy and secrets (Milestone 1)
35. As a developer, I want Sensitive files (gitignored files and a built-in denylist such as environment files and private keys) refused by default, so that I never leak secrets by accident.
36. As a developer, I want every file in the Excerpt and the Context checked, not just the Reference, so that a secret can't ride along in the Context.
37. As a developer, I want the error to name the rule that blocked a file, so that I understand and can decide to override.
38. As a developer, I want an explicit `--allow-sensitive` override, so that I stay in control.
39. As a developer using a local endpoint, I want the refusal skipped, so that local use with Ollama isn't annoying. A local endpoint means the base URL host is localhost, 127.0.0.1, or ::1.
40. As a developer, I want the tool to say plainly when filename rules could not be applied (piped and clipboard input), so that I don't assume protection I don't have.
41. As a developer, I want paths outside the project root rejected unless I pass `--root`, so that the tool stays inside my project.
42. As a developer, I want the project root to be the nearest git root, or the current directory when there is no repo, so that project context stays optional.
43. As a developer, I want a warning when the root turns out to be my home directory, so that I don't accidentally expose a broad area.
44. As a developer, I want `--root` to be a flag only (never a config or env setting), so that a persistent setting can't silently widen access.

### Providers, keys and configuration (Milestone 1)
45. As a developer, I want to use any OpenAI-compatible endpoint by giving a base URL, model name, and key variable, so that I'm not tied to one vendor.
46. As a developer, I want to run entirely locally against Ollama on localhost, so that I pay nothing and send nothing off my machine.
47. As a developer, I want the base URL and model resolved by flag, then environment variable, then config file, then default, so that precedence is predictable.
48. As a developer, I want my API key read only from the environment variable named in the config, so that the key is never in a file, a flag, shell history, or the process list.
49. As a developer, I want the key variable to be optional for localhost endpoints, so that Ollama needs no key.
50. As a developer, I want the error for a missing key to name the missing variable, so that I know what to export.
51. As a developer, I want key values never printed anywhere, including in debug output, so that screen-shares and logs are safe.
52. As a developer, I want a warning when I configure plain `http` to a non-local host, so that I don't send code over an unencrypted link.
53. As a developer, I want one global config file in the standard per-user config location (respecting the standard config-directory environment variable), so that settings are the same in every project.
54. As a developer, I want project-local config rejected by design, so that cloning a repo can never change where my code is sent.
55. As a developer, I want unknown config keys to produce a warning naming the typo, and invalid values to produce an error naming the key and the file, so that misconfiguration is easy to fix.
56. As a developer, I want a helpful first-run message with an example config when none exists, so that I can get started without a wizard.
57. As a developer, I want the example config's alternative provider lines clearly documented as alternatives, so that I don't uncomment several at once.
58. As a developer, I want `~` expanded in the notes directory setting, so that natural paths work.
59. As a developer, I want my level to be beginner, intermediate or expert (default intermediate), resolved by flag, then environment variable, then config file, then default, and validated, so that typos are caught.
60. As a developer, I want the context budget to be configurable, with defaults of 24,000 characters for hosted endpoints and 8,000 for local ones, so that I can match my model's window.

### Seeing and testing what is sent (Milestone 1)
61. As a developer, I want `--show-prompt` to print the exact system prompt and user message to stderr before the request, so that I can see what the model saw and learn how prompts work.
62. As a developer, I want `--dry-run` to assemble the request and print it without contacting the endpoint, so that I can check what would be sent.
63. As a developer, I want both to show the base URL and model, so that I can confirm where the request would go.
64. As a developer, I want both to print only after the blocked-file check, so that they can never display a refused file's contents.
65. As a developer, I want the Authorization header never printed, so that debug output is shareable.

### Terminal behaviour (Milestone 1)
66. As a developer, I want colours and spinners only when stdout is a terminal, so that scripts and pipes get clean text.
67. As a script author, I want status and error messages on stderr and the explanation alone on stdout, so that I can capture the explanation.
68. As a user, I want `NO_COLOR` respected, so that my terminal preferences are honoured.
69. As a script author, I want documented exit codes (0 success, 1 runtime or provider error, 2 usage or config error, 3 refused for a blocked file or budget, 130 interrupted, 143 terminated), so that I can react to failures.
70. As a user, I want Ctrl-C and SIGTERM to cancel the in-flight request cleanly, so that nothing hangs or leaks.
71. As a script author, I want a closed pipe (for example `| head`) to end quietly, so that I don't see a stack trace.
72. As a user in a terminal, I want control characters other than newline and tab removed from the model's output, so that a response can't inject terminal escape sequences (moving the cursor, rewriting the title, hiding text).
73. As a user, I want typed, friendly errors for a bad key, rate limit, network failure, model not found, context too long, and blocked file, with no raw provider output shown, so that errors are understandable and don't leak details.
74. As a user, I want no automatic retries, so that a failure is quick and I'm never billed twice unknowingly.

### Piped input and clipboard (Milestone 2)
75. As a developer, I want `cat file | learn` to explain the piped text, so that it composes with other commands.
76. As a developer, I want `--clip` to explain what's on my clipboard, so that I can ask about code from anywhere.
77. As a developer, I want piped and clipboard input sent as the Excerpt only (no Enclosing block or imports), with an optional `--lang` hint, so that the model knows the language.
78. As a developer, I want the tool not to hang when stdin is an empty terminal, so that running it with nothing piped gives a usage message.
79. As a developer, I want clear behaviour when I give both a file Reference and piped input, so that I'm not surprised by which one is used.
80. As a developer, I want the Excerpt size limit to apply to piped and clipboard input too, so that a huge paste can't bypass the budget.

### Multi-provider, init and keychain (Milestone 2)
81. As a developer, I want `learn init` to walk me through provider preset, base URL, model, key variable name, level and notes directory, so that setup is guided.
82. As a developer, I want `init` to refuse to run when there's no terminal, handle Ctrl-C, and write the config atomically (permissions restricted to me), so that a half-written config can never exist.
83. As a developer, I want `init` to optionally send a one-word test request, so that I know my setup works.
84. As a developer, I want `learn auth set` to read my key with hidden input and store it in the OS keychain, so that it never touches a file or my shell history.
85. As a developer, I want key entries scoped by the base URL host, so that a key for one provider isn't sent to another.
86. As a developer, I want the env var to win over the keychain, and the keychain to be an optional dependency loaded lazily, so that the tool works without it.
87. As a developer on a headless Linux machine, I want a plain error that no keychain is available and that the environment variable still works, so that I'm not stuck.
88. As a developer, I want native Anthropic and Gemini support added behind the same provider interface, so that I'm not limited to OpenAI-compatible endpoints.

### Interactive chat (Milestone 3)
89. As a learner, I want to ask follow-up questions in the same Session, so that I can dig deeper.
90. As a learner, I want `@path` and `@path:10-20` inside a message to attach code, so that I can bring in related files.
91. As a learner, I want a token to count as a Reference only if it follows whitespace and resolves or looks like a path, so that email addresses and decorators aren't mistaken for files.
92. As a learner, I want quoting and escaping for paths with spaces, so that all file names work.
93. As a learner, I want a missing or blocked `@file` to show an inline error and not send the message, so that nothing is sent half-formed.
94. As a learner, I want a whole file over the Excerpt limit to ask for a range, so that the budget is respected.
95. As a learner, I want a documented way to enter multi-line messages, so that I can paste code.
96. As a learner, I want the chat to refuse to start without a terminal, so that scripts don't hang.
97. As a learner, I want a bare word Reference to search the project for the identifier and explain its definition, so that I can ask about names directly.
98. As a learner, I want a per-message budget for new `@file` material and a per-Session cap on the transcript, so that long chats stay within the model's window.
99. As a learner, I want the Session cap on local models derived from the endpoint's real window with room reserved for the answer, so that local models don't silently truncate.
100. As a learner, I want oldest turns dropped in question-and-answer pairs while the first Excerpt, Context and explanation stay pinned, so that the conversation keeps its anchor.
101. As a learner, I want the Context report to say which turns and which `@file` material were dropped, so that I know what the model no longer sees.
102. As a learner, I want the pinned part unable to exceed the cap, so that the Session can't start in an impossible state.
103. As a learner, I want my Session kept in memory only and never written automatically, so that my code isn't stored behind my back.

### Notes, quizzes and git (Milestone 4)
104. As a learner, I want `/save` to write the Session as a markdown note and `/glossary term: meaning` to add glossary entries (typed by me, not generated), so that I keep what I learned.
105. As a learner, I want notes written only inside my notes directory (default `~/learn-notes`), with the slug sanitised, the final path checked, and files created exclusively so nothing is overwritten, so that `/save` is the one safe write.
106. As a learner, I want each note to carry a warning that it contains code, so that I think before sharing it.
107. As a learner, I want `/quiz` to generate five questions from the current Session in one validated request, so that testing is cheap and reliable.
108. As a learner, I want to answer one question at a time in free text, with the model grading and suggesting a better answer, so that I learn from mistakes.
109. As a learner, I want to skip a question or quit the quiz at any time, so that I'm not trapped.
110. As a developer, I want `--diff` to explain my uncommitted changes (staged and unstaged) against HEAD, optionally against a ref, so that I understand a change.
111. As a developer, I want untracked files and a repository with no commits handled, so that `--diff` works on a brand-new project.
112. As a developer, I want `--blame path:N-M` to use the history of that range with commit messages and patches as evidence, so that I learn why code changed.
113. As a developer, I want the model told it can only explain what the history shows and to mark undocumented intent as a guess, so that I'm not given invented reasons.
114. As a developer, I want the budget applied to diffs and history, the blocked-file path rules applied to every file in a diff, and the diff and history delimited as data, so that git modes are as safe as file modes.
115. As a developer in a shallow clone, I want a note that history is incomplete, and a plain statement that secrets in history can't be filtered by name, so that I'm not misled about safety.

### Trust and distribution
116. As a privacy-conscious developer, I want the tool to make no network call except to my configured endpoint, no telemetry, no analytics and no update check, so that I can trust it with my code.
117. As a privacy-conscious developer, I want the README to say the configured endpoint receives my code, so that the trade-off is explicit.
118. As a user, I want to try it with `npx` and install it globally to get the `learn` command, so that adoption is frictionless.
119. As a user, I want releases published with provenance from CI, so that I can verify where the package came from.
120. As a maintainer, I want the tool to run on current supported Node versions with the minimum declared, so that users aren't broken by end-of-life runtimes.
121. As a future desktop-app author, I want the core to work with no project and no terminal, so that a floating app can reuse it.

## Implementation Decisions

### Product shape and naming
- npm package name `professor-cli` (re-check availability before first publish; `learn`, `learn-cli` and `professor` are taken). The single command it installs is `learn`.
- Single package with two top-level areas: core and cli (ADR 0002). Core never imports from cli, never touches stdout, argv or terminal libraries, and never imports file-write APIs; an automatic check fails the build if it does. Core returns data and the CLI decides display.
- TypeScript on Node, `engines` set to Node 22 or newer; CI runs 22, 24 and 26; a Node version file is committed; a lockfile is committed. Re-verify the supported-Node table when raising the floor (22 reaches end of life in April 2027).
- Vitest for tests, tsup for bundling. The bundle must include the teaching prompt file.
- Platforms: macOS and Linux. All path handling goes through the platform path utilities so Windows can follow later.
- MIT licence; semver 0.x until Milestone 3; this is documented in the README.

### Core interface (the main seam)
- Core exposes four capabilities: resolve a Reference, gather Context, build the prompt, and explain. Explain returns an asynchronous stream of typed events (a discriminated union): context report, text delta, done, error (the error event may carry a `kind` so the frontend can pick an exit code). The prompt's user message starts with a `File: <label>` header naming where the Excerpt came from. It takes the request, settings, a Session and an abort signal.
- File reading, git execution and the model are passed in as plain dependencies. The blocked-file check lives inside file reading so no caller can bypass it.
- The Reference type is open to new kinds. Milestone 1 supports file, line and range; a word kind is added in Milestone 3 without changes elsewhere.
- The Enclosing-block finder is defined as an interface first. The Milestone 1 implementation is heuristic and skips strings and comments when matching braces. Brace-based families: `.ts .tsx .js .jsx .mjs .cjs .java .kt .c .h .cc .cpp .hpp .cs .go .rs .php .swift`. Indentation family: `.py` (including decorators and multi-line signatures). Every other extension uses the fixed fallback window. The Context report states which method was used. This extension list is the starting point and may be extended.
- Context rules: Enclosing block, or 25 lines either side when none is found; the file's import block; total capped by the context budget (24,000 characters hosted, 8,000 local, configurable), dropping farthest-from-the-Excerpt first, applied to the Enclosing block too; the Excerpt hard limit is 50% of the active budget, and exceeding it is the context-too-long error with a "narrow your range" hint. Character counts are an estimate of tokens (roughly four characters per token).
- The teaching prompt is a plain, versioned text file bundled with the package. It asks for a one-line summary, then what, why and pitfalls, scaled to the Level; it tells the model that supplied code is delimited data and not instructions; and it requires "I can't tell from the provided Context" over guessing.

### Reference grammar
- Forms: path, path:N, path:N-M. 1-based, inclusive. Lines counted after CRLF normalisation. Reject line 0, negatives, non-integers, reversed ranges, and lines past the end (the error shows the real line count). If a file whose name contains a colon exists exactly as typed, it wins. Open-ended ranges are not supported.

### File reading rules
- Regular files only, size checked via stat before reading, 1 MB maximum. A NUL byte in the first 8 KB means binary and is refused. Content must decode as strict UTF-8, else the error says "not UTF-8 text". Strip a BOM and normalise CRLF. Paths are resolved to real paths (symlinks followed) and read through the resolved path; the relative path from the project root must not escape it.

### Sensitive files (ADR 0001)
- Block files matched by gitignore or by a built-in denylist (environment files, private-key and certificate files, key-named files); check every file in the Excerpt and Context; name the rule in the error; `--allow-sensitive` overrides; exemption when the base URL host is localhost, 127.0.0.1 or ::1. Piped and clipboard input aren't covered by filename rules, and the Context report says so. Content scanning and redaction is a later step.

### Project root
- Root is found with git's own root detection, else the current directory. Warn when the root is the home directory. Anything resolving outside the root is rejected unless `--root` is passed. `--root` exists only as a flag.

### Provider (Q8)
- Milestone 1 ships one provider: a generic OpenAI-compatible endpoint, through the Vercel AI SDK's model interface so native providers can plug into the same interface in Milestone 2. Settings are base URL, model, and the name of the environment variable holding the key. Base URL and model resolve by flag, then environment variable (`LEARN_BASE_URL`, `LEARN_MODEL`), then config file, then default. The key comes only from the named environment variable (optional for local hosts); a missing variable is named in the error; key values and the Authorization header are never printed.
- Develop against Ollama on localhost first, then verify one hosted provider (DeepSeek or Gemini). Before wiring, check current package names, base URLs and model names against each provider's official documentation. As of this spec, `ai` 7.x and `@ai-sdk/openai-compatible` 3.x are the published SDK packages; confirm at build time.
- Warn on plain http to a non-local host. Localhost detection is by the base URL's host only.

### Configuration
- One global TOML file in the per-user config directory (`~/.config/learn/config.toml`, honouring the standard config-directory variable). Never project-local. Keys: level; context budget; notes directory (with `~` expanded); provider with base URL, model, key variable name. Environment overrides: `LEARN_LEVEL`, `LEARN_MODEL`, `LEARN_BASE_URL`, `LEARN_CONTEXT_BUDGET`. Precedence everywhere: flag, then environment, then config, then default. Unknown keys warn; invalid values error with key and file. Resolution is built once so provider and model settings reuse the same mechanism as level. The file is written with owner-only permissions. A missing file yields a helpful first-run message with an example whose alternatives are marked as alternatives, shown when the base URL or model is also not set by flag or environment (an invalid file gets its own error instead).

### CLI behaviour
- Argument parsing with the platform's built-in parser in Milestone 1; switch to `commander` in Milestone 2 when `init` and `auth` arrive, overriding its default usage exit code to 2. Set the process exit code and let the process end naturally rather than exiting early. Handle a closed output pipe quietly.
- Exit codes: 0 success; 1 runtime or provider error; 2 usage or config error; 3 refused (blocked file or over budget); 130 SIGINT; 143 SIGTERM. The table is in the README.
- Output: explanation alone on stdout, streamed as raw markdown. All status, Context report, warnings and errors on stderr. Terminal mode adds colour to status lines only; plain mode (stdout not a terminal) has no colour and no spinner; `NO_COLOR` respected. In terminal mode, strip control characters other than newline and tab from the model's output. The stripper is stateful across stream chunks, so a sequence split at any position is still removed. It handles CSI and OSC sequences (including OSC terminated by BEL or by ST) and the 8-bit C1 control characters (0x80 to 0x9F, which include single-byte CSI and OSC introducers). An unterminated sequence at the end of the stream is discarded, not emitted.
- `--show-prompt`: print the exact system prompt and user message to stderr before the request. `--dry-run`: assemble and print the request without any network call. Both print the base URL and model, run only after the blocked-file check, and never print the Authorization header or key values.
- Cancellation: SIGINT and SIGTERM cancel the in-flight request through the abort signal. No automatic retries.
- Errors are a small typed set: bad key, rate limit, network, model not found, context too long, blocked file. The CLI turns each into a friendly message. Raw provider output is never shown.

### Session and budgets (Milestones 2 and 3)
- Sessions live in memory only. Two limits apply: new `@file` material per message counts against the context budget; the transcript sent is capped at four times the context budget for hosted endpoints, and for local endpoints at a cap derived from the real context window with room reserved for the answer. Oldest turns are dropped in question-and-answer pairs. The first Excerpt, its Context and the first explanation stay pinned, along with the most recent turns. The Context report names the dropped turns and any dropped `@file` material. The pinned part is validated so it can never exceed the cap. No automatic summarising.

### Piped input and clipboard (Milestone 2)
- Excerpt only, optional `--lang` hint, the Excerpt size limit applies, no filename rules (stated in the Context report). Do not block waiting on an empty terminal. When both a file Reference and piped input are given, the behaviour is defined and documented (decided in the ticket). Clipboard access uses the platform's tooling on macOS and Linux, spawned with fixed arguments and no shell, with nothing from the user or the clipboard interpolated into the command. When the tool is missing (for example no clipboard utility on Linux), the error says which tool is missing and how to install it or to use piped input instead.

### Init and keychain (Milestone 2)
- `learn init` refuses without a terminal, handles Ctrl-C, writes atomically, never asks for the key value until the keychain exists, then tells the user which variable to export. `learn auth set` reads the key with hidden input. The keychain library is `@napi-rs/keyring` (maintained, ships prebuilt binaries; `keytar` is archived), as an optional, lazily loaded dependency. Keychain entries are keyed by service `learn` and the base URL host. Lookup order: the environment variable, then the keychain. A headless Linux machine without a keyring gets a plain error and the environment variable still works.

### Chat (Milestone 3)
- Interactive mode on `node:readline/promises`, refusing to start without a terminal; Ctrl-C cancels the in-flight request as in one-shot mode. A multi-line input convention is defined and documented in the ticket. A token is an `@file` Reference only when preceded by whitespace and when it resolves or looks like a path; quoting and escaping supported; a missing or blocked file produces an inline error and the message is not sent. Tab completion is a CLI-only concern. Bare-word References search the project for the identifier.

### Notes and quiz (Milestone 4)
- `/save` writes only inside the notes directory (default `~/learn-notes`, configurable), one markdown file per Session named by date and a sanitised slug, glossary entries appended to a single glossary file. The final path is checked with real paths to be inside the notes directory, files are created exclusively (never overwritten), and each note starts with a warning that it contains code. This is the only write the tool ever performs.
- `/quiz` builds five questions from the current Session in one validated model call, asks them one at a time in free text, grades each answer with feedback phrased as a suggested answer, allows skip and quit, and stores no scores.

### Git modes (Milestone 4)
- `--diff` explains uncommitted changes (staged and unstaged) against HEAD, with an optional ref. `--blame path:N-M` runs git's line-range history and gives the model the commit messages and patches as evidence, with the instruction to mark intent not found in the history as a guess.
- Git hardening list: only the read-only subcommands `log`, `diff`, `blame`, `show` and `rev-parse` are ever run; git is run without a shell; `--` is placed before every path; refs starting with `-` are rejected; external diff drivers and pagers are disabled (`--no-ext-diff`, `--no-pager`); every path must stay inside the project root; root is found with git's own root detection; untracked files and a repository with no HEAD are handled; the budget applies to diffs and history; path rules for Sensitive files run on every file in a diff; diff and history are delimited as data in the prompt; shallow clones produce a note; the Context report says plainly that secrets inside history can't be filtered by name.

### Publishing (ADR 0003)
- Releases are published from GitHub Actions with npm trusted publishing (OIDC), which generates provenance automatically. Requirements: npm CLI 11.5.1 or newer and Node 22.14 or newer in the release job; permission to mint an ID token; a public repository and public package; a `repository` field that exactly matches the GitHub repo; no package-manager cache in the release job. The trusted publisher is configured in the package's settings on npmjs.com and must have its first successful publish within two days. Assume the very first publish is manual from a maintainer's machine with two-factor authentication, because the setup lives in an existing package's settings (unconfirmed in the docs). Afterwards, set the package to require two-factor authentication and disallow tokens. 2FA is enabled on the maintainer's npm account.
- No telemetry, analytics or update check; no network call except to the configured endpoint. The README says the configured endpoint receives the user's code.

## Testing Decisions

- A good test checks external behaviour through one of the two seams, never internal functions. Tests don't mock modules the code owns; they inject fakes at the boundaries (model, clock) and use real things for the rest.
- **Seam 1: core `explain`.** Input: a Reference string, settings, a Session and an abort signal, with real file reading and real git against a real temporary directory and a real temporary git repository. Output: the event stream. The model is a fake that records exactly what it was sent and can emit scripted chunks, errors and delays. Covers: Reference grammar (including line 0, negatives, reversed ranges, past-the-end with the real count, and the `a:b` file rule); file-reading rules (binary, invalid UTF-8, BOM, CRLF, size, symlinks, non-regular files); path escape and root; Sensitive file blocking in the Excerpt and in the Context with the named rule; Context assembly, budgets, farthest-first trimming, Excerpt limit; prompt content (level, delimiters, data-not-instructions); Session trimming (pairs, pinned part, the pinned-cannot-exceed-cap check, the dropped-material report); git hardening (every item on the list, plus untracked files, missing HEAD, shallow clones); typed errors; cancellation.
- Enclosing-block contract tests are written against the interface, not the heuristic, so a future tree-sitter implementation can reuse them. They cover brace families (skipping strings and comments) and the Python family (decorators, multi-line signatures), plus the fallback window.
- **Seam 2: the `learn` CLI as a black box.** Input: argv, environment, stdin, a real temporary HOME and config file, against a small local fake OpenAI-compatible HTTP server. Output: stdout, stderr, exit code. Covers: precedence of flag, environment, config, default for level, base URL, model, budget; config validation messages (unknown key warning, invalid value error naming key and file); `--show-prompt` and `--dry-run` (no network call on dry run, base URL and model shown, nothing printed before the blocked-file check, no key or Authorization header); plain mode produces no ANSI escape codes (a test asserts this on piped output); terminal escape stripping; `NO_COLOR`; stderr/stdout separation; exit-code table; closed pipe; Ctrl-C and SIGTERM; `--root`; the http-to-non-local warning; the localhost exemption and its non-exemption for look-alike hosts.
- **Escape stripper tests:** run against the stripper's behaviour (text in as chunks, text out). For every escape sequence in the test set (CSI, OSC ended by BEL, OSC ended by ST, bare ESC, 8-bit C1 introducers), the input is split at every possible position, including between the ESC and the next character and one character at a time, and the output must always equal the unsplit result. Newline and tab survive; printable text, including non-ASCII letters, is unchanged; an unterminated sequence at end of stream is discarded.
- **Secret-canary test:** a canary secret planted in a Sensitive file and in the Context must never appear in the request body, the output, or debug output.
- **No-network test:** a guard asserts that the only connection the CLI opens is to the configured endpoint, and that no update check, telemetry or other call occurs; this runs in CI.
- **Boundary test:** an automatic check fails if core imports from cli, touches stdout, argv or terminal libraries, or imports write APIs.
- Snapshots are small and used for the prompt builder and the Context report only.
- An opt-in smoke test (enabled by an environment flag, never in CI by default) runs a real request against local Ollama and one hosted provider.
- Prior art: none yet (greenfield). The first tests set the pattern for the rest.

## Out of Scope

- The floating desktop app (Milestone 5).
- Content scanning and redaction of secrets in code, history, piped and clipboard input (a later step; filename rules only for now).
- A tree-sitter (exact) Enclosing-block finder; the interface leaves room for it.
- Rendering markdown in the terminal, and syntax highlighting.
- Summarising old Session turns, and any persistent or automatic transcript storage.
- Quiz history, scores, spaced repetition, and quizzing from saved notes.
- Windows support; project-local configuration; automatic retries; telemetry of any kind.
- Native Anthropic and Gemini providers before Milestone 2.
- Word References before Milestone 3.

## Further Notes

- **Milestones** match the build order: M1 weekend MVP (stories 1 to 74); M2 multi-provider, config tooling, piped input and clipboard (75 to 88); M3 chat (89 to 103); M4 notes, quiz and git (104 to 115); M5 desktop app. Piped input and `--clip` were not placed in the original build order; they are placed in M2 here and can be moved.
- **Decision for the M3 ticket (the `context_window` setting):** an OpenAI-compatible endpoint doesn't report its real context window, so the local Session cap needs a source. The ticket must decide whether to add a `context_window` setting (in tokens, following the usual flag, environment, config, default precedence) from which the local cap is derived, with a documented default that assumes Ollama's default window, and whether it also applies to hosted endpoints. Querying the endpoint is an optional later improvement. Ollama's default window depends on VRAM (about 4k tokens below 24 GiB); it can be raised in the Ollama app's settings or by starting the server with a context-length environment variable, and `ollama ps` shows the allocated length. The stderr note in Milestone 1 uses this wording.
- **Small gaps filled here, to confirm in tickets:** terminal-escape stripping also covers sequences split across stream chunks; in the chat, Ctrl-C at an idle prompt ends the chat while Ctrl-C during a response cancels only that response.
- **Teaching:** the project owner is learning as they build. Each ticket should name the concepts it introduces (for example: abort signals, async iteration, dependency injection, exit codes, symlink escape, command injection, snapshot testing) in its notes so they can be looked up.
