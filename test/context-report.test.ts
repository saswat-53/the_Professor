import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explain, prepareRequest } from "../src/core/explain.js";
import { formatContextReport } from "../src/core/report.js";
import type { ExplainEvent, LanguageModel } from "../src/core/types.js";
import { run } from "./support/cli.js";

const hosted = { baseUrl: "https://api.example.com/v1", model: "m" };
const local = { baseUrl: "http://localhost:11434/v1", model: "m" };

/** A project holding `name`, with `lines` lines `l01`..: every one 3 characters, 4 with its newline. */
async function project(name: string, lines: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "learn-report-"));
  await mkdir(join(dir, ".git"));
  await writeFile(join(dir, name), lines.join("\n") + "\n");
  return dir;
}
const numbered = (n: number) => Array.from({ length: n }, (_, i) => `l${String(i + 1).padStart(2, "0")}`);
const model: LanguageModel = { async *stream() { yield "hi"; } };

describe("Context report", () => {
  it("is built from the same data as the request: its ranges are the ones the request names", async () => {
    const dir = await project("a.txt", numbered(99));
    const { request, report } = await prepareRequest({ reference: "a.txt:50-51", cwd: dir, settings: { ...hosted, contextBudget: 60 } });
    const named = [...request.user.matchAll(/\(a\.txt lines (\d+)-(\d+)\)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
    expect(report.kind).toBe("sent");
    if (report.kind !== "sent") return;
    const ranges = report.ranges.filter((r) => r.part !== "excerpt").map(({ start, end }) => ({ start, end }));
    expect(ranges).toEqual(named);
    expect(report.ranges.find((r) => r.part === "excerpt")).toEqual({ part: "excerpt", start: 50, end: 51 });
    const text = formatContextReport(report);
    for (const r of report.ranges) expect(text).toContain(`${r.start}-${r.end}`);
  });

  it("names the method: fallback window without a finder hit, heuristic with one", async () => {
    const plain = await project("a.txt", numbered(20));
    expect(formatContextReport((await prepareRequest({ reference: "a.txt:5", cwd: plain, settings: hosted })).report)).toContain("fallback window");
    const code = await project("a.ts", ["function f() {", "  const x = 1;", "  return x;", "}", ""]);
    expect(formatContextReport((await prepareRequest({ reference: "a.ts:2", cwd: code, settings: hosted })).report)).toContain("heuristic");
  });

  it("names the Budget and where it came from", async () => {
    const dir = await project("a.txt", numbered(5));
    expect(formatContextReport((await prepareRequest({ reference: "a.txt:2", cwd: dir, settings: local })).report)).toContain("8,000 (local default)");
    expect(formatContextReport((await prepareRequest({ reference: "a.txt:2", cwd: dir, settings: { ...hosted, contextBudget: 500 } })).report)).toContain("500 (setting)");
  });

  it("says what was dropped for budget, including the tail of an import statement inside the window", async () => {
    const header = ["import {", ...Array.from({ length: 28 }, (_, i) => `  n${i},`), '} from "./x";'];
    const dir = await project("a.ts", [...header, ...numbered(60)]);
    // Excerpt at file line 40: the window starts at line 15, inside the import (lines 1-30), so a small budget drops it.
    const { request, report } = await prepareRequest({ reference: "a.ts:40", cwd: dir, settings: { ...hosted, contextBudget: 100 } });
    expect(request.user).not.toContain("import {");
    const text = formatContextReport(report);
    expect(text).toMatch(/imports dropped, including \d+ lines? of the import statement inside the window/);
    expect(text).toMatch(/\d+ nearby lines? dropped/);
  });

  it("notes Ollama's small default context window for a local endpoint only", async () => {
    const dir = await project("a.txt", numbered(5));
    const text = formatContextReport((await prepareRequest({ reference: "a.txt:2", cwd: dir, settings: local })).report);
    expect(text).toContain("OLLAMA_CONTEXT_LENGTH");
    expect(text).toContain("ollama ps");
    expect(text).toContain("slider");
    expect(formatContextReport((await prepareRequest({ reference: "a.txt:2", cwd: dir, settings: hosted })).report)).not.toContain("ollama");
  });

  it("is emitted by explain before the first streamed text", async () => {
    const dir = await project("a.txt", numbered(5));
    const events: ExplainEvent[] = [];
    for await (const e of explain({ reference: "a.txt:2", cwd: dir, settings: hosted, model, signal: new AbortController().signal })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["context-report", "text-delta", "done"]);
  });

  it("shows a refused file as refused, with the rule's name and none of its content", async () => {
    const dir = await project(".env", ["CANARY-secret-value"]);
    const events: ExplainEvent[] = [];
    for await (const e of explain({ reference: ".env", cwd: dir, settings: hosted, model, signal: new AbortController().signal })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["context-report", "error"]);
    const text = (events[0] as { text: string }).text;
    expect(text).toMatch(/refused.*\.env/);
    expect(text).not.toContain("CANARY");
  });

  it("goes to stderr before the reply and never to stdout", async () => {
    const dir = await project("a.txt", numbered(5));
    const server = createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = { id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content: "REPLY" }, finish_reason: "stop" }] };
      res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      const r = await run(["a.txt:2"], { LEARN_BASE_URL: url, LEARN_MODEL: "m" }, dir);
      expect(r.code).toBe(0);
      expect(r.stderr).toContain("Context report");
      expect(r.stderr).toContain("a.txt");
      expect(r.stdout).not.toContain("Context report");
      expect(r.stdout).toContain("REPLY");
    } finally {
      server.close();
    }
  });
});
