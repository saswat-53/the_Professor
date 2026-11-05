import { describe, expect, it } from "vitest";
import { visibleControls } from "../src/cli/visible-controls.js";

describe("visibleControls", () => {
  it("shows an escape sequence as pictures, so it can be read and does nothing", () => {
    expect(visibleControls("a\u001b[31mb\u001b]0;title\u0007c")).toBe("a␛[31mb␛]0;title␇c");
  });

  it("shows the other control characters as their pictures: NUL, backspace, carriage return, form feed, DEL", () => {
    expect(visibleControls("\u0000\u0008\r\u000c\u007f")).toBe("␀␈␍␌␡");
  });

  it("leaves newlines and tabs alone, since they are layout", () => {
    expect(visibleControls("a\nb\tc")).toBe("a\nb\tc");
  });

  it("shows the 8-bit control characters, which some terminals act on, by their code", () => {
    expect(visibleControls("\u009b31m\u009d0;t\u009c")).toBe("<U+009B>31m<U+009D>0;t<U+009C>");
  });

  it("shows characters that hide or reorder text by their code, since they have no picture", () => {
    expect(visibleControls("a‮b​c⁦d⁩e⁠f﻿g")).toBe("a<U+202E>b<U+200B>c<U+2066>d<U+2069>e<U+2060>f<U+FEFF>g");
  });

  it("leaves everything else exactly as it is: ordinary text, accents, CJK, emoji, right-to-left letters", () => {
    const text = "export const a = 1; // café 漢字 😀 שלום ‏ ‎";
    expect(visibleControls(text)).toBe(text);
  });

  it("changes nothing in a text with nothing to show, and keeps its length", () => {
    expect(visibleControls("")).toBe("");
    expect(visibleControls("plain")).toBe("plain");
  });
});
