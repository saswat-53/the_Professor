import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "./support/cli.js";

let server: Server;
let baseUrl: string;
let file: string;
let respond: (res: ServerResponse) => void;
let closed: Promise<void>;
let markClosed: () => void;

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    res.on("close", () => markClosed());
    respond(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  file = join(await mkdtemp(join(tmpdir(), "learn-cancel-")), "a.ts");
  await writeFile(file, "export const a = 1;\n");
});
afterAll(() => server.close());
beforeEach(() => {
  closed = new Promise((r) => (markClosed = r));
});

const env = () => ({ LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
const chunk = (content: string) => ({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] });
const streamPartial = (res: ServerResponse) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify(chunk("partial"))}\n\n`);
};

describe("cancellation", () => {
  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("%s mid-stream closes the connection, keeps the partial output and exits %i", async (signal, code) => {
    respond = streamPartial;
    const r = await run([file], env(), tmpdir(), (child) => {
      child.stdout!.on("data", () => child.kill(signal));
    });
    await closed;
    expect(r.code).toBe(code);
    expect(r.stdout).toBe("partial");
    // The cancel message starts on a fresh line after the unterminated partial output.
    expect(r.stderr).toMatch(/\n\n?[^\n]*cancelled\n$/);
  });

  it("a cancel before the first byte ends cleanly", async () => {
    let connected: () => void;
    const reached = new Promise<void>((r) => (connected = r));
    respond = () => connected(); // never answers
    const r = await run([file], env(), tmpdir(), (child) => {
      void reached.then(() => child.kill("SIGINT"));
    });
    await closed;
    expect(r.code).toBe(130);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("cancelled");
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("a second signal (%s) ends the process at once with its code, while the first cancel is stuck behind output nobody reads", async (second, code) => {
    // The reader stops draining stdout after a while. Once the CLI has written more than a pipe holds, the first SIGINT closes the
    // connection but the process still cannot finish: its pending writes keep it alive.
    respond = (res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const filler = "x".repeat(64 * 1024);
      for (let i = 0; i < 128; i++) res.write(`data: ${JSON.stringify(chunk(filler))}\n\n`); // 8 MB, and the response never ends
    };
    const READ_BEFORE_STOPPING = 1024 * 1024;
    let aliveAfterFirst = false;
    let secondSentAt = 0;
    const r = await run([file], env(), tmpdir(), (child) => {
      let read = 0;
      // `run` resolves on "close", which waits for stdout to end: once the process is gone, drain what is left.
      child.on("exit", () => child.stdout!.resume());
      child.stdout!.on("data", (data: Buffer) => {
        read += data.length;
        if (read < READ_BEFORE_STOPPING || child.stdout!.isPaused()) return;
        child.stdout!.pause();
        // Time for the CLI to fill the pipe and queue more behind it; the handlers have long been installed, since output is flowing.
        setTimeout(() => child.kill("SIGINT"), 100);
      });
      // The connection closing proves the first cancel took effect; a short grace period lets a process that could exit do so.
      void closed.then(() =>
        setTimeout(() => {
          aliveAfterFirst = child.exitCode === null && child.signalCode === null;
          secondSentAt = Date.now();
          child.kill(second);
        }, 300),
      );
    });
    expect(aliveAfterFirst).toBe(true);
    expect(r.code).toBe(code);
    expect(Date.now() - secondSentAt).toBeLessThan(2000);
  });
});

// Terminal mode needs a real TTY, so these run the CLI on a pseudo-terminal through a small Python helper.
const hasPython = spawnSync("python3", ["--version"]).status === 0;
describe.skipIf(!hasPython)("cancellation on a terminal", () => {
  it("drops an escape sequence that was cut off, and still starts 'cancelled' on a fresh line", async () => {
    respond = (res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Text, then the start of a window-title sequence that never finishes.
      res.write(`data: ${JSON.stringify(chunk("partial\u001b]0;half-a-ti"))}\n\n`);
    };
    const helper = join(import.meta.dirname, "support/pty-run.py");
    const bin = join(import.meta.dirname, "../dist/cli.js");
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        "python3",
        ["-I", helper, "partial", "SIGINT", "node", bin, file],
        { env: { ...process.env, ...env(), TERM: "dumb", HOME: tmpdir(), XDG_CONFIG_HOME: join(tmpdir(), "no-learn-config") }, cwd: tmpdir() },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
    await closed;
    expect(output).toMatch(/\nexit 130\n$/);
    expect(output).not.toContain("half-a-ti");
    expect(output).not.toContain("\u001b]");
    // After the visible text comes a line break, then the message: it is not glued to "partial".
    expect(output).toMatch(/partial\r?\n[^\n]*cancelled/);
  }, 30_000);
});
