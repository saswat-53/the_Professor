import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "./support/cli.js";

const BIN = join(import.meta.dirname, "../dist/cli.js");
const ANSI = /\u001b\[/;
let server: Server;
let baseUrl: string;
let file: string;

const chunk = (delta: object, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    // Enough output, spread over time, that the reader can quit while we are still writing.
    for (let i = 0; i < 40; i++) {
      if (res.destroyed) return;
      res.write(chunk({ content: `line ${i} of the explanation\n`.repeat(200) }));
      await new Promise((r) => setTimeout(r, 25));
    }
    res.write(chunk({}, "stop"));
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  file = join(await mkdtemp(join(tmpdir(), "learn-out-")), "sample.ts");
  await writeFile(file, "export const answer = 42;\n");
});

afterAll(() => server.close());

describe("output modes", () => {
  it("piped output has no ANSI escape codes on either stream, even for warnings and errors", async () => {
    const ok = await run([file, "--dry-run"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m", LEARN_LEVEL: "bogus" });
    expect(ok.stdout + ok.stderr).not.toMatch(ANSI);
    const bad = await run([file], { LEARN_BASE_URL: "http://127.0.0.1:1/v1", LEARN_MODEL: "m" });
    expect(bad.stderr).not.toBe("");
    expect(bad.stdout + bad.stderr).not.toMatch(ANSI);
  });

  it("puts the context report on stderr and only the explanation on stdout", async () => {
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^line 0 of the explanation/);
    expect(r.stdout).not.toContain("sample.ts");
    expect(r.stderr).toContain("sample.ts");
  });

  it("ends quietly when the output pipe closes early", async () => {
    const env = { ...process.env, LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m", HOME: tmpdir() };
    const child = spawn("sh", ["-c", `node "${BIN}" "${file}" | head -c 10 >/dev/null`], { env, cwd: tmpdir() });
    // Errors from the learn side would surface on the shell's stderr, since only stdout is piped.
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const code = await new Promise((r) => child.on("close", r));
    expect(code).toBe(0);
    expect(stderr).not.toMatch(/EPIPE|at .*\(.*:\d+:\d+\)|Error/);
  });

  it("ends quietly when the stderr pipe closes early (2>&1 | head)", async () => {
    // --dry-run writes the whole prompt to stderr; a big file keeps it writing after head has quit.
    const big = join(await mkdtemp(join(tmpdir(), "learn-big-")), "big.ts");
    await writeFile(big, "export const filler = 1;\n".repeat(40_000));
    const env = { ...process.env, LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m", HOME: tmpdir() };
    const child = spawn("node", [BIN, big, "--dry-run", "--context-budget", "2000000"], { env, cwd: tmpdir() });
    // Be the reader that quits early: take the first bytes, then close our end. Any stack trace
    // would go to that closed stderr, so the exit code is what shows whether the run ended cleanly.
    child.stderr.once("data", () => child.stderr.destroy());
    const code = await new Promise((r) => child.on("close", r));
    expect(code).toBe(0);
  });

  it("keeps a failure's exit code when the pipe closes after it (refused file, exit 3)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-refused-"));
    const secret = join(dir, ".env");
    await writeFile(secret, "TOKEN=abc\n");
    // A non-local endpoint, since the sensitive-file check is skipped for local ones; --dry-run sends nothing.
    const env = { ...process.env, LEARN_BASE_URL: "https://example.invalid/v1", LEARN_MODEL: "m", HOME: tmpdir() };
    const child = spawn("node", [BIN, secret, "--dry-run"], { env, cwd: dir });
    // The reader is gone before the first byte, so every write to stderr hits a closed pipe.
    child.stderr.destroy();
    const code = await new Promise((r) => child.on("close", r));
    expect(code).toBe(3);
  });
});

describe("--help and --version", () => {
  it("--help prints usage to stdout and exits 0, naming the short flags", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage: learn");
    expect(r.stdout).toContain("-h");
    expect(r.stdout).toContain("-v");
    expect(r.stderr).toBe("");
  });

  it("--help wins over a file argument and over valid flags", async () => {
    const r = await run([file, "--dry-run", "--help"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage: learn");
    expect(r.stderr).toBe("");
  });

  it("--version prints the package version to stdout and exits 0", async () => {
    const { version } = JSON.parse(await readFile(join(import.meta.dirname, "../package.json"), "utf8"));
    const r = await run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`${version}\n`);
    expect(r.stderr).toBe("");
  });
});
