# 28: Native Gemini provider

**What to build:** The user can choose Gemini as the provider, behind the same interface.

**Blocked by:** 27 (Native Anthropic provider)

**Status:** deferred (not ready for an agent; revisit after Anthropic support has shipped and the provider interface has settled)

- [ ] Gemini can be selected through the provider type setting
- [ ] A streamed explanation works against a fake Gemini-style server
- [ ] Errors map to the same typed errors
- [ ] Package names and model names are verified against the official docs before wiring, and noted in the ticket
