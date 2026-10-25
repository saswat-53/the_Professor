import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { classifyProviderError } from "../src/cli/openai-compatible.js";
import { NetworkError, UnexpectedError } from "../src/core/index.js";

// Ticket 41: only a failure of the connection itself is a network problem; anything else we do not recognise is probably a bug in learn.
const withCode = (code: string, message = "fetch failed") => Object.assign(new TypeError(message), { cause: Object.assign(new Error("inner"), { code }) });

describe("classifyProviderError: network or unexpected", () => {
  it.each(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_BODY_TIMEOUT"])(
    "%s (even wrapped as a cause) is a network failure",
    (code) => {
      expect(classifyProviderError(withCode(code))).toBeInstanceOf(NetworkError);
    },
  );

  it("a timeout is a network failure", () => {
    expect(classifyProviderError(new DOMException("timed out", "TimeoutError"))).toBeInstanceOf(NetworkError);
  });

  it("an API call error with no status is a network failure; with a status it is classified by status", () => {
    const base = { message: "x", url: "u", requestBodyValues: {} };
    expect(classifyProviderError(new APICallError(base))).toBeInstanceOf(NetworkError);
    expect(classifyProviderError(new APICallError({ ...base, cause: new SyntaxError("bad") }))).toBeInstanceOf(UnexpectedError);
    expect(classifyProviderError(new APICallError({ ...base, cause: withCode("ECONNREFUSED") }))).toBeInstanceOf(NetworkError);
    expect(classifyProviderError(new APICallError({ ...base, statusCode: 500 })).message).toContain("HTTP 500");
  });

  it("a failure reading a successful (2xx) response is judged by its cause: a dropped connection is network, anything else unexpected", () => {
    const base = { message: "Failed to process successful response", url: "u", requestBodyValues: {}, statusCode: 200 };
    expect(classifyProviderError(new APICallError({ ...base, cause: withCode("UND_ERR_SOCKET", "terminated") }))).toBeInstanceOf(NetworkError);
    expect(classifyProviderError(new APICallError({ ...base, cause: new SyntaxError("bad") }))).toBeInstanceOf(UnexpectedError);
  });

  it.each([
    ["a parse error", new SyntaxError("Unexpected token } in JSON SENTINEL-raw")],
    ["a bug", new TypeError("Cannot read properties of undefined")],
    ["a non-error", "SENTINEL-raw"],
  ])("%s is an unexpected error that says it is probably a bug, and does not echo the original", (_name, err) => {
    const out = classifyProviderError(err);
    expect(out).toBeInstanceOf(UnexpectedError);
    expect(out.message).toContain("probably a bug in learn");
    expect(out.message).not.toContain("SENTINEL");
  });

  it("leaves a cancellation alone", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyProviderError(abort)).toBe(abort);
  });
});
