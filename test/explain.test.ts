import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CancelledError } from "../src/core/errors.js";
import { explain } from "../src/core/explain.js";
import type { ExplainEvent, LanguageModel, ModelRequest } from "../src/core/types.js";

function fakeModel(chunks: string[]) {
  const requests: ModelRequest[] = [];
  const model: LanguageModel = {
    async *stream(request) {
      requests.push(request);
      for (const c of chunks) yield c;
    },
  };
  return { model, requests };
}

describe("explain", () => {
  it("emits text deltas followed by done for a real file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-"));
    const file = join(dir, "a.ts");
    await writeFile(file, "export const x = 1;\n");
    const { model, requests } = fakeModel(["Hel", "lo"]);

    const events: ExplainEvent[] = [];
    for await (const e of explain({
      reference: file,
      root: tmpdir(),
      settings: { baseUrl: "http://h/v1", model: "m" },
      model,
      signal: new AbortController().signal,
    })) events.push(e);

    const types = events.map((e) => e.type);
    expect(types.at(-1)).toBe("done");
    expect(events.filter((e) => e.type === "text-delta").map((e) => (e as { text: string }).text)).toEqual(["Hel", "lo"]);
    expect(requests[0]?.user).toContain("export const x = 1;");
  });

  it("emits an error event when the file is missing", async () => {
    const { model } = fakeModel([]);
    const events: ExplainEvent[] = [];
    for await (const e of explain({
      reference: "/nonexistent/file.ts",
      root: tmpdir(),
      settings: { baseUrl: "http://h/v1", model: "m" },
      model,
      signal: new AbortController().signal,
    })) events.push(e);
    expect(events.at(-1)?.type).toBe("error");
  });
});

describe("explain cancellation", () => {
  const settings = { baseUrl: "http://h/v1", model: "m" };

  it("ends with a cancelled error and no further text once the signal aborts mid-stream", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-"));
    const file = join(dir, "a.ts");
    await writeFile(file, "export const x = 1;\n");
    const controller = new AbortController();
    const model: LanguageModel = {
      async *stream() {
        yield "first";
        controller.abort();
        yield "second";
      },
    };
    const events: ExplainEvent[] = [];
    for await (const e of explain({ reference: file, root: tmpdir(), settings, model, signal: controller.signal })) events.push(e);
    const texts = events.filter((e) => e.type === "text-delta").map((e) => (e as { text: string }).text);
    expect(texts).toEqual(["first"]);
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    expect(last?.type === "error" && last.error).toBeInstanceOf(CancelledError);
    expect(last?.type === "error" && last.error.exitCode).toBe(130);
  });

  it("reports a model that throws because of an abort as cancelled, not as a provider error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-"));
    const file = join(dir, "a.ts");
    await writeFile(file, "export const x = 1;\n");
    const controller = new AbortController();
    const model: LanguageModel = {
      // eslint-disable-next-line require-yield
      async *stream(_request, signal) {
        controller.abort();
        throw Object.assign(new Error("aborted"), { name: "AbortError", cause: signal.reason });
      },
    };
    const events: ExplainEvent[] = [];
    for await (const e of explain({ reference: file, root: tmpdir(), settings, model, signal: controller.signal })) events.push(e);
    const last = events.at(-1);
    expect(last?.type === "error" && last.error).toBeInstanceOf(CancelledError);
    expect(events.some((e) => e.type === "text-delta")).toBe(false);
  });

  it("ends with a cancelled error, never reaching the model, when the signal is already aborted", async () => {
    const { model, requests } = fakeModel(["never"]);
    const controller = new AbortController();
    controller.abort();
    const events: ExplainEvent[] = [];
    for await (const e of explain({ reference: "/nonexistent/file.ts", root: tmpdir(), settings, model, signal: controller.signal })) events.push(e);
    expect(events.at(-1)?.type === "error" && events.at(-1)).toMatchObject({ error: expect.any(CancelledError) });
    expect(requests).toEqual([]);
  });
});
