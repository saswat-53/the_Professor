# 14: Context report (the gate)

**What to build:** Before anything is sent, `learn` tells the user exactly what it is about to send. This ticket is the gate: it is blocked by typed errors (05), project root (08), Sensitive files (09), and the budget (13), so being blocked by it means being blocked by all of them. Anything that sends real files to a provider is blocked by this ticket.

**Blocked by:** 05 (Typed errors and exit codes), 08 (Project root and path escape (Q27)), 09 (Sensitive files (Q2, ADR 0001)), 13 (Context budget and Excerpt limit)

**Status:** ready-for-agent

- [ ] A Context report on stderr lists each file and line range sent, the method that found the Enclosing block ("heuristic" or "fallback window"), and anything dropped for budget
- [ ] The report appears before the first streamed output and never on stdout
- [ ] When the endpoint is local, the report includes a note that Ollama's context window is small by default and how to raise it: the app's context-length slider, or starting the server with the context-length environment variable, checked with `ollama ps`
- [ ] The report is built from the same data as the request, shown by a test that compares the two
- [ ] A file refused by a Sensitive-file rule appears in the report as refused with the rule's name, not as content
