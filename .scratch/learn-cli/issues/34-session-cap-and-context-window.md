# 34: Session cap, trimming, and the context_window setting

**What to build:** Long chats stay inside the model's window, and local models are not silently truncated.

**Blocked by:** 32 (Interactive chat basics), 15 (Settings resolution and the global config file)

**Status:** ready-for-agent

- [ ] The ticket first decides, and records, whether a `context_window` setting (in tokens, with the usual precedence) is added and how the local Session cap is derived from it, with a documented default that assumes Ollama's default window
- [ ] New `@file` material in one message counts against the context budget
- [ ] The transcript sent is capped at four times the context budget for hosted endpoints, and for local endpoints at a cap derived from the context window with room reserved for the answer
- [ ] Over the cap, the oldest turns are dropped in question-and-answer pairs; the first Excerpt, its Context, and the first explanation stay, along with the most recent turns
- [ ] The Context report names dropped turns and any dropped `@file` material
- [ ] A Session whose pinned part alone would exceed the cap is rejected up front with a clear message
