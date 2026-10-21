# 11: Brace-family Enclosing-block finder

**What to build:** For brace-delimited languages, an Excerpt inside a function, method, or class is explained with that whole block as Context.

**Blocked by:** 10 (Context: Enclosing-block interface, fallback window, imports)

**Status:** ready-for-agent

- [ ] For files with the extensions .ts .tsx .js .jsx .mjs .cjs .java .kt .c .h .cc .cpp .hpp .cs .go .rs .php .swift, the smallest enclosing function, method, or class is found
- [ ] Braces inside string literals and comments do not confuse the finder
- [ ] Nested blocks resolve to the smallest one; an Excerpt outside any block uses the fallback window
- [ ] All contract tests from ticket 10 pass against this implementation
- [ ] Other extensions still use the fallback window
