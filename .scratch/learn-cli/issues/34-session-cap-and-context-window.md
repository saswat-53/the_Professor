# 34: Session cap, trimming, and the context_window setting

**What to build:** Long chats stay inside the model's window, and local models are not silently truncated.

**Blocked by:** 32 (Interactive chat basics), 15 (Settings resolution and the global config file)

**Status:** implemented, awaiting Linux CI

- [x] The ticket first decides, and records, whether a `context_window` setting (in tokens, with the usual precedence) is added and how the local Session cap is derived from it, with a documented default that assumes Ollama's default window
- [x] New `@file` material in one message counts against the context budget
- [x] The transcript sent is capped at four times the context budget for hosted endpoints, and for local endpoints at a cap derived from the context window with room reserved for the answer
- [x] Over the cap, the oldest turns are dropped in question-and-answer pairs; the first Excerpt, its Context, and the first explanation stay, along with the most recent turns
- [x] The Context report names dropped turns and any dropped `@file` material
- [x] A Session whose pinned part alone would exceed the cap is rejected up front with a clear message

## Comments

**Decision (first criterion).** A `context_window` setting is added (tokens; `--context-window`, `LEARN_CONTEXT_WINDOW`, `context_window`; flag, env, config, default). Default 4096, Ollama's default below 24 GiB of VRAM. It applies to **local endpoints only**: a hosted window (128k tokens or more, about 500k characters) is far above the hosted cap of four times the budget (96,000 characters by default), so the budget alone governs there and a window setting would add a knob that changes nothing. Querying the endpoint for its real window stays an optional later improvement.

**Local cap:** `floor(window x 0.75) x 4 - system prompt chars`. A quarter of the window is reserved for the answer, tokens are estimated at four characters each (as for the budget), and the system prompt, which rides along with every request, is subtracted. At 4096 tokens that is about 10,900 characters.

**Implemented.**
- `resolveSessionCap` in `src/core/budget.ts`; `Session` in `src/core/session.ts` now holds numbered turns. `planFor(question)` works out which oldest follow-up pairs to leave out; the drop is committed only in `record`, so a failed or cancelled question loses nothing.
- Turn 1 (first Excerpt, Context, first explanation) is pinned. `assertPinnedFits` runs before the first request is sent (the Excerpt alone) and again after the explanation (with the answer); either failure is a `SessionTooLongError` (a `ContextTooLongError`, exit 3), and the chat does not start.
- A message that cannot fit beside the pinned part even with every follow-up dropped is refused (nothing sent, Session unchanged, chat goes on).
- A new `session-trimmed` Context report names the dropped turns (turn 1 is the explanation, follow-ups count from 2) and any `@file` references attached to them; `Attached.files` carries those references into the Session.
- New `@file` material counting against the budget was already done in ticket 33 (half the budget per message); a test shows it also counts toward the Session cap.
- `learn init` carries an existing `context_window` over when it rewrites the config.

**Unverified on Linux CI:** the three new pty tests in `test/cli-chat.test.ts` depend on how much text a pseudo-terminal buffers (pastes are kept to about 1,200 characters because a larger echo deadlocked the test helper on macOS). Mark done after a green run on Node 22/24/26.

Concepts to look up: token estimation (characters per token), context window vs output reserve, sliding-window truncation with a pinned prefix, plan-then-commit (keeping a failed request side-effect free), subclassing errors so a frontend can word advice differently.
