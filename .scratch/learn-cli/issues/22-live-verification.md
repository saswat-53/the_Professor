# 22: Live verification: Ollama first, then one hosted provider

**What to build:** The tool is shown to work for real, locally and against a hosted provider, using opt-in tests that never run in default CI.

**Blocked by:** 05 (Typed errors and exit codes), 14 (Context report (the gate)), 16 (API key from a named environment variable, and secrets hygiene)

**Status:** ready-for-agent

- [x] Before wiring anything, the current package names, base URLs, and model names are checked against each provider's official documentation, and the findings are written into the ticket's notes
- [ ] An opt-in smoke test (enabled by an environment flag) streams a real explanation from local Ollama on localhost
- [ ] The same smoke test streams a real explanation from one hosted provider (DeepSeek or Gemini) using a key from the named environment variable
- [ ] The hosted run goes through the Sensitive-file check, project-root check, and Context report, and the report is visible in the output
- [ ] Default CI never runs these tests and never needs a key

## Comments

- Provider docs checked 2026-10-25 (official pages):
  - Ollama (docs.ollama.com/api/openai-compatibility): local base URL `http://localhost:11434/v1/`; the key is "required but ignored" locally; `/v1/chat/completions` supports streaming.
  - DeepSeek (api-docs.deepseek.com): OpenAI-compatible base URL `https://api.deepseek.com`; current models `deepseek-flash` and `deepseek-v4-pro` (`deepseek-v4-flash` is a retired alias); streaming supported.
  - SDK: `ai` 7.0.153 and `@ai-sdk/openai-compatible` 3.0.78 on npm, matching package.json. The Vercel AI SDK docs host could not be fetched, so the package name rests on npm itself.
  - Gemini was not checked; DeepSeek was chosen as the hosted provider.
- Implemented in `test/live.test.ts`. Enabled by `LEARN_LIVE=1`; Ollama half needs `LEARN_LIVE_OLLAMA_MODEL`, hosted half needs `DEEPSEEK_API_KEY` (read through `key_env` in a temp config, as a user would). Default CI sets none of these, and a test pins that the workflows never mention them.
- NOT yet verified live: this machine has no Ollama and no DeepSeek key, so the two streaming tests were skipped. The two hosted refusal tests (Sensitive file, outside project root) ran with a fake key and passed. Criteria 2 to 4 stay unticked until someone runs the command in the test file's header and records the result here.
