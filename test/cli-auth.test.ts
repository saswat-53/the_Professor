import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keyringSandbox } from "./support/keyring-sandbox.js";

const KEY = "sk-KEYCHAIN-CANARY-1234";
const HOSTED = "https://api.example.com/v1";
const hasPython = spawnSync("python3", ["--version"]).status === 0;

/** An endpoint on this machine that answers every request and remembers the Authorization header it got. */
async function endpoint() {
  const seen: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.authorization);
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { seen, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() };
}

describe("learn auth set", () => {
  it("stores the piped key under the service `learn` and the base URL's host, and never prints it", async () => {
    const box = await keyringSandbox("working");
    const r = await box.run(["auth", "set", "--base-url", HOSTED], {}, `${KEY}\n`);
    expect(r.code).toBe(0);
    expect(await box.stored()).toEqual({ "learn|api.example.com": KEY });
    expect(r.stdout + r.stderr).not.toContain(KEY);
    expect(r.stderr).toContain("api.example.com");
  });

  it("takes the host from the configured base URL when no flag is given", async () => {
    const box = await keyringSandbox("working");
    const r = await box.run(["auth", "set"], { LEARN_BASE_URL: HOSTED }, `${KEY}\n`);
    expect(r.code).toBe(0);
    expect(Object.keys(await box.stored())).toEqual(["learn|api.example.com"]);
  });

  it("an empty key is a usage error and stores nothing", async () => {
    const box = await keyringSandbox("working");
    const r = await box.run(["auth", "set", "--base-url", HOSTED], {}, "\n");
    expect(r.code).toBe(2);
    expect(await box.stored()).toEqual({});
  });

  it("without a base URL it says what is missing and stores nothing", async () => {
    const box = await keyringSandbox("working");
    const r = await box.run(["auth", "set"], {}, `${KEY}\n`);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/base url/i);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it("`learn auth` alone names the subcommand", async () => {
    const box = await keyringSandbox("working");
    const r = await box.run(["auth"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("auth set");
  });

  it.each(["broken", "absent"] as const)("with a keyring that is %s, says so plainly, that the environment variable still works, and never prints the key", async (kind) => {
    const box = await keyringSandbox(kind);
    const r = await box.run(["auth", "set", "--base-url", HOSTED], {}, `${KEY}\n`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/keychain|keyring/i);
    expect(r.stderr).toMatch(/environment variable/i);
    expect(r.stderr).not.toMatch(/at .*\.js:\d+/);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it.skipIf(!hasPython)("on a terminal the key is read without echo", async () => {
    const box = await keyringSandbox("working");
    const out = await new Promise<string>((resolve, reject) => {
      const steps = JSON.stringify([["hidden", `${KEY}\r`]]);
      execFile("python3", ["-I", join(import.meta.dirname, "support/pty-script.py"), steps, "node", box.bin, "auth", "set", "--base-url", HOSTED], { env: { ...process.env, HOME: box.home, ...box.env, TERM: "dumb", NO_COLOR: "1" }, cwd: box.dir }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    expect(out).toMatch(/\nexit 0\n$/);
    expect(out).toContain("hidden");
    expect(out).not.toContain(KEY);
    expect(await box.stored()).toEqual({ "learn|api.example.com": KEY });
  }, 30_000);
});

describe("lookup when explaining", () => {
  async function explainWith(box: Awaited<ReturnType<typeof keyringSandbox>>, env: Record<string, string>, url: string) {
    const file = join(box.dir, "sample.ts");
    await writeFile(file, "export const answer = 42;\n");
    await mkdir(join(box.home, ".config", "learn"), { recursive: true });
    await writeFile(join(box.home, ".config", "learn", "config.toml"), '[provider]\nkey_env = "SOME_KEY"\n');
    return await box.run([file], { LEARN_BASE_URL: url, LEARN_MODEL: "m", ...env });
  }

  it("uses the keychain entry for the host when the environment variable is not set", async () => {
    const api = await endpoint();
    try {
      const box = await keyringSandbox("working");
      await writeFile(box.env.FAKE_KEYRING_FILE!, JSON.stringify({ "learn|127.0.0.1": KEY }));
      const r = await explainWith(box, {}, api.url);
      expect(r.code).toBe(0);
      expect(api.seen).toEqual([`Bearer ${KEY}`]);
    } finally {
      api.close();
    }
  });

  it("the environment variable wins over the keychain", async () => {
    const api = await endpoint();
    try {
      const box = await keyringSandbox("working");
      await writeFile(box.env.FAKE_KEYRING_FILE!, JSON.stringify({ "learn|127.0.0.1": KEY }));
      const r = await explainWith(box, { SOME_KEY: "from-env" }, api.url);
      expect(r.code).toBe(0);
      expect(api.seen).toEqual(["Bearer from-env"]);
    } finally {
      api.close();
    }
  });

  it("a key stored for another host is not sent", async () => {
    const api = await endpoint();
    try {
      const box = await keyringSandbox("working");
      await writeFile(box.env.FAKE_KEYRING_FILE!, JSON.stringify({ "learn|api.example.com": KEY }));
      const r = await explainWith(box, {}, api.url);
      expect(r.code).toBe(0);
      expect(api.seen).toEqual([undefined]);
    } finally {
      api.close();
    }
  });

  it("without the keyring library installed, an environment variable still works", async () => {
    const api = await endpoint();
    try {
      const box = await keyringSandbox("absent");
      const r = await explainWith(box, { SOME_KEY: "from-env" }, api.url);
      expect(r.code).toBe(0);
      expect(api.seen).toEqual(["Bearer from-env"]);
    } finally {
      api.close();
    }
  });

  it("without the library and without the variable, the error is the usual one about the variable", async () => {
    const box = await keyringSandbox("absent");
    const r = await explainWith(box, {}, HOSTED);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("SOME_KEY");
  });
});
