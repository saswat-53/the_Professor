# 35: Word references

**What to build:** `learn debounce` finds the identifier in the project and explains its definition.

**Blocked by:** 33 (@file references in chat), 04 (Reference grammar: line and range)

**Status:** ready-for-agent

- [ ] A bare word is searched for as an identifier within the project root, and the best definition becomes the Excerpt
- [ ] When nothing is found, the message says so
- [ ] Only files inside the project root and passing the Sensitive-file check are searched
- [ ] The Reference type gains a word kind with no change to existing callers
- [ ] The same works for a word typed in chat
