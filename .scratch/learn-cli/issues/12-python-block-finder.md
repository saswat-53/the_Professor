# 12: Python Enclosing-block finder

**What to build:** For Python files, an Excerpt inside a function or class is explained with that whole block as Context.

**Blocked by:** 10 (Context: Enclosing-block interface, fallback window, imports)

**Status:** ready-for-agent

- [ ] For .py files, the smallest enclosing def or class is found by indentation
- [ ] A decorator above a function is included in its block
- [ ] A multi-line function signature is handled
- [ ] Blank lines and comments inside a block do not end it early
- [ ] All contract tests from ticket 10 pass against this implementation
