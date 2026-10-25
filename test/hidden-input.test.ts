import { describe, expect, it } from "vitest";
import { CancelledError } from "../src/core/index.js";
import { readHidden, type RawInput } from "../src/cli/hidden-input.js";

/** A terminal that types `chunks` once something is listening, and records what was written and whether raw mode was left on. */
function terminal(chunks: string[]) {
  let listener: ((chunk: string) => void) | undefined;
  const state = { raw: false, written: "" };
  const input: RawInput = {
    setRawMode: (mode) => void (state.raw = mode),
    resume: () => {},
    pause: () => {},
    setEncoding: () => {},
    on: (_event, fn) => {
      listener = fn;
      queueMicrotask(() => chunks.forEach((c) => listener?.(c)));
    },
    off: () => void (listener = undefined),
  };
  return { input, state, read: () => readHidden(input, "key: ", (t) => (state.written += t)) };
}

describe("readHidden", () => {
  it("returns the typed line, shows only the prompt, and puts the terminal back", async () => {
    const t = terminal(["sk-ab", "c\r"]);
    expect(await t.read()).toBe("sk-abc");
    expect(t.state.written).toBe("key: \n");
    expect(t.state.raw).toBe(false);
  });

  it("backspace edits and bracketed-paste markers are dropped", async () => {
    const t = terminal(["abx\u007f", "\u001b[200~cd\u001b[201~\n"]);
    expect(await t.read()).toBe("abcd");
  });

  it("Ctrl-C cancels and still restores the terminal", async () => {
    const t = terminal(["ab\u0003"]);
    await expect(t.read()).rejects.toBeInstanceOf(CancelledError);
    expect(t.state.raw).toBe(false);
  });
});
