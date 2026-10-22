import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { explain } from "../src/core/explain.js";
import type { ExplainEvent, LanguageModel, ModelRequest } from "../src/core/types.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "learn-read-"));
});

async function run(reference: string) {
  const requests: ModelRequest[] = [];
  const model: LanguageModel = {
    async *stream(request) {
      requests.push(request);
      yield "ok";
    },
  };
  const events: ExplainEvent[] = [];
  for await (const e of explain({
    reference,
    settings: { baseUrl: "http://h/v1", model: "m" },
    model,
    signal: new AbortController().signal,
  })) events.push(e);
  const last = events.at(-1);
  return { requests, error: last?.type === "error" ? last.message : undefined };
}

async function fileWith(name: string, content: string | Buffer) {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

// The 1 MB and 8 KB boundaries are hard-coded on purpose: importing the constants would let
// an accidental change to them pass these tests silently.
describe("file reading rules", () => {
  it("refuses a directory", async () => {
    const r = await run(dir);
    expect(r.error).toMatch(/not a regular file/);
    expect(r.requests).toHaveLength(0);
  });

  // Opening a FIFO blocks until a writer appears, so a regression to open-before-stat hangs here;
  // the short timeout makes that fail fast. FIFOs and devices assume macOS or Linux.
  it.skipIf(process.platform === "win32")(
    "refuses a named pipe without blocking on it",
    { timeout: 2000 },
    async () => {
      const fifo = join(dir, "pipe");
      execFileSync("mkfifo", [fifo]);
      const r = await run(fifo);
      expect(r.error).toMatch(/not a regular file/);
    },
  );

  it.skipIf(process.platform === "win32")("refuses a device", async () => {
    const r = await run("/dev/null");
    expect(r.error).toMatch(/not a regular file/);
  });

  it("refuses a file over 1 MB, judged by its size before it is read", async () => {
    const path = await fileWith("big.txt", "a".repeat(1024 * 1024 + 1));
    const r = await run(path);
    expect(r.error).toMatch(/too large/);
    expect(r.requests).toHaveLength(0);
  });

  it("accepts a file of exactly 1 MB", async () => {
    const path = await fileWith("limit.txt", "a".repeat(1024 * 1024));
    const r = await run(path);
    expect(r.error).toBeUndefined();
  });

  it("refuses a file with a NUL byte in its first 8 KB as binary", async () => {
    const path = await fileWith("bin.dat", Buffer.concat([Buffer.from("text"), Buffer.from([0]), Buffer.from("more")]));
    const r = await run(path);
    expect(r.error).toMatch(/binary/);
    expect(r.requests).toHaveLength(0);
  });

  it("does not treat a NUL byte after the first 8 KB as binary", async () => {
    const path = await fileWith("late-nul.txt", Buffer.concat([Buffer.alloc(8192, "a"), Buffer.from([0])]));
    const r = await run(path);
    expect(r.error).toBeUndefined();
  });

  it("refuses a file that isn't valid UTF-8 with 'not UTF-8 text'", async () => {
    const path = await fileWith("latin1.txt", Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    const r = await run(path);
    expect(r.error).toContain("not UTF-8 text");
    expect(r.requests).toHaveLength(0);
  });

  it("strips a BOM and normalises CRLF before the model sees the text", async () => {
    const path = await fileWith("win.ts", "\uFEFFconst a = 1;\r\nconst b = 2;\r\n");
    const r = await run(path);
    const user = r.requests[0]?.user ?? "";
    expect(user).toContain("const a = 1;\nconst b = 2;\n");
    expect(user).not.toContain("\uFEFF");
    expect(user).not.toContain("\r");
  });

  it("reads a minified single-line file without crashing", async () => {
    const path = await fileWith("min.js", "var a=1;".repeat(50_000));
    const r = await run(path);
    expect(r.error).toBeUndefined();
    expect(r.requests).toHaveLength(1);
  });
});
