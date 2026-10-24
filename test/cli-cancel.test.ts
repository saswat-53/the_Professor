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

  it("a second signal ends the process at once with that signal's code, even while the first is still winding down", async () => {
    let connected: () => void;
    const reached = new Promise<void>((r) => (connected = r));
    respond = () => connected();
    const started = Date.now();
    const r = await run([file], env(), tmpdir(), (child) => {
      void reached.then(() => {
        child.kill("SIGINT");
        child.kill("SIGINT");
      });
    });
    expect(r.code).toBe(130);
    expect(Date.now() - started).toBeLessThan(5000);
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
    const output = await new Promise<string>((resolve) => {
      execFile(
        "python3",
        ["-I", helper, "partial", "SIGINT", "node", bin, file],
        { env: { ...process.env, ...env(), TERM: "dumb", HOME: tmpdir(), XDG_CONFIG_HOME: join(tmpdir(), "no-learn-config") }, cwd: tmpdir() },
        (_err, stdout) => resolve(stdout),
      );
    });
    await closed;
    expect(output).toMatch(/\nexit 130\n$/);
    expect(output).not.toContain("half-a-ti");
    expect(output).not.toContain("\u001b]");
    // After the visible text comes a line break, then the message: it is not glued to "partial".
    expect(output).toMatch(/partial\r?\n[^\n]*cancelled/);
  });
});
