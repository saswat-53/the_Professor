# 22: Live verification: Ollama first, then one hosted provider

**What to build:** The tool is shown to work for real, locally and against a hosted provider, using opt-in tests that never run in default CI.

**Blocked by:** 05 (Typed errors and exit codes), 14 (Context report (the gate)), 16 (API key from a named environment variable, and secrets hygiene)

**Status:** ready-for-agent

- [ ] Before wiring anything, the current package names, base URLs, and model names are checked against each provider's official documentation, and the findings are written into the ticket's notes
- [ ] An opt-in smoke test (enabled by an environment flag) streams a real explanation from local Ollama on localhost
- [ ] The same smoke test streams a real explanation from one hosted provider (DeepSeek or Gemini) using a key from the named environment variable
- [ ] The hosted run goes through the Sensitive-file check, project-root check, and Context report, and the report is visible in the output
- [ ] Default CI never runs these tests and never needs a key
