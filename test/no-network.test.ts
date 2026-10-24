import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "./support/cli.js";

// ADR 0003: the only connection the tool opens is to the configured endpoint. The CLI runs with a
// preload (support/net-spy.mjs) that logs every connect, DNS lookup and UDP send it starts; each
// test compares that log with the endpoint it configured.

const SPY = pathToFileURL(join(import.meta.dirname, "support/net-spy.mjs")).href;
const FIXTURE = pathToFileURL(join(import.meta.dirname, "support/update-check-fixture.mjs")).href;

let endpoint: Server;
let elsewhere: Server;
let endpointHits = 0;
let elsewhereHits = 0;
let endpointPort: number;
let elsewherePort: number;
let respond: (res: import("node:http").ServerResponse) => void;
let dir: string;
let file: string;

const listen = async (server: Server) => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
};

beforeAll(async () => {
  endpoint = createServer((req, res) => {
    endpointHits++;
    req.resume();
    respond(res);
  });
  elsewhere = createServer((req, res) => {
    elsewhereHits++;
    req.resume();
    res.end();
  });
  endpointPort = await listen(endpoint);
  elsewherePort = await listen(elsewhere);
  dir = await mkdtemp(join(tmpdir(), "learn-net-"));
  file = join(dir, "a.ts");
  await writeFile(file, "export const a = 1;\n");
});

afterAll(() => {
  endpoint.close();
  elsewhere.close();
});

/** Runs the CLI under the spy and returns what it did plus every network operation it started. */
async function spied(args: string[], env: Record<string, string>, extraImports: string[] = []) {
  const log = join(dir, `net-${Math.random().toString(36).slice(2)}.log`);
  await writeFile(log, "");
  const imports = [SPY, ...extraImports].map((url) => `--import=${url}`).join(" ");
  const result = await run(args, { ...env, LEARN_NET_LOG: log, NODE_OPTIONS: imports });
  const operations = (await readFile(log, "utf8")).split("\n").filter(Boolean);
  return { ...result, operations };
}

const configured = () => ({ LEARN_BASE_URL: `http://127.0.0.1:${endpointPort}/v1`, LEARN_MODEL: "m" });
const onlyEndpoint = () => [`connect 127.0.0.1:${endpointPort}`];

describe("no network except the configured endpoint", () => {
  it("opens nothing on a first run with no config", async () => {
    const r = await spied([file], {});
    expect(r.code).toBe(2);
    expect(r.operations).toEqual([]);
  });

  it("opens nothing for --help and --version", async () => {
    expect((await spied(["--help"], {})).operations).toEqual([]);
    expect((await spied(["--version"], {})).operations).toEqual([]);
  });

  it("opens nothing for --dry-run, even with an endpoint configured", async () => {
    const r = await spied([file, "--dry-run"], configured());
    expect(r.code).toBe(0);
    expect(r.operations).toEqual([]);
  });

  it("contacts only the endpoint when the request fails", async () => {
    respond = (res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    };
    const r = await spied([file], configured());
    expect(r.code).toBe(1);
    expect(new Set(r.operations)).toEqual(new Set(onlyEndpoint()));
  });

  it("contacts only the endpoint when the connection is refused", async () => {
    const closed = createServer();
    const port = await listen(closed);
    await new Promise((r) => closed.close(r));
    const r = await spied([file], { LEARN_BASE_URL: `http://127.0.0.1:${port}/v1`, LEARN_MODEL: "m" });
    expect(r.code).toBe(1);
    expect(new Set(r.operations)).toEqual(new Set([`connect 127.0.0.1:${port}`]));
  });

  it("contacts only the endpoint when the request succeeds", async () => {
    respond = (res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ role: "assistant", content: "hi" }, null));
      res.write(chunk({}, "stop"));
      res.end("data: [DONE]\n\n");
    };
    const r = await spied([file], configured());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("hi");
    expect(new Set(r.operations)).toEqual(new Set(onlyEndpoint()));
  });

  it("catches an added update check (the guard's own self-test)", async () => {
    respond = (res) => res.end("{}");
    elsewhereHits = 0;
    const r = await spied([file, "--dry-run"], { ...configured(), GUARD_FIXTURE_URL: `http://127.0.0.1:${elsewherePort}/latest` }, [FIXTURE]);
    expect(r.operations).toContain(`connect 127.0.0.1:${elsewherePort}`);
    expect(elsewhereHits).toBe(1);
    // The assertion every other test makes fails on this run, which is the point.
    expect(r.operations).not.toEqual([]);
  });
});
