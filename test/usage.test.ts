import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { explain } from "../src/core/explain.js";
import { followUp, Session } from "../src/core/session.js";
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

/** A model that answers each request with the next script in turn. */
const turns = (scripts: ModelEvent[][]): LanguageModel => {
  let n = 0;
  return {
    async *stream() {
      yield* scripts[n++] ?? [];
    },
  };
};

const all = async (events: AsyncIterable<ExplainEvent>) => {
  const out: ExplainEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
};

describe("Session stats", () => {
  it("add up every turn's usage, and keep the last turn's on its own", async () => {
    const model = turns([
      [{ type: "text", text: "first" }, { type: "usage", inputTokens: 100, outputTokens: 20 }],
      [{ type: "text", text: "second" }, { type: "usage", inputTokens: 150, outputTokens: 30 }],
    ]);
    const session = new Session();
    const signal = new AbortController().signal;
    await all(explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model, signal, session }));
    const events = await all(followUp({ session, question: "and then?", model, signal }));

    expect(events.at(-2)).toEqual({ type: "usage", usage: { inputTokens: 150, outputTokens: 30, source: "reported" } });
    expect(session.stats.last).toEqual({ inputTokens: 150, outputTokens: 30, source: "reported" });
    expect(session.stats.total).toEqual({ inputTokens: 250, outputTokens: 50, source: "reported" });
  });

  it("are estimated overall as soon as one turn was estimated", async () => {
    const model = turns([
      [{ type: "text", text: "first" }, { type: "usage", inputTokens: 100, outputTokens: 20 }],
      [{ type: "text", text: "a".repeat(40) }],
    ]);
    const session = new Session();
    const signal = new AbortController().signal;
    await all(explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model, signal, session }));
    expect(session.stats.total.source).toBe("reported");
    await all(followUp({ session, question: "and then?", model, signal }));
    expect(session.stats.last?.source).toBe("estimated");
    expect(session.stats.total.source).toBe("estimated");
  });

  it("stay estimated overall when an estimated turn is followed by a reported one", async () => {
    const model = turns([
      [{ type: "text", text: "first" }],
      [{ type: "text", text: "second" }, { type: "usage", inputTokens: 1, outputTokens: 1 }],
    ]);
    const session = new Session();
    const signal = new AbortController().signal;
    await all(explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model, signal, session }));
    await all(followUp({ session, question: "and then?", model, signal }));
    expect(session.stats.last?.source).toBe("reported");
    expect(session.stats.total.source).toBe("estimated");
  });

  it("are a snapshot: changing one a caller holds does not change the Session's", async () => {
    const session = new Session();
    const model = turns([[{ type: "text", text: "first" }, { type: "usage", inputTokens: 100, outputTokens: 20 }]]);
    await all(explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model, signal: new AbortController().signal, session }));
    const snapshot = session.stats;
    snapshot.total.inputTokens = 999;
    snapshot.last!.outputTokens = 999;
    expect(session.stats.total.inputTokens).toBe(100);
    expect(session.stats.last?.outputTokens).toBe(20);
  });

  it("are a snapshot: a later turn does not change one already taken", async () => {
    const model = turns([
      [{ type: "text", text: "first" }, { type: "usage", inputTokens: 100, outputTokens: 20 }],
      [{ type: "text", text: "second" }, { type: "usage", inputTokens: 1, outputTokens: 1 }],
    ]);
    const session = new Session();
    const signal = new AbortController().signal;
    await all(explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model, signal, session }));
    const before = session.stats;
    await all(followUp({ session, question: "and then?", model, signal }));
    expect(before.total).toEqual({ inputTokens: 100, outputTokens: 20, source: "reported" });
  });

  it("start at zero with no last turn, and a refused follow-up adds nothing", async () => {
    const session = new Session(10);
    expect(session.stats).toEqual({ total: { inputTokens: 0, outputTokens: 0, source: "reported" } });
    const model = turns([[{ type: "text", text: "first" }, { type: "usage", inputTokens: 5, outputTokens: 5 }]]);
    await all(explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model, signal: new AbortController().signal, session: new Session() }));
    const refused = await all(followUp({ session, question: "x".repeat(500), model, signal: new AbortController().signal }));
    expect(refused.map((e) => e.type)).toEqual(["error"]);
    expect(session.stats.total.inputTokens).toBe(0);
  });
});

/** A model that streams `text`, then waits to be cancelled. */
const hangsAfter = (text: string): LanguageModel => ({
  async *stream(_request, signal) {
    yield { type: "text", text };
    // The consumer may abort while this generator is suspended at the yield, so the signal can already have fired by now.
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve));
    throw new Error("aborted");
  },
});

describe("a cancelled turn", () => {
  it("still counts the tokens it spent, as an estimate, before the cancelled error, and adds nothing to the transcript", async () => {
    const session = new Session();
    const controller = new AbortController();
    const events: ExplainEvent[] = [];
    for await (const e of explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model: hangsAfter("abcdefgh"), signal: controller.signal, session })) {
      events.push(e);
      if (e.type === "text-delta") controller.abort();
    }
    expect(events.map((e) => e.type)).toEqual(["context-report", "text-delta", "usage", "error"]);
    expect(events.at(-2)).toMatchObject({ usage: { outputTokens: 2, source: "estimated" } });
    expect(events.at(-1)).toMatchObject({ error: { name: "CancelledError" } });
    expect(session.stats.total).toMatchObject({ outputTokens: 2, source: "estimated" });
    expect(session.turns).toEqual([]);
  });

  it("counts a cancelled follow-up too, and leaves the earlier turns as they were", async () => {
    const session = new Session();
    const ok = turns([[{ type: "text", text: "first" }, { type: "usage", inputTokens: 100, outputTokens: 20 }]]);
    await all(explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model: ok, signal: new AbortController().signal, session }));
    const controller = new AbortController();
    const events: ExplainEvent[] = [];
    for await (const e of followUp({ session, question: "and then?", model: hangsAfter("abcd"), signal: controller.signal })) {
      events.push(e);
      if (e.type === "text-delta") controller.abort();
    }
    expect(events.map((e) => e.type)).toEqual(["text-delta", "usage", "error"]);
    expect(session.stats.last).toMatchObject({ outputTokens: 1, source: "estimated" });
    expect(session.stats.total.outputTokens).toBe(21);
    expect(session.turns).toHaveLength(1);
  });

  it("counts nothing when the failure is the provider's and no text arrived", async () => {
    const session = new Session();
    const failing: LanguageModel = { async *stream() { throw new Error("boom"); } };
    const events = await all(explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model: failing, signal: new AbortController().signal, session }));
    expect(events.at(-1)?.type).toBe("error");
    expect(events.some((e) => e.type === "usage")).toBe(false);
    expect(session.stats.total.inputTokens).toBe(0);
  });
});
