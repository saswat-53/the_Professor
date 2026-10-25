# 35: Word references

**What to build:** `learn debounce` finds the identifier in the project and explains its definition.

**Blocked by:** 33 (@file references in chat), 04 (Reference grammar: line and range)

**Status:** done

- [x] A bare word is searched for as an identifier within the project root, and the best definition becomes the Excerpt
- [x] When nothing is found, the message says so
- [x] Only files inside the project root and passing the Sensitive-file check are searched
- [x] `buildRequest` accepts custom resolvers, so a kind can be added without editing its callers (ticket 04 only proved the resolver table is open)
- [x] The Reference type gains a word kind with no change to existing callers
- [x] The same works for a word typed in chat
