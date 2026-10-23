# 12: Python Enclosing-block finder

**What to build:** For Python files, an Excerpt inside a function or class is explained with that whole block as Context.

**Blocked by:** 10 (Context: Enclosing-block interface, fallback window, imports)

**Status:** done

- [x] For .py files, the smallest enclosing def or class is found by indentation
- [x] A decorator above a function is included in its block
- [x] A multi-line function signature is handled
- [x] Blank lines and comments inside a block do not end it early
- [x] All contract tests from ticket 10 pass against this implementation

## Comments

- Decision: named `def`, `async def` and `class` count; lambdas do not (as in ticket 11). A block runs from its first decorator to the last statement indented deeper than the `def`; trailing blank lines and comments are excluded.
- Decision: the file is split into logical lines (brackets, backslashes and triple-quoted strings join physical lines) before indentation is compared, so a string line at column 0 or a comment never ends a block. Tabs count to the next multiple of 8.
- Decision: an unterminated triple-quoted string makes the finder return nothing (fallback window), like unbalanced braces in ticket 11.
- Decision: the default finder is `defaultBlockFinder` (report name `builtin`), which tries Python then braces; each only recognises its own extensions. Only `.py` is handled, not `.pyi`.
- Known limitation (safe): f-strings that reuse their own quote type inside `{}` (Python 3.12+) may confuse string skipping.
