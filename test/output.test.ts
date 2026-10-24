import { describe, expect, it } from "vitest";
import { colorEnabled, painter } from "../src/cli/output.js";

const tty = { stdoutIsTTY: true, stderrIsTTY: true, env: {} };

describe("colorEnabled", () => {
  it("is on when both streams are terminals", () => expect(colorEnabled(tty)).toBe(true));
  it("is off when stdout is piped", () => expect(colorEnabled({ ...tty, stdoutIsTTY: false })).toBe(false));
  it("is off when stderr is redirected", () => expect(colorEnabled({ ...tty, stderrIsTTY: false })).toBe(false));
  it("is off when NO_COLOR is set to anything non-empty", () => expect(colorEnabled({ ...tty, env: { NO_COLOR: "1" } })).toBe(false));
  it("ignores an empty NO_COLOR", () => expect(colorEnabled({ ...tty, env: { NO_COLOR: "" } })).toBe(true));
  it("is off for TERM=dumb", () => expect(colorEnabled({ ...tty, env: { TERM: "dumb" } })).toBe(false));
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
