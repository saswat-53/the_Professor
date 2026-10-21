# 33: @file references in chat

**What to build:** A user can attach code to a question by typing `@path` or `@path:10-20`.

**Blocked by:** 32 (Interactive chat basics)

**Status:** ready-for-agent

- [ ] A token is a Reference only when it follows whitespace and either resolves or looks like a path; an email address or a decorator is not mistaken for one
- [ ] Quoting and escaping support paths with spaces
- [ ] A missing or blocked file produces an inline error and the message is not sent
- [ ] Each attached file goes through the Sensitive-file check, the project-root check, and the Excerpt limit; a whole file over the limit asks for a range
- [ ] Attached material appears in the Context report for that message
