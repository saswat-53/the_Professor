# 32: Interactive chat basics

**What to build:** After the first explanation, the user can keep asking questions in the same Session.

**Blocked by:** 14 (Context report (the gate)), 17 (Plain and terminal output modes), 19 (Cancellation: Ctrl-C and SIGTERM)

**Status:** ready-for-agent

- [ ] Follow-up questions get answers that remember the earlier explanation (the fake server receives the earlier turns)
- [ ] The Session lives in memory only and nothing is written to disk
- [ ] The chat refuses to start when there is no terminal, with a message and exit code 2
- [ ] A documented multi-line input convention lets a user paste code
- [ ] Ctrl-C during a response cancels only that response; Ctrl-C at an idle prompt ends the chat
- [ ] The interface uses readline, and core has no knowledge of it
