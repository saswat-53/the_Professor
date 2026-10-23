import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BIN = join(import.meta.dirname, "../dist/cli.js");

let server: Server;
let baseUrl: string;
let requestCount = 0;
let file: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  execFileSync("npm", ["run", "build"], { cwd: join(import.meta.dirname, ".."), stdio: "ignore" });
  server = createServer(async (req, res) => {
    requestCount++;
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const piece of ["Hello", " there", " learner"]) {
      const chunk = { id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      await sleep(150);
    }
    res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const dir = await mkdtemp(join(tmpdir(), "learn-cli-"));
  file = join(dir, "sample.ts");
  await writeFile(file, "export const answer = 42;\n");
}, 60_000);

afterAll(() => server.close());

function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ stdoutChunks: string[]; stderr: string; code: number | null }>((resolve) => {
    const base = { ...process.env };
    delete base.LEARN_BASE_URL;
    delete base.LEARN_MODEL;
    const child = spawn("node", [BIN, ...args], { env: { ...base, ...env } });
    const stdoutChunks: string[] = [];
    let stderr = "";
    child.stdout.on("data", (d) => stdoutChunks.push(String(d)));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ stdoutChunks, stderr, code }));
  });
}

describe("learn CLI", () => {
  it("streams the reply to stdout in more than one chunk", async () => {
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(0);
    expect(r.stdoutChunks.join("")).toContain("Hello there learner");
    expect(r.stdoutChunks.length).toBeGreaterThan(1);
  });

  it("--dry-run makes no request and shows base URL, model and file content", async () => {
    const before = requestCount;
    const r = await run([file, "--dry-run"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(0);
    expect(requestCount).toBe(before);
    expect(r.stderr).toContain(baseUrl);
    expect(r.stderr).toContain("model: m\n");
    expect(r.stderr).toContain("export const answer = 42;\n");
  });

  it("flags override the environment", async () => {
    const r = await run([file, "--dry-run", "--base-url", "http://flag/v1", "--model", "flag-model"], {
      LEARN_BASE_URL: baseUrl,
      LEARN_MODEL: "env-model",
    });
    expect(r.stderr).toContain("http://flag/v1");
    expect(r.stderr).toContain("flag-model");
    expect(r.stderr).not.toContain("env-model");
  });

  it("refuses a directory with a message on stderr and exit 1", async () => {
    const r = await run([dirname(file), "--dry-run"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not a regular file");
  });

  it("exits 2 with a clear message for a malformed line reference", async () => {
    const r = await run([`${file}:0`, "--dry-run"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("start at 1");
  });

  it("exits 2 saying words are not supported yet", async () => {
    const r = await run(["debounce"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("not supported yet");
  });

  it("exits 2 with usage when base URL and model are missing", async () => {
    const r = await run([file]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Usage:");
  });
});
