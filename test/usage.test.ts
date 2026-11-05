import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { explain } from "../src/core/explain.js";
import type { ExplainEvent, LanguageModel, ModelEvent } from "../src/core/types.js";

let file: string;

beforeAll(async () => {
  file = join(await mkdtemp(join(tmpdir(), "learn-usage-core-")), "a.ts");
  await writeFile(file, "export const x = 1;\n");
});

/** A model that streams exactly these events. */
const scripted = (events: ModelEvent[]): LanguageModel => ({
  async *stream() {
    yield* events;
  },
});

async function collect(model: LanguageModel): Promise<ExplainEvent[]> {
  const events: ExplainEvent[] = [];
  for await (const e of explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model, signal: new AbortController().signal })) events.push(e);
  return events;
}

describe("usage in the explain stream", () => {
  it("passes on the usage the model reported, marked reported, just before done", async () => {
    const events = await collect(
      scripted([
        { type: "text", text: "Hello" },
        { type: "usage", inputTokens: 120, outputTokens: 30 },
      ]),
    );
    expect(events.at(-2)).toEqual({ type: "usage", usage: { inputTokens: 120, outputTokens: 30, source: "reported" } });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.filter((e) => e.type === "text-delta")).toEqual([{ type: "text-delta", text: "Hello" }]);
  });
});
