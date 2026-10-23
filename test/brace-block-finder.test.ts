import { describe, expect, it } from "vitest";
import { braceBlockFinder, BRACE_EXTENSIONS } from "../src/core/brace-block-finder.js";
import { blockFinderContract } from "./support/block-finder-contract.js";

const ts = [
  "import { a } from 'a';", // 1
  "",
  "export class Greeter {", // 3
  "  greet(name: string): string {", // 4
  "    if (name) {", // 5
  "      return `hi ${name}`;", // 6
  "    }", // 7
  "    return 'hi';", // 8
  "  }", // 9
  "}", // 10
  "",
  "const top = 1;", // 12
].join("\n");

const tricky = [
  "function f() {", // 1
  '  const s = "}}}";', // 2
  "  const c = '{';", // 3
  "  // } stray",
  "  /* { stray",
  "  } */",
  "  const t = `a } ${1 + 1} {`;", // 7
  "  const r = /[{]/;", // 8
  "  return s;", // 9
  "}", // 10
  "const after = 1;", // 11
].join("\n");

blockFinderContract("brace-family finder", braceBlockFinder, [
  { name: "method inside a class: the smallest block wins", path: "a.ts", text: ts, range: { start: 8, end: 8 }, expect: { start: 4, end: 9 } },
  { name: "a control-flow block is not an Enclosing block", path: "a.ts", text: ts, range: { start: 6, end: 6 }, expect: { start: 4, end: 9 } },
  { name: "a class line outside any method gets the class", path: "a.ts", text: ts, range: { start: 3, end: 3 }, expect: { start: 3, end: 10 } },
  { name: "a range spanning two methods gets the class", path: "a.ts", text: [ "class A {", "  a() {", "    1;", "  }", "  b() {", "    2;", "  }", "}" ].join("\n"), range: { start: 3, end: 6 }, expect: { start: 1, end: 8 } },
  { name: "outside any block: nothing", path: "a.ts", text: ts, range: { start: 12, end: 12 }, expect: null },
  { name: "the import line is outside any block", path: "a.ts", text: ts, range: { start: 1, end: 1 }, expect: null },
  { name: "braces in strings, comments, templates and regexes are ignored", path: "a.js", text: tricky, range: { start: 9, end: 9 }, expect: { start: 1, end: 10 } },
  { name: "code after such a function is outside it", path: "a.js", text: tricky, range: { start: 11, end: 11 }, expect: null },
  { name: "arrow function", path: "a.ts", text: ["const f = (x) => {", "  return x;", "};"].join("\n"), range: { start: 2, end: 2 }, expect: { start: 1, end: 3 } },
  { name: "object literal is not a block", path: "a.ts", text: ["const o = {", "  a: 1,", "};"].join("\n"), range: { start: 2, end: 2 }, expect: null },
  { name: "multi-line header starts at its first line", path: "a.ts", text: ["export function f(", "  a: number,", "  b: number,", "): number {", "  return a;", "}"].join("\n"), range: { start: 5, end: 5 }, expect: { start: 1, end: 6 } },
  { name: "Java method with annotation", path: "A.java", text: ["class A {", "  @Override", "  public void run() throws Exception {", "    x();", "  }", "}"].join("\n"), range: { start: 4, end: 4 }, expect: { start: 2, end: 5 } },
  { name: "Java char literal brace", path: "A.java", text: ["class A {", "  void f() {", "    char c = '}';", "    x();", "  }", "}"].join("\n"), range: { start: 4, end: 4 }, expect: { start: 2, end: 5 } },
  { name: "Go method with receiver", path: "a.go", text: ["package a", "", "func (s *S) Run() error {", "\tif x := f(); g(x) {", "\t\treturn nil", "\t}", "\treturn nil", "}"].join("\n"), range: { start: 5, end: 5 }, expect: { start: 3, end: 8 } },
  { name: "Go raw string", path: "a.go", text: ["func f() {", "\ts := `}", "`", "\t_ = s", "}"].join("\n"), range: { start: 4, end: 4 }, expect: { start: 1, end: 5 } },
  { name: "Rust fn with lifetimes", path: "a.rs", text: ["impl<'a> Foo<'a> {", "    fn get(&self, x: &'a str) -> &'a str {", "        x", "    }", "}"].join("\n"), range: { start: 3, end: 3 }, expect: { start: 2, end: 4 } },
  { name: "Rust impl block", path: "a.rs", text: ["impl Foo {", "    const N: u8 = 1;", "}"].join("\n"), range: { start: 2, end: 2 }, expect: { start: 1, end: 3 } },
  { name: "C function", path: "a.c", text: ["#include <stdio.h>", "int main(void)", "{", "  puts(\"}\");", "  return 0;", "}"].join("\n"), range: { start: 5, end: 5 }, expect: { start: 2, end: 6 } },
  { name: "C# namespace is not smaller than its class", path: "A.cs", text: ["namespace N {", "  class C {", "    void M() {", "      x();", "    }", "  }", "}"].join("\n"), range: { start: 4, end: 4 }, expect: { start: 3, end: 5 } },
  { name: "Kotlin fun and when", path: "a.kt", text: ["fun f(x: Int): Int {", "  when (x) {", "    1 -> return 2", "  }", "  return 3", "}"].join("\n"), range: { start: 3, end: 3 }, expect: { start: 1, end: 6 } },
  { name: "PHP with # comment", path: "a.php", text: ["<?php", "function f() {", "  # }", "  return 1;", "}"].join("\n"), range: { start: 4, end: 4 }, expect: { start: 2, end: 5 } },
  { name: "Swift init", path: "a.swift", text: ["struct S {", "  init(x: Int) {", "    self.x = x", "  }", "}"].join("\n"), range: { start: 3, end: 3 }, expect: { start: 2, end: 4 } },
  { name: "a method named like a soft keyword is still a method", path: "a.ts", text: ["class A {", "  select(x) {", "    return 1;", "  }", "}"].join("\n"), range: { start: 3, end: 3 }, expect: { start: 2, end: 4 } },
  { name: "a Rust match arm is not a function", path: "a.rs", text: ["fn f(x: u8) {", "  match x {", "    1 => {", "      y();", "    }", "    _ => {}", "  }", "}"].join("\n"), range: { start: 4, end: 4 }, expect: { start: 1, end: 8 } },
  { name: "division is not a regex literal, and a real regex with a brace is skipped", path: "a.ts", text: ["function f(a, b, c) {", "  const q = a / b / c;", "  const r = /[{]/.test(q);", "  return r;", "}", "function g() {", "  return 1;", "}"].join("\n"), range: { start: 4, end: 4 }, expect: { start: 1, end: 5 } },
  { name: "division after a call or index is not a regex either", path: "a.ts", text: ["function f(a, b) {", "  const q = g(a) / 2 / b[0];", "  const s = '{';", "  return q;", "}", "function h() {", "  return 1;", "}"].join("\n"), range: { start: 4, end: 4 }, expect: { start: 1, end: 5 } },
  { name: "an unmatched brace in a string inside the Excerpt's own function", path: "a.ts", text: ["function f() {", '  const open = "{";', '  const close = "}";', "  const lone = '{{{';", "  return open + close + lone;", "}", "function g() {", "  return 1;", "}"].join("\n"), range: { start: 5, end: 5 }, expect: { start: 1, end: 6 } },
  { name: "an unmatched brace in a comment inside the Excerpt's own function", path: "a.ts", text: ["function f() {", "  // {{{ still open", "  return 1;", "}", "function g() {", "  return 2;", "}"].join("\n"), range: { start: 3, end: 3 }, expect: { start: 1, end: 4 } },
  { name: "an anonymous callback resolves to its named parent function", path: "a.ts", text: ["function load(xs) {", "  return xs.map((x) => {", "    return x + 1;", "  });", "}"].join("\n"), range: { start: 3, end: 3 }, expect: { start: 1, end: 5 } },
  { name: "a callback assigned to a name is a block", path: "a.ts", text: ["function load(xs) {", "  const inc = (x) => {", "    return x + 1;", "  };", "  return xs.map(inc);", "}"].join("\n"), range: { start: 3, end: 3 }, expect: { start: 2, end: 4 } },
  { name: "a method in an object literal passed as an argument is a block", path: "a.ts", text: ["register({", "  run() {", "    go();", "  },", "});"].join("\n"), range: { start: 3, end: 3 }, expect: { start: 2, end: 4 } },
  { name: "other extensions use the fallback window", path: "a.py", text: ["def f():", "  return {1}", "x = {"].join("\n"), range: { start: 2, end: 2 }, expect: null },
  { name: "unbalanced file finds nothing rather than a wrong block", path: "a.ts", text: ["function f() {", "  x;"].join("\n"), range: { start: 2, end: 2 }, expect: null },
]);

describe("braceBlockFinder", () => {
  it("lists the supported extensions", () => {
    expect([...BRACE_EXTENSIONS].sort()).toEqual(
      "c cc cpp cs cjs go h hpp java js jsx kt mjs php rs swift ts tsx".split(" ").sort(),
    );
  });
  it("is case-insensitive about the extension", () => {
    const found = braceBlockFinder.find({ path: "A.TS", lines: ["function f() {", "  x;", "}"] }, { start: 2, end: 2 });
    expect(found).toEqual({ start: 1, end: 3 });
  });
});
