import { describe, expect, it } from "vitest";
import { BlockedFileError, ContextTooLongError, ExitCode, UsageError } from "../src/core/errors.js";
import { explain } from "../src/core/explain.js";
import type { ExplainEvent, LanguageModel } from "../src/core/types.js";

describe("error exit codes", () => {
  it("maps context-too-long and blocked-file to 3, usage to 2", () => {
    expect(new ContextTooLongError("x").exitCode).toBe(3);
    expect(new BlockedFileError("x").exitCode).toBe(3);
    expect(new UsageError("x").exitCode).toBe(2);
    expect(ExitCode).toEqual({ Runtime: 1, Usage: 2, Refused: 3 });
  });
});

describe("explain error events", () => {
  it("never passes an untyped model failure's message through", async () => {
    const model: LanguageModel = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error("SENTINEL raw provider body");
      },
    };
    const events: ExplainEvent[] = [];
    for await (const e of explain({
      reference: import.meta.filename,
      settings: { baseUrl: "http://h/v1", model: "m" },
      model,
      signal: new AbortController().signal,
    })) events.push(e);
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    expect(last?.type === "error" && last.error.message).not.toContain("SENTINEL");
    expect(last?.type === "error" && last.error.exitCode).toBe(1);
  });
});
