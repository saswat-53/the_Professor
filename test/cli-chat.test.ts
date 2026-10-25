import { execFile, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "./support/cli.js";

const BIN = join(import.meta.dirname, "../dist/cli.js");
const HELPER = join(import.meta.dirname, "support/pty-script.py");
const ENTER = "\r";
const hasPython = spawnSync("python3", ["--version"]).status === 0;

type Body = { messages: { role: string; content: string }[] };
let server: Server;
let baseUrl: string;
let bodies: Body[];
let dir: string;
let file: string;

const chunk = (content: string) => ({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] });

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw) as Body;
      bodies.push(body);
      const last = body.messages.at(-1)!.content;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify(chunk(`ANSWER${bodies.length}`))}\n\n`);
      // A question of "hang" leaves the response open, so a test can cancel it.
      if (last === "hang") return;
      res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  dir = await mkdtemp(join(tmpdir(), "learn-chat-"));
  file = join(dir, "a.ts");
  await writeFile(file, "export const a = 1;\n");
});
afterAll(() => server.close());
beforeEach(() => {
  bodies = [];
});

/** Types `steps` into `learn <file> --chat` on a pseudo-terminal. */
async function chat(steps: [string, string][]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "learn-chat-home-"));
  return await new Promise((resolve, reject) => {
    execFile("python3", ["-I", HELPER, JSON.stringify(steps), "node", BIN, file, "--chat"], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "", TERM: "dumb", NO_COLOR: "1", LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" }, cwd: dir }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

describe("learn --chat without a terminal", () => {
  it("refuses with exit 2 and a message, and sends no request", async () => {
    const r = await run([file, "--chat"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" }, dir, undefined, "ignored\n");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("needs a terminal");
    expect(r.stdout).toBe("");
    expect(bodies).toEqual([]);
  });
});

describe.skipIf(!hasPython)("learn --chat on a terminal", () => {
  it("answers follow-ups that remember the earlier turns, and writes nothing to disk", async () => {
    const before = await readdir(dir);
    const out = await chat([
      ["learn> ", `why is it 1?${ENTER}`],
      ["ANSWER2", `and then?${ENTER}`],
      ["ANSWER3", `/exit${ENTER}`],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]!.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user"]);
    expect(bodies[2]!.messages[1]!.content).toContain("export const a = 1;");
    expect(bodies[2]!.messages[2]!.content).toBe("ANSWER1");
    expect(bodies[2]!.messages[3]!.content).toBe("why is it 1?");
    expect(bodies[2]!.messages[4]!.content).toBe("ANSWER2");
    expect(bodies[2]!.messages[5]!.content).toBe("and then?");
    expect(await readdir(dir)).toEqual(before);
  }, 30_000);

  it("takes pasted code between <<< and >>> as one message", async () => {
    const out = await chat([
      ["learn> ", `<<<${ENTER}`],
      ["...", `const b = 2;${ENTER}`],
      ["...", `const c = 3;${ENTER}`],
      ["...", `>>>${ENTER}`],
      ["ANSWER2", `/exit${ENTER}`],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(bodies[1]!.messages.at(-1)!.content).toBe("const b = 2;\nconst c = 3;");
  }, 30_000);

  it("Ctrl-C during a response cancels only that response; the chat goes on", async () => {
    const out = await chat([
      ["learn> ", `hang${ENTER}`],
      ["ANSWER2", "\u0003"],
      ["cancelled", `again${ENTER}`],
      ["ANSWER3", `/exit${ENTER}`],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(bodies).toHaveLength(3);
    // The cancelled turn is not part of the history.
    expect(bodies[2]!.messages.map((m) => m.content)).not.toContain("hang");
  }, 30_000);

  it("Ctrl-C at an idle prompt ends the chat", async () => {
    const out = await chat([["learn> ", "\u0003"]]);
    expect(out).toMatch(/\nexit 0\n$/);
  }, 30_000);
});
