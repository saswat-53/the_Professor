import { describe, expect, it } from "vitest";
import { UsageError } from "../src/core/errors.js";
import { resolveApiKey } from "../src/core/api-key.js";
import { insecureTransportWarning } from "../src/core/sensitive.js";

const HOSTED = "https://api.example.com/v1";
const LOCAL = "http://localhost:11434/v1";

describe("resolveApiKey", () => {
  it("reads the key from the variable the config names, and from no other", async () => {
    expect(await resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env: { MY_KEY: "k1", LEARN_API_KEY: "other", OPENAI_API_KEY: "o" } })).toBe("k1");
  });

  it("trims a stray newline around the value", async () => {
    expect(await resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env: { MY_KEY: "k1\n" } })).toBe("k1");
  });

  it("a missing or empty variable on a hosted endpoint is a usage error that names it", async () => {
    for (const env of [{}, { MY_KEY: "" }, { MY_KEY: "  \n" }]) {
      await expect(resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env })).rejects.toThrow(UsageError);
      await expect(resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env })).rejects.toThrow(/MY_KEY/);
    }
  });

  it("no variable configured on a hosted endpoint is a usage error that says to set key_env", async () => {
    await expect(resolveApiKey({ keyEnv: undefined, baseUrl: HOSTED, env: { LEARN_API_KEY: "ignored" } })).rejects.toThrow(/key_env/);
  });

  it("for a localhost endpoint the variable is optional", async () => {
    expect(await resolveApiKey({ keyEnv: "MY_KEY", baseUrl: LOCAL, env: {} })).toBeUndefined();
    expect(await resolveApiKey({ keyEnv: undefined, baseUrl: LOCAL, env: {} })).toBeUndefined();
    expect(await resolveApiKey({ keyEnv: "MY_KEY", baseUrl: LOCAL, env: { MY_KEY: "k" } })).toBe("k");
  });

  it("a lookalike of localhost is not exempt", async () => {
    await expect(resolveApiKey({ keyEnv: "K", baseUrl: "http://localhost.evil.example/v1", env: {} })).rejects.toThrow(UsageError);
  });

  it("the error never contains another variable's value", async () => {
    const err = await resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env: { LEARN_API_KEY: "SENTINEL" } }).catch((e: Error) => e);
    expect((err as Error).message).not.toContain("SENTINEL");
  });
});

/** A keychain in memory, keyed by host, that counts how often it is asked. */
function fakeStore(entries: Record<string, string> = {}) {
  const reads: string[] = [];
  return { reads, store: { get: async (host: string) => (reads.push(host), entries[host]), set: async (host: string, key: string) => void (entries[host] = key), delete: async (host: string) => delete entries[host] } };
}

describe("resolveApiKey with a keychain", () => {
  it("uses the keychain entry for the endpoint's host when the variable is not set", async () => {
    const { store } = fakeStore({ "api.example.com": "from-keychain" });
    expect(await resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env: {}, store })).toBe("from-keychain");
  });

  it("works when the config names no variable at all", async () => {
    const { store } = fakeStore({ "api.example.com": "from-keychain" });
    expect(await resolveApiKey({ keyEnv: undefined, baseUrl: HOSTED, env: {}, store })).toBe("from-keychain");
  });

  it("the environment wins, and the keychain is not even asked", async () => {
    const { store, reads } = fakeStore({ "api.example.com": "from-keychain" });
    expect(await resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env: { MY_KEY: "from-env" }, store })).toBe("from-env");
    expect(reads).toEqual([]);
  });

  it("a key stored for one host is not used for another", async () => {
    const { store } = fakeStore({ "api.example.com": "for-example" });
    await expect(resolveApiKey({ keyEnv: "MY_KEY", baseUrl: "https://api.other.com/v1", env: {}, store })).rejects.toThrow(UsageError);
  });

  it("a keychain that cannot be used falls back to the usual error about the variable", async () => {
    const store = { get: async () => { throw new Error("no keyring"); }, set: async () => {}, delete: async () => false };
    await expect(resolveApiKey({ keyEnv: "MY_KEY", baseUrl: HOSTED, env: {}, store })).rejects.toThrow(/MY_KEY/);
  });

  it("a localhost endpoint never asks the keychain unless the config names a variable", async () => {
    const { store, reads } = fakeStore({ "localhost:11434": "local-key" });
    expect(await resolveApiKey({ keyEnv: undefined, baseUrl: LOCAL, env: {}, store })).toBeUndefined();
    expect(reads).toEqual([]);
    expect(await resolveApiKey({ keyEnv: "MY_KEY", baseUrl: LOCAL, env: {}, store })).toBe("local-key");
  });

  it("an explicit port is part of the entry's name, a default port is not", async () => {
    const { store } = fakeStore({ "api.example.com:8443": "custom-port", "api.example.com": "plain" });
    expect(await resolveApiKey({ keyEnv: "K", baseUrl: "https://api.example.com:8443/v1", env: {}, store })).toBe("custom-port");
    expect(await resolveApiKey({ keyEnv: "K", baseUrl: "https://api.example.com:443/v1", env: {}, store })).toBe("plain");
    expect(await resolveApiKey({ keyEnv: "K", baseUrl: HOSTED, env: {}, store })).toBe("plain");
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
