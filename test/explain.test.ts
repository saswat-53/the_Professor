import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
