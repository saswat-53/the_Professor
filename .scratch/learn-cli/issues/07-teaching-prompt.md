# 07: Teaching prompt, Level, and --show-prompt

**What to build:** The explanation is shaped by a bundled teaching prompt that adapts to the Level, and `--show-prompt` shows exactly what the model was sent.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** done

- [x] The prompt asks for a one-line summary, then what the code does, why it is written this way, and common pitfalls (a small snapshot test)
- [x] `--level beginner|intermediate|expert` changes the prompt; an invalid value exits 2 and lists the valid choices; the default is intermediate
- [x] A file containing the text "ignore previous instructions" appears inside the code delimiter, and the prompt states that delimited content is data, not instructions
- [x] The prompt tells the model to say "I can't tell from the provided Context" rather than guess
- [x] `--show-prompt` prints the exact system prompt and user message on stderr before the request, and they match byte for byte what the fake server received
- [x] The built bundle, run from a different working directory, still finds the prompt

## Comments

**Done in `5445dce`.**

Concepts to look up: system prompt vs user message, prompt injection, delimiters (a backtick fence longer than any run inside the code, so the code can't close it early), snapshot testing, bundler loaders (tsup/esbuild `text` loader, so the prompt ships inside `dist/cli.js`), the `onRequest` hook (callback), so `--show-prompt` prints exactly what is sent.

Decisions:
- `--level` resolves flag, then default only. Environment and config precedence belong to the settings ticket (15).
- The snapshot covers all three levels.
- No test yet for `--show-prompt` together with a blocked file, because blocked-file checking comes in ticket 09.

Review notes left alone: the prompt says "provided Context" although only the Excerpt is sent until Context assembly (tickets 10 to 13) exists. The tests parse the printed request format, so they need updating if that format changes.
