import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { explain } from "../src/core/explain.js";
import type { ExplainEvent, LanguageModel, ModelEvent, ModelRequest } from "../src/core/types.js";

let file: string;

beforeAll(async () => {
  file = join(await mkdtemp(join(tmpdir(), "learn-usage-core-")), "a.ts");
  await writeFile(file, "export const x = 1;\n");
});

/** A model that streams exactly these events, and remembers the request it was sent. */
const scripted = (events: ModelEvent[], requests: ModelRequest[] = []): LanguageModel => ({
  async *stream(request) {
    requests.push(request);
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

  it("estimates a turn the endpoint reported nothing for, at four characters a token, and says so", async () => {
    const requests: ModelRequest[] = [];
    const events = await collect(scripted([{ type: "text", text: "a".repeat(40) }], requests));
    const request = requests[0]!;
    // The rule is "characters divided by four, rounded up": the output is a worked example, the input is that rule applied to what was sent.
    expect(events.at(-2)).toEqual({
      type: "usage",
      usage: { inputTokens: Math.ceil((request.system.length + request.user.length) / 4), outputTokens: 10, source: "estimated" },
    });
  });

  it("estimates an empty answer as zero tokens", async () => {
    const events = await collect(scripted([]));
    expect(events.at(-2)).toMatchObject({ type: "usage", usage: { outputTokens: 0, source: "estimated" } });
  });

  it("keeps the number the endpoint did report and estimates the missing one, marking the turn estimated", async () => {
    const events = await collect(scripted([{ type: "text", text: "a".repeat(40) }, { type: "usage", inputTokens: 120 }]));
    expect(events.at(-2)).toEqual({ type: "usage", usage: { inputTokens: 120, outputTokens: 10, source: "estimated" } });
  });
});
