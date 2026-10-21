# 27: Native Anthropic provider

**What to build:** The user can choose Anthropic as the provider, behind the same interface as the OpenAI-compatible one.

**Blocked by:** 05 (Typed errors and exit codes), 22 (Live verification: Ollama first, then one hosted provider)

**Status:** ready-for-agent

- [ ] A provider type setting chooses between OpenAI-compatible and Anthropic, with the usual flag, environment, config, default precedence
- [ ] With Anthropic selected, a streamed explanation works against a fake Anthropic-style server
- [ ] Bad key, rate limit, and model-not-found map to the same typed errors as before
- [ ] The key still comes only from the named environment variable
- [ ] Package names and model names are verified against the official docs before wiring, and noted in the ticket
