import { describe, expect, it } from "vitest";
import { UsageError } from "../src/core/errors.js";
import { resolveApiKey } from "../src/core/api-key.js";
import { insecureTransportWarning } from "../src/core/sensitive.js";

const HOSTED = "https://api.example.com/v1";
const LOCAL = "http://localhost:11434/v1";

describe("resolveApiKey", () => {
  it("reads the key from the variable the config names, and from no other", () => {
    expect(resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env: { MY_KEY: "k1", LEARN_API_KEY: "other", OPENAI_API_KEY: "o" } })).toBe("k1");
  });

  it("trims a stray newline around the value", () => {
    expect(resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env: { MY_KEY: "k1\n" } })).toBe("k1");
  });

  it("a missing or empty variable on a hosted endpoint is a usage error that names it", () => {
    for (const env of [{}, { MY_KEY: "" }, { MY_KEY: "  \n" }]) {
      expect(() => resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env })).toThrow(UsageError);
      expect(() => resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env })).toThrow(/MY_KEY/);
    }
  });

  it("no variable configured on a hosted endpoint is a usage error that says to set key_env", () => {
    expect(() => resolveApiKey({ keyEnv: undefined, baseUrl: HOSTED, env: { LEARN_API_KEY: "ignored" } })).toThrow(/key_env/);
  });

  it("for a localhost endpoint the variable is optional", () => {
    expect(resolveApiKey({ keyEnv: "MY_KEY", baseUrl: LOCAL, env: {} })).toBeUndefined();
    expect(resolveApiKey({ keyEnv: undefined, baseUrl: LOCAL, env: {} })).toBeUndefined();
    expect(resolveApiKey({ keyEnv: "MY_KEY", baseUrl: LOCAL, env: { MY_KEY: "k" } })).toBe("k");
  });

  it("a lookalike of localhost is not exempt", () => {
    expect(() => resolveApiKey({ keyEnv: "K", baseUrl: "http://localhost.evil.example/v1", env: {} })).toThrow(UsageError);
  });

  it("the error never contains another variable's value", () => {
    try {
      resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env: { LEARN_API_KEY: "SENTINEL" } });
    } catch (err) {
      expect((err as Error).message).not.toContain("SENTINEL");
    }
  });
});

describe("insecureTransportWarning", () => {
  it("warns for plain http to a non-local host, naming the host but not the path", () => {
    const w = insecureTransportWarning("http://models.example.com/v1/secretpath");
    expect(w).toMatch(/^warning: /);
    expect(w).toContain("models.example.com");
    expect(w).not.toContain("secretpath");
  });

  it.each([HOSTED, LOCAL, "http://127.0.0.1:8080/v1", "http://[::1]:8080/v1"])("is silent for %s", (u) => {
    expect(insecureTransportWarning(u)).toBeUndefined();
  });
});
