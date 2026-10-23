import { describe, expect, it } from "vitest";
import { blockFinderFor } from "../src/core/block-finder-for.js";
import { pythonBlockFinder } from "../src/core/python-block-finder.js";
import { blockFinderContract } from "./support/block-finder-contract.js";

const nested = [
  "import os", // 1
  "",
  "class Greeter:", // 3
  "    def greet(self, name):", // 4
  "        if name:", // 5
  "            return f'hi {name}'", // 6
  "        return 'hi'", // 7
  "", // 8
  "    def other(self):", // 9
  "        pass", // 10
  "", // 11
  "x = 1", // 12
].join("\n");

const decorated = [
  "@app.route('/')", // 1
  "@cached(", // 2
  "    ttl=10,", // 3
  ")", // 4
  "def index():", // 5
  "    return 1", // 6
].join("\n");

const multiline = [
  "def long_signature(", // 1
  "    a: int,", // 2
  "    b: str = '):',", // 3
  ") -> dict:", // 4
  "    return {}", // 5
].join("\n");

const gaps = [
  "def f():", // 1
  "    a = 1", // 2
  "", // 3
  "# a comment at column zero", // 4
  "",
  "    b = 2", // 6
  '    s = """', // 7
  "not indented text", // 8
  '"""', // 9
  "    return a + b", // 10
  "", // 11
  "# trailing comment", // 12
  "y = 2", // 13
].join("\n");

const lambdas = [
  "def f(xs):", // 1
  "    return sorted(xs, key=lambda x: (", // 2
  "        x.name", // 3
  "    ))", // 4
].join("\n");

blockFinderContract("python finder", pythonBlockFinder, [
  { name: "method body resolves to the method", path: "a.py", text: nested, range: { start: 6, end: 6 }, expect: { start: 4, end: 7 } },
  { name: "class-level line resolves to the class", path: "a.py", text: nested, range: { start: 3, end: 3 }, expect: { start: 3, end: 10 } },
  { name: "range spanning two methods resolves to the class", path: "a.py", text: nested, range: { start: 7, end: 10 }, expect: { start: 3, end: 10 } },
  { name: "top-level code is outside any block", path: "a.py", text: nested, range: { start: 12, end: 12 }, expect: null },
  { name: "imports are outside any block", path: "a.py", text: nested, range: { start: 1, end: 1 }, expect: null },
  { name: "decorators belong to the block", path: "a.py", text: decorated, range: { start: 6, end: 6 }, expect: { start: 1, end: 6 } },
  { name: "an Excerpt on a decorator is inside the block", path: "a.py", text: decorated, range: { start: 3, end: 3 }, expect: { start: 1, end: 6 } },
  { name: "multi-line signature is part of the block", path: "a.py", text: multiline, range: { start: 3, end: 3 }, expect: { start: 1, end: 5 } },
  { name: "body after a multi-line signature", path: "a.py", text: multiline, range: { start: 5, end: 5 }, expect: { start: 1, end: 5 } },
  { name: "blank lines, comments and string text do not end a block early", path: "a.py", text: gaps, range: { start: 10, end: 10 }, expect: { start: 1, end: 10 } },
  { name: "trailing blanks and comments are not part of the block", path: "a.py", text: gaps, range: { start: 13, end: 13 }, expect: null },
  { name: "lambdas do not count", path: "a.py", text: lambdas, range: { start: 3, end: 3 }, expect: { start: 1, end: 4 } },
  { name: "async def counts", path: "a.py", text: "async def f():\n    await g()", range: { start: 2, end: 2 }, expect: { start: 1, end: 2 } },
  { name: "one-line def", path: "a.py", text: "def f(): return 1\nx = 2", range: { start: 1, end: 1 }, expect: { start: 1, end: 1 } },
  { name: "nested function resolves to the smallest", path: "a.py", text: "def a():\n    def b():\n        return 1\n    return b", range: { start: 3, end: 3 }, expect: { start: 2, end: 3 } },
  { name: "tab indentation", path: "a.py", text: "def a():\n\tif x:\n\t\treturn 1", range: { start: 3, end: 3 }, expect: { start: 1, end: 3 } },
  { name: "backslash continuation", path: "a.py", text: "def a():\n    x = 1 + \\\n2\n    return x", range: { start: 4, end: 4 }, expect: { start: 1, end: 4 } },
  { name: "the word def inside a string is not a block", path: "a.py", text: 'x = """\ndef fake():\n    pass\n"""', range: { start: 3, end: 3 }, expect: null },
  { name: "an unterminated string finds nothing", path: "a.py", text: 'def f():\n    x = """oops\n    return 1', range: { start: 3, end: 3 }, expect: null },
  // Python 3.12+ allows reusing the f-string's own quote inside `{}`. The scanner ends the string early,
  // but the quotes still pair up, so the block is right; this pins the limitation to evidence.
  { name: "an f-string reusing its own quote (3.12) still gives the right block", path: "a.py", text: 'def f(d):\n    s = f"{d["a"]} and {d["b"]}"\n    return s\nx = 1', range: { start: 3, end: 3 }, expect: { start: 1, end: 3 } },
  { name: "a comment ending in a backslash does not hide the next statement", path: "a.py", text: "def f():\n    x = 1  # see \\\ndef g():\n    pass", range: { start: 4, end: 4 }, expect: { start: 3, end: 4 } },
  { name: "a real backslash continuation still joins lines", path: "a.py", text: "def f():\n    x = 1 + \\\n    2\ndef g():\n    pass", range: { start: 3, end: 3 }, expect: { start: 1, end: 3 } },
  { name: "unclosed brackets find nothing instead of a wrong block", path: "a.py", text: "def f(:\n    pass\n\ndef g():\n    return 1", range: { start: 5, end: 5 }, expect: null },
  { name: "a form feed resets the indentation column", path: "a.py", text: "class A:\n    def m(self):\n        pass\n\f    def n(self):\n        pass", range: { start: 3, end: 5 }, expect: { start: 1, end: 5 } },
  { name: "an indented decorated method", path: "a.py", text: "class A:\n    @property\n    def x(self):\n        return 1\n    y = 2", range: { start: 4, end: 4 }, expect: { start: 2, end: 4 } },
  { name: "one-line class", path: "a.py", text: "class A: x = 1\ny = 2", range: { start: 1, end: 1 }, expect: { start: 1, end: 1 } },
  { name: "a trailing comment in a body is outside the block", path: "a.py", text: "def f():\n    return 1\n    # note\ny = 1", range: { start: 3, end: 3 }, expect: null },
  { name: "mixed tabs and spaces compare by width", path: "a.py", text: "def f():\n        a = 1\n\tb = 2\nc = 3", range: { start: 3, end: 3 }, expect: { start: 1, end: 3 } },
  { name: "statements after a semicolon stay on their line", path: "a.py", text: "def f():\n    a = 1; b = 2\nc = 3", range: { start: 2, end: 2 }, expect: { start: 1, end: 2 } },
  { name: "r and f string prefixes", path: "a.py", text: 'def f(x):\n    a = r"\\"\n    b = f"{x}("\n    return a + b\nz = 1', range: { start: 4, end: 4 }, expect: { start: 1, end: 4 } },
  { name: "CRLF line endings", path: "a.py", text: "def f():\r\n    pass\r\nz = 1", range: { start: 2, end: 2 }, expect: { start: 1, end: 2 } },
  { name: "other extensions find nothing", path: "a.rb", text: "def f\n  1\nend", range: { start: 2, end: 2 }, expect: null },
  { name: "no extension finds nothing", path: "Makefile", text: "def f():\n    pass", range: { start: 2, end: 2 }, expect: null },
  { name: "upper-case extension", path: "A.PY", text: "def f():\n    pass", range: { start: 2, end: 2 }, expect: { start: 1, end: 2 } },
]);

describe("blockFinderFor", () => {
  it("picks the Python finder for .py", () => expect(blockFinderFor("src/a.py").name).toBe("python"));
  it("picks the brace finder for brace languages", () => expect(blockFinderFor("a.TS").name).toBe("braces"));
  it("picks the finder that finds nothing for other files", () => {
    for (const path of ["a.txt", "Makefile", "", ".py", ".bashrc", "dir.py/Makefile", "a.pyi", "a.ipynb"]) {
      expect(blockFinderFor(path).name).toBe("none");
    }
  });
  it("reads the extension from the last path segment, with either separator", () => {
    expect(blockFinderFor("dir.d/a.py").name).toBe("python");
    expect(blockFinderFor("C:\\src\\a.PY").name).toBe("python");
    expect(blockFinderFor("C:\\src.ts\\Makefile").name).toBe("none");
  });
});
