import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { classifyProviderError } from "../src/cli/openai-compatible.js";
import { RateLimitError } from "../src/core/index.js";

// Ticket 40: a 429's Retry-After becomes a wait time in the message; the header text itself is never shown.
const NOW = Date.parse("2026-10-26T12:00:00Z");
const limited = (retryAfter?: string) =>
  classifyProviderError(
    new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode: 429, ...(retryAfter !== undefined && { responseHeaders: { "retry-after": retryAfter } }) }),
    undefined,
    NOW,
  );

describe("Retry-After on a 429", () => {
  it("says to wait about the given seconds", () => {
    const err = limited("30");
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.message).toContain("wait about 30 seconds");
  });

  it("handles one second, minutes and hours in plain words", () => {
    expect(limited("1").message).toContain("about 1 second");
    expect(limited("90").message).toContain("about 90 seconds");
    expect(limited("600").message).toContain("about 10 minutes");
    expect(limited("7200").message).toContain("about 2 hours");
  });

  it("handles an HTTP date", () => {
    expect(limited("Mon, 26 Oct 2026 12:00:45 GMT").message).toContain("wait about 45 seconds");
  });

  it("leaves the message unchanged for a missing header, a date in the past, or anything unparseable", () => {
    const plain = limited().message;
    expect(plain).toContain("wait a moment and try again");
    for (const bad of ["", "soon", "-5", "1.5", "0", "Mon, 26 Oct 2026 11:00:00 GMT", "Tue Oct 27 2026", "99999999999999999999"]) {
      expect(limited(bad).message, bad).toBe(plain);
    }
  });

  it("never echoes the header value", () => {
    const hostile = "30\u001b[31m SENTINEL-raw";
    expect(limited(hostile).message).not.toContain("SENTINEL");
    expect(limited("12\n13").message).not.toContain("13");
  });
});
