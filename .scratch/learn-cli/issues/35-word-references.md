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

## Comments

Follow-up after review:

- A word defined only in a skipped file (Sensitive, git-ignored, a link) reported plain "not found". The error now adds "N files were skipped because they are excluded by a safety rule": a count only, no name or rule. In chat, an `@word` that is not attached gets the same note, but only when files were skipped or the search hit its limit (so an `@handle` in a repo with a gitignored source file now produces one line).
- The 20,000-file cap is now stated: in the error, and in the Context report when a definition was found.
- Several definitions: the report says `chose X; also found in Y, Z` (five at most, then "and N more"), each as `file:N-M`.
- Search cost, measured on 10,000 source files (100 packages x 100 files x 200 lines, untracked, git repo): the first version took over 120 seconds, because every file went through `git check-ignore` once (one process per file). Files from the vetted list are now read with `readSearchable`, which keeps the root check and the file reading rules but skips that per-file git call. Now one search takes about 1.3 seconds (listing 0.14 s, the rest reading files). That is under the 1-2 second line, and a cached list would save about 10%, so there is no cache. At the 20,000-file cap expect about 2.5 seconds. Revisit if a repeated search in chat feels slow.
