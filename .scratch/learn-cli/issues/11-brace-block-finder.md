# 11: Brace-family Enclosing-block finder

**What to build:** For brace-delimited languages, an Excerpt inside a function, method, or class is explained with that whole block as Context.

**Blocked by:** 10 (Context: Enclosing-block interface, fallback window, imports)

**Status:** done

- [x] For files with the extensions .ts .tsx .js .jsx .mjs .cjs .java .kt .c .h .cc .cpp .hpp .cs .go .rs .php .swift, the smallest enclosing function, method, or class is found
- [x] Braces inside string literals and comments do not confuse the finder
- [x] Nested blocks resolve to the smallest one; an Excerpt outside any block uses the fallback window
- [x] All contract tests from ticket 10 pass against this implementation
- [x] Other extensions still use the fallback window

## Comments

- Decision: what counts as an Enclosing block. Functions, methods and constructors; classes and class-like declarations (interface, struct, enum, trait, impl, namespace, object, union, extension, protocol, actor). Control-flow bodies (`if`, `for`, `while`, `switch`, `catch`, ...) never count.
- Decision: an anonymous callback (a function or arrow body opened inside an unclosed `(`, like `xs.map((x) => {`) does not count; the Excerpt resolves to the named function around it. A function bound to a name (`const f = (x) => {`) or a method inside an object literal does count.
- Decision: the finder returns a block or nothing. When the braces do not balance, or the file is outside the supported extensions, it returns nothing and Context uses the fallback window. Known inputs that unbalance it (safe fallbacks): apostrophes in JSX text, heredocs, nested Rust block comments, C `#ifdef` branches that each open a brace.
- Ticket 12 (Python) should follow the same rules: named defs and classes count, lambdas do not.
