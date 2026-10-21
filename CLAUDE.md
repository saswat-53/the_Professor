# Professor

## Overview
A global, model-agnostic learning CLI (working name: `learn`) that helps developers understand code they don't fully get. The plan below is an initial draft from an earlier brainstorm and will be refined.

### Core behavior
- Point it at code from inside any project:
  - `learn "src/auth.ts:40-60"` (line, range, word, or file reference)
  - `@file` references in the interactive chat
  - piped input: `cat file | learn`
  - clipboard: `--clip`
  - git-aware modes: `--diff`, and `--blame file:line` (uses `git log -L` to explain why code changed)
- Automatically gathers surrounding context (nearby lines, imports, enclosing function) and sends it to an LLM.
- Teaching-focused system prompt: explains the *why*, not just the *what*, and adapts to beginner / intermediate / expert level.
- Strictly read-only: never modifies the user's files.
- Follow-up questions in the same session; `/save` writes notes or glossary entries to local markdown; `/quiz` tests the user.

### Provider and config requirements
- Not tied to Claude Code or any single vendor. Bring-your-own API key for OpenAI, Anthropic, Gemini, Ollama (free, local), or any OpenAI-compatible endpoint.
- Configured via a `learn init` wizard and `~/.config/learn/config.toml`.
- Keys come from environment variables or the OS keychain. Never store keys in plain text.

### Stack
- TypeScript on Node
- Vercel AI SDK for the provider layer
- Ink or readline for the interactive chat
- Vitest for tests, tsup for bundling
- Distribution via npm/npx

### Architecture
- Reusable core library: context resolver, prompt builder, provider layer, session store.
- Thin frontends on top of the core. CLI first; a floating desktop app (Tauri or Electron, global hotkey that grabs selected text or clipboard and opens the same chat) comes later.
- Project context must be optional, since a floating app won't always know the active project.

## Build order
1. Weekend MVP: `learn file:line`, one provider, streaming output.
2. Multi-provider support and config.
3. Interactive chat with `@file` references.
4. Git features, notes, and quiz mode.
5. Floating desktop app.

## Next steps
- Propose a folder structure and the teaching system prompt.
- Build step 1.

## Skills
- Matt Pocock's skills (mattpocock/skills) are installed in `.claude/skills`, starting with `ask-matt` (router). Versions are tracked in `skills-lock.json`.

## Workflow
1. `/grill-with-docs` on the plan first, to find gaps before any code.
2. `/to-spec` turns the refined plan into a spec, then `/to-tickets` splits it into milestone-sized tickets matching the build order.
3. Build with `/tdd`, starting with pure core logic (parsing `file:line`, context resolver, prompt builder). Mock the LLM provider in tests.
4. Use `/codebase-design` and `/improve-codebase-architecture` to keep the core library fully separate from the frontends.
5. Use `/diagnosing-bugs` and `/code-review` as we go.

## Teaching preference
The goal is to learn, not just ship. For each design decision or new concept (async/await, streaming, stdin handling, provider abstraction, etc.), briefly explain what it is and why we chose it, and name the concept so it can be looked up. Keep explanations short; go deeper when asked.

## Commands
<!-- Add build, test, and run commands here once the project has code. -->

## Conventions
<!-- Add code style, structure, and workflow notes here. -->

## Agent skills

### Issue tracker

Issues and specs are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
