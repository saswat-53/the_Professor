import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
    req.resume();
    respond(res);
  });
  elsewhere = createServer((req, res) => {
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

/** Runs the CLI under the spy and returns what it did, every network operation it started, and the commands it spawned. */
async function runWithSpy(args: string[], env: Record<string, string>, extraImports: string[] = [], cwd?: string, input?: string) {
  const log = join(dir, `net-${Math.random().toString(36).slice(2)}.log`);
  await writeFile(log, "");
  const imports = [SPY, ...extraImports].map((url) => `--import=${url}`);
  const nodeOptions = [process.env.NODE_OPTIONS, ...imports].filter(Boolean).join(" ");
  const result = await run(args, { ...env, LEARN_NET_LOG: log, NODE_OPTIONS: nodeOptions }, cwd, undefined, input);
  const lines = (await readFile(log, "utf8")).split("\n").filter(Boolean);
  const spawned = lines.filter((line) => line.startsWith("spawn ")).map((line) => basename(line.slice("spawn ".length)));
  return { ...result, operations: lines.filter((line) => !line.startsWith("spawn ")), spawned };
}

const envFor = (port: number) => ({ LEARN_BASE_URL: `http://127.0.0.1:${port}/v1`, LEARN_MODEL: "m" });
const configuredEnv = () => envFor(endpointPort);

/** The guard itself: every operation is a connect to `port` on loopback, and nothing else. */
const expectOnlyConnectionsTo = (operations: string[], port: number) =>
  expect(new Set(operations)).toEqual(new Set([`connect 127.0.0.1:${port}`]));

describe("no network except the configured endpoint", () => {
  it("opens nothing on a first run with no config", async () => {
    const r = await runWithSpy([file], {});
    expect(r.code).toBe(2);
    expect(r.operations).toEqual([]);
  });

  it("opens nothing for --help and --version", async () => {
    expect((await runWithSpy(["--help"], {})).operations).toEqual([]);
    expect((await runWithSpy(["--version"], {})).operations).toEqual([]);
  });

  it("opens nothing for --dry-run, even with an endpoint configured", async () => {
    const r = await runWithSpy([file, "--dry-run"], configuredEnv());
    expect(r.code).toBe(0);
    expect(r.operations).toEqual([]);
  });

  it("contacts only the endpoint when the request fails", async () => {
    respond = (res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    };
    const r = await runWithSpy([file], configuredEnv());
    expect(r.code).toBe(1);
    expectOnlyConnectionsTo(r.operations, endpointPort);
  });

  it("contacts only the endpoint when the connection is refused", async () => {
    const closed = createServer();
    const port = await listen(closed);
    await new Promise((r) => closed.close(r));
    const r = await runWithSpy([file], envFor(port));
    expect(r.code).toBe(1);
    expectOnlyConnectionsTo(r.operations, port);
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
    const r = await runWithSpy([file], configuredEnv());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("hi");
    expectOnlyConnectionsTo(r.operations, endpointPort);
  });

  it("contacts only the endpoint for a file:line reference", async () => {
    respond = (res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    };
    const r = await runWithSpy([`${file}:1`], configuredEnv());
    expect(r.code).toBe(1);
    expectOnlyConnectionsTo(r.operations, endpointPort);
  });

  it("opens nothing for piped input under --dry-run, and only the endpoint otherwise", async () => {
    const dry = await runWithSpy(["--dry-run"], configuredEnv(), [], undefined, "export const a = 1;\n");
    expect(dry.code).toBe(0);
    expect(dry.operations).toEqual([]);
    respond = (res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    };
    const r = await runWithSpy([], configuredEnv(), [], undefined, "export const a = 1;\n");
    expect(r.code).toBe(1);
    expectOnlyConnectionsTo(r.operations, endpointPort);
  });

  it("contacts only the endpoint when the endpoint comes from the config file", async () => {
    respond = (res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    };
    const xdg = await mkdtemp(join(tmpdir(), "learn-xdg-"));
    await mkdir(join(xdg, "learn"));
    await writeFile(join(xdg, "learn", "config.toml"), `[provider]\nbase_url = "http://127.0.0.1:${endpointPort}/v1"\nmodel = "m"\n`);
    const r = await runWithSpy([file], { XDG_CONFIG_HOME: xdg });
    expect(r.code).toBe(1);
    expectOnlyConnectionsTo(r.operations, endpointPort);
  });

  it("spawns only git, and only inside a git repository", async () => {
    const repo = await mkdtemp(join(tmpdir(), "learn-net-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await writeFile(join(repo, "a.ts"), "export const a = 1;\n");
    respond = (res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    };
    for (const args of [["a.ts", "--dry-run"], ["a.ts"], ["--help"]]) {
      const r = await runWithSpy(args, configuredEnv(), [], repo);
      expect(new Set(r.spawned) <= new Set(["git"])).toBe(true);
    }
    const used = await runWithSpy(["a.ts", "--dry-run"], configuredEnv(), [], repo);
    expect(used.spawned).toContain("git"); // so the check above is not vacuously true
  });

  // A negative control: the same guard, run against a build that has an update check added, must fail.
  it("fails when an update check is added (the guard's own self-test)", async () => {
    const r = await runWithSpy([file, "--dry-run"], { ...configuredEnv(), GUARD_FIXTURE_URL: `http://127.0.0.1:${elsewherePort}/latest` }, [FIXTURE]);
    expect(r.operations).toContain(`connect 127.0.0.1:${elsewherePort}`);
    expect(() => expect(r.operations).toEqual([])).toThrow();
    expect(r.spawned).toContain("node"); // the spawn check catches the fixture's extra binary
  });
});
