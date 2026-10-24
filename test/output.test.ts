import { describe, expect, it } from "vitest";
import { outputMode, painter } from "../src/cli/output.js";

const tty = { stdoutIsTTY: true, stderrIsTTY: true, env: {} };

describe("outputMode", () => {
  const color = (t: Parameters<typeof outputMode>[0]) => outputMode(t).color;
  it("is terminal mode with colour when both streams are terminals", () => expect(outputMode(tty)).toEqual({ color: true, stripEscapes: true }));
  it("is plain mode when both streams are piped", () => expect(outputMode({ ...tty, stdoutIsTTY: false, stderrIsTTY: false })).toEqual({ color: false, stripEscapes: false }));
  it("has no colour but strips escapes when only stderr is redirected (the text still reaches a terminal)", () =>
    expect(outputMode({ ...tty, stderrIsTTY: false })).toEqual({ color: false, stripEscapes: true }));
  it("has no colour and no stripping when only stdout is piped", () =>
    expect(outputMode({ ...tty, stdoutIsTTY: false })).toEqual({ color: false, stripEscapes: false }));
  it("turns colour off for NO_COLOR but keeps stripping on", () =>
    expect(outputMode({ ...tty, env: { NO_COLOR: "1" } })).toEqual({ color: false, stripEscapes: true }));
  it("ignores an empty NO_COLOR", () => expect(color({ ...tty, env: { NO_COLOR: "" } })).toBe(true));
  it("turns colour off for TERM=dumb but keeps stripping on", () =>
    expect(outputMode({ ...tty, env: { TERM: "dumb" } })).toEqual({ color: false, stripEscapes: true }));
});

describe("painter", () => {
  it("returns text untouched when colour is off", () => {
    expect(painter(false)("error", "boom\nmore")).toBe("boom\nmore");
  });
  it("colours each line separately so a line never carries an open escape", () => {
    const out = painter(true)("error", "a\nb");
    expect(out).toBe("\u001b[31ma\u001b[0m\n\u001b[31mb\u001b[0m");
  });
  it("leaves blank lines bare", () => {
    expect(painter(true)("warning", "a\n\nb")).toBe("\u001b[33ma\u001b[0m\n\n\u001b[33mb\u001b[0m");
  });
});
