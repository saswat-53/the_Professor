import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const BIN = join(import.meta.dirname, "../dist/cli.js");
const SENTINEL = "SENTINEL-raw-provider-body";

let server: Server;
let baseUrl: string;
let requestCount = 0;
let respond: (res: import("node:http").ServerResponse) => void;
let file: string;

beforeAll(async () => {
  execFileSync("npm", ["run", "build"], { cwd: join(import.meta.dirname, ".."), stdio: "ignore" });
  server = createServer((req, res) => {
    requestCount++;
    req.resume();
    respond(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  file = join(await mkdtemp(join(tmpdir(), "learn-err-")), "a.ts");
  await writeFile(file, "export const a = 1;\n");
}, 60_000);

afterAll(() => server.close());
beforeEach(() => {
  requestCount = 0;
});

function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    const base = { ...process.env };
    delete base.LEARN_BASE_URL;
    delete base.LEARN_MODEL;
    const child = spawn("node", [BIN, ...args], { env: { ...base, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

const env = () => ({ LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
const failWith = (status: number) => (res: import("node:http").ServerResponse) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: SENTINEL } }));
};

describe("provider failures", () => {
  it.each([
    [401, "API key"],
    [403, "API key"],
    [429, "too many requests"],
    [404, "does not know that model"],
    [500, "HTTP 500"],
  ])("HTTP %i gives a friendly message, exit 1, and no raw body", async (status, message) => {
    respond = failWith(status);
    const r = await run([file], env());
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(message);
    expect(r.stdout + r.stderr).not.toContain(SENTINEL);
  });

  it("does not retry after a 429", async () => {
    respond = failWith(429);
    await run([file], env());
    expect(requestCount).toBe(1);
  });

  it("reports a refused connection as a network failure", async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));
    const r = await run([file], { LEARN_BASE_URL: `http://127.0.0.1:${port}/v1`, LEARN_MODEL: "m" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("could not reach");
  });

  it("flushes all streamed output before ending when the stream then fails", async () => {
    const big = "x".repeat(200_000);
    respond = (res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = { id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content: big }, finish_reason: null }] };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`, () => res.destroy());
    };
    const r = await run([file], env());
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(big);
  });
});
