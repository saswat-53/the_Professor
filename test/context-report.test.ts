import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explain, prepareRequest } from "../src/core/explain.js";
import { type ContextReport, formatContextReport } from "../src/core/report.js";
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
  // Every way the report and the request could drift apart. Content lines are `lNN`, at file line NN + the header's length.
  const bigImport = ["import {", ...Array.from({ length: 28 }, (_, i) => `  n${i},`), '} from "./x";'];
  const fixedBlock = { name: "fixed", find: () => ({ start: 40, end: 60 }) };
  const sameData: [string, { header: string[]; at: number; budget: number; finder?: typeof fixedBlock; method: string; parts: string[]; dropped?: object }][] = [
    ["imports kept", { header: ['import a from "./a";'], at: 51, budget: 400, method: "fallback window", parts: ["imports", "before", "excerpt", "after"] }],
    ["imports dropped whole, nothing else lost", { header: ['import a from "./a";'], at: 51, budget: 210, method: "fallback window", parts: ["before", "excerpt", "after"], dropped: { imports: true, lines: 0, importTail: 0 } }],
    ["imports dropped with the tail of the statement inside the window", { header: bigImport, at: 40, budget: 100, method: "fallback window", parts: ["before", "excerpt", "after"], dropped: { imports: true, lines: 50 - 16 - 24, importTail: 16 } }],
    ["Enclosing block", { header: [], at: 51, budget: 4_000, finder: fixedBlock, method: "heuristic", parts: ["before", "excerpt", "after"] }],
    ["fallback window", { header: [], at: 51, budget: 4_000, method: "fallback window", parts: ["before", "excerpt", "after"] }],
    ["Enclosing block, trimmed", { header: [], at: 51, budget: 40, finder: fixedBlock, method: "heuristic", parts: ["before", "excerpt", "after"], dropped: { imports: false, lines: 20 - 9, importTail: 0 } }],
    ["nearby lines trimmed", { header: [], at: 51, budget: 40, method: "fallback window", parts: ["before", "excerpt", "after"], dropped: { imports: false, lines: 50 - 9, importTail: 0 } }],
  ];
  it.each(sameData)("report and request agree line for line: %s", async (_name, c) => {
    const dir = await project("a.ts", [...c.header, ...numbered(99)]);
    const { request, report } = await prepareRequest({
      reference: `a.ts:${c.at}`,
      cwd: dir,
      settings: { ...hosted, contextBudget: c.budget },
      blockFinder: c.finder,
    });
    if (report.kind !== "sent") throw new Error("expected a sent report");
    expect(report.ranges.map((r) => r.part)).toEqual(c.parts);
    expect(report.method).toBe(c.method);
    expect(report.dropped).toEqual(c.dropped);
    // The `lNN` lines the request carries, as file line numbers, are exactly the non-import lines the report lists.
    const sent = [...request.user.matchAll(/^l(\d\d)$/gm)].map((m) => Number(m[1]) + c.header.length).sort((x, y) => x - y);
    const listed = report.ranges.filter((r) => r.part !== "imports").flatMap((r) => Array.from({ length: r.end - r.start + 1 }, (_, i) => r.start + i));
    expect(sent).toEqual(listed);
    // Imports are in the request exactly when the report lists them, over the very lines it names.
    const imports = report.ranges.find((r) => r.part === "imports");
    if (c.header.length > 0) expect(request.user.includes(c.header[0]!)).toBe(imports !== undefined);
    if (imports) expect(request.user).toContain(`(a.ts ${imports.start === imports.end ? `line ${imports.start}` : `lines ${imports.start}-${imports.end}`})`);
  });

  it("names the method: fallback window without a finder hit, heuristic with one", async () => {
    const plain = await project("a.txt", numbered(20));
    expect(formatContextReport((await prepareRequest({ reference: "a.txt:5", cwd: plain, settings: hosted })).report)).toContain("fallback window");
    const code = await project("a.ts", ["function f() {", "  const x = 1;", "  return x;", "}", ""]);
    expect(formatContextReport((await prepareRequest({ reference: "a.ts:2", cwd: code, settings: hosted })).report)).toContain("heuristic");
  });

  it.each([
    ["hosted", hosted, "  hosted endpoint budget 24,000 characters (default)"],
    ["local", local, "  local endpoint budget 8,000 characters (default)"],
    ["setting", { ...hosted, contextBudget: 500 }, "  budget 500 characters (setting)"],
  ])("pins the budget line's format (%s), which scripts may read", async (_name, settings, line) => {
    const dir = await project("a.txt", numbered(5));
    const lines = formatContextReport((await prepareRequest({ reference: "a.txt:2", cwd: dir, settings })).report).split("\n");
    expect(lines).toContain(line);
  });

  it("names the Budget and where it came from", async () => {
    const dir = await project("a.txt", numbered(5));
    expect(formatContextReport((await prepareRequest({ reference: "a.txt:2", cwd: dir, settings: local })).report)).toContain("local endpoint budget 8,000 characters (default)");
    expect(formatContextReport((await prepareRequest({ reference: "a.txt:2", cwd: dir, settings: { ...hosted, contextBudget: 500 } })).report)).toContain("budget 500 characters (setting)");
  });

  it("says what was dropped for budget, including the tail of an import statement inside the window", async () => {
    const header = ["import {", ...Array.from({ length: 28 }, (_, i) => `  n${i},`), '} from "./x";'];
    const dir = await project("a.ts", [...header, ...numbered(60)]);
    // Excerpt at file line 40: the window starts at line 15, inside the import (lines 1-30), so a small budget drops it.
    const { request, report } = await prepareRequest({ reference: "a.ts:40", cwd: dir, settings: { ...hosted, contextBudget: 100 } });
    expect(request.user).not.toContain("import {");
    const text = formatContextReport(report);
    if (report.kind !== "sent") throw new Error("expected a sent report");
    const { importTail, lines } = report.dropped!;
    expect(report.dropped!.imports).toBe(true);
    // Window 15-65, import ends at 30: 16 window lines are the import's tail.
    expect(importTail).toBe(16);
    expect(text).toContain(`imports dropped, including ${importTail} lines of the import statement inside the window`);
    // Nearby lines kept: the Excerpt's neighbours that fit; the rest of the window (50 lines, minus tail) is counted.
    expect(lines).toBe(50 - importTail - (report.ranges.filter((r) => r.part !== "excerpt").reduce((n, r) => n + r.end - r.start + 1, 0)));
    expect(text).toContain(`${lines} nearby lines dropped`);
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
    // Structured data, not rendered text: a frontend decides how to show it.
    const report = (events[0] as { report: ContextReport }).report;
    expect(report.kind).toBe("sent");
    expect(events[0]).not.toHaveProperty("text");
  });

  it("shows a refused file as refused, with the rule's name and none of its content", async () => {
    const dir = await project(".env", ["CANARY-secret-value"]);
    const events: ExplainEvent[] = [];
    for await (const e of explain({ reference: ".env", cwd: dir, settings: hosted, model, signal: new AbortController().signal })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["context-report", "error"]);
    const text = formatContextReport((events[0] as { report: ContextReport }).report);
    expect(text).toMatch(/refused.*\.env/);
    expect(text).not.toContain("CANARY");
  });

  it("shows a refused file under --dry-run too", async () => {
    const dir = await project(".env", ["CANARY-secret-value"]);
    const r = await run([".env", "--dry-run"], { LEARN_BASE_URL: "https://api.example.com/v1", LEARN_MODEL: "m" }, dir);
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/refused: \.env \(rule: \.env\)/);
    expect(r.stderr).not.toContain("CANARY");
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

describe("secret canary (the gate)", () => {
  const CANARY = "CANARY-9f3a-never-leave";
  const KEY_CANARY = "sk-CANARY-key-never-leave";

  /** A project inside a temp HOME, with a denylisted file, a gitignored file and an ordinary file, all holding the canary. */
  async function secretProject() {
    const home = await realpath(await mkdtemp(join(tmpdir(), "learn-home-")));
    const repo = join(home, "proj");
    await mkdir(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await writeFile(join(repo, ".env"), `TOKEN=${CANARY}\n`);
    await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
    await writeFile(join(repo, "ignored.txt"), `${CANARY}\n`);
    // Ordinary, but it names the secret files, so a Context that followed references would be tempting to build.
    await writeFile(join(repo, "ok.txt"), 'const secrets = readFileSync(".env");\nconst ignored = readFileSync("ignored.txt");\n');
    return { home, repo };
  }

  async function withServer<T>(body: (url: string, received: () => string, auth: () => string | undefined) => Promise<T>): Promise<T> {
    let received = "";
    let auth: string | undefined;
    const server = createServer((req, res) => {
      auth = req.headers.authorization;
      req.on("data", (d) => (received += d));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = { id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] };
        res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      return await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, () => received, () => auth);
    } finally {
      server.close();
    }
  }

  it.each([
    [".env", "--dry-run"],
    ["ignored.txt", "--dry-run"],
    ["ok.txt", "--dry-run"],
    [".env", "--show-prompt"],
    ["ignored.txt", "--show-prompt"],
    ["ok.txt", "--show-prompt"],
    [".env", "stream"],
    ["ignored.txt", "stream"],
    ["ok.txt", "stream"],
  ])("%s with %s: no canary and no home path in stdout, stderr or the request body", async (target, mode) => {
    const { home, repo } = await secretProject();
    await withServer(async (url, received, auth) => {
      // Sensitive files are only refused for a non-local endpoint, and a refusal happens before any request, so those runs
      // use a hosted URL that is never contacted. Only the ordinary file streams, to the local spy.
      const baseUrl = mode === "stream" && target === "ok.txt" ? url : "https://api.example.com/v1";
      const args = mode === "stream" ? [target] : [target, mode];
      const r = await run(args, { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m", LEARN_API_KEY: KEY_CANARY, HOME: home }, repo);
      const everything = r.stdout + r.stderr + received();
      expect(everything).not.toContain(CANARY);
      // Only a run that sends a request can leak the key; the others show it stays out of refusals and dry runs.
      expect(everything).not.toContain(KEY_CANARY);
      expect(everything).not.toContain(home);
      // The key really is used when a request goes out (as the Authorization header), and still never printed.
      if (mode === "stream" && target === "ok.txt") expect(auth()).toBe(`Bearer ${KEY_CANARY}`);
      if (target === "ok.txt") expect(r.stderr).toContain("Context report");
      else {
        expect(r.code).toBe(3);
        expect(r.stderr).toMatch(/refused: /);
      }
    });
  });

  it("the report events carry no canary either", async () => {
    const { repo } = await secretProject();
    for (const reference of [".env", "ignored.txt", "ok.txt"]) {
      const events: ExplainEvent[] = [];
      for await (const e of explain({ reference, cwd: repo, settings: hosted, model, signal: new AbortController().signal })) events.push(e);
      expect(JSON.stringify(events.filter((e) => e.type === "context-report"))).not.toContain(CANARY);
    }
  });
});
