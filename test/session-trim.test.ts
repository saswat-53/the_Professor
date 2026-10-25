import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_WINDOW, followUp, formatContextReport, resolveEndpoint, resolveSessionCap, Session } from "../src/core/index.js";
import type { ExplainEvent, LanguageModel, ModelRequest } from "../src/core/index.js";

const collect = async (events: AsyncIterable<ExplainEvent>) => {
  const all: ExplainEvent[] = [];
  for await (const e of events) all.push(e);
  return all;
};

function fakeModel() {
  const requests: ModelRequest[] = [];
  const model: LanguageModel = {
    async *stream(request) {
      requests.push(request);
      yield "a".repeat(10);
    },
  };
  return { model, requests };
}

const firstRequest = (user: string): ModelRequest => ({ baseUrl: "http://h/v1", model: "m", system: "sys", user });
const ask = (session: Session, model: LanguageModel, question: string, files?: string[]) =>
  collect(followUp({ session, question, model, signal: new AbortController().signal, files }));

/** A Session with the first explanation (100 + 10 characters) and `n` follow-ups of 20 characters each (10 + 10). */
async function sessionWith(cap: number, n: number) {
  const session = new Session(cap);
  session.begin(firstRequest("f".repeat(100)), "z".repeat(10));
  const { model, requests } = fakeModel();
  for (let i = 0; i < n; i++) await ask(session, model, `q${i}`.padEnd(10, "."), i === 1 ? ["src/b.ts:1-5"] : undefined);
  return { session, model, requests };
}

describe("resolveSessionCap", () => {
  const hosted = resolveEndpoint("https://api.example.com/v1");
  const local = resolveEndpoint("http://localhost:11434/v1");

  it("is four times the budget for a hosted endpoint, whatever the context window says", () => {
    expect(resolveSessionCap(hosted, { contextBudget: 1000, contextWindow: 8, systemChars: 500 })).toBe(4000);
    expect(resolveSessionCap(hosted, {systemChars: 0})).toBe(96_000);
  });

  it("is derived from the context window for a local endpoint: a quarter reserved for the answer, four characters a token, minus the system prompt", () => {
    expect(resolveSessionCap(local, { contextWindow: 8000, contextBudget: 99_999, systemChars: 1000 })).toBe(8000 * 3 - 1000);
  });

  it("assumes Ollama's default window when none is set", () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(4096);
    expect(resolveSessionCap(local, { systemChars: 0 })).toBe(4096 * 3);
  });

  it("never goes below zero", () => {
    expect(resolveSessionCap(local, { contextWindow: 10, systemChars: 5000 })).toBe(0);
  });
});

describe("trimming a long Session", () => {
  it("sends everything while it fits", async () => {
    const { requests } = await sessionWith(10_000, 3);
    expect(requests.at(-1)!.history).toHaveLength(2 + 2 * 2);
  });

  it("drops the oldest follow-up pairs, keeps the first explanation and the most recent turns, and reports which turns went", async () => {
    // Pinned 110 + three follow-ups of 20 = 170; a fourth question (10) would make 180 + 10 = 190 > 175.
    const { session, model, requests } = await sessionWith(175, 3);
    const events = await ask(session, model, "q3........");
    const sent = requests.at(-1)!;
    expect(sent.history!.map((m) => m.content.slice(0, 2))).toEqual(["ff", "zz", "q1", "aa", "q2", "aa"]);
    const report = events.find((e) => e.type === "context-report");
    expect(report).toMatchObject({ report: { kind: "session-trimmed", turns: [2], files: [] } });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("names @file material that went with a dropped turn", async () => {
    const { session, model } = await sessionWith(175, 3);
    await ask(session, model, "q3........");
    const events = await ask(session, model, "q4........");
    const report = events.find((e) => e.type === "context-report");
    expect(report).toMatchObject({ report: { kind: "session-trimmed", turns: [3], files: ["src/b.ts:1-5"] } });
  });

  it("does not drop a turn when the request fails: nothing is lost for a question that was never answered", async () => {
    const { session, model } = await sessionWith(175, 3);
    const failing: LanguageModel = { async *stream() { throw new Error("boom"); } };
    await ask(session, failing, "q3........");
    const sentAfter = fakeModel();
    await ask(session, sentAfter.model, "q3........");
    expect(sentAfter.requests[0]!.history!.map((m) => m.content.slice(0, 2))).toEqual(["ff", "zz", "q1", "aa", "q2", "aa"]);
    void model;
  });

  it("refuses a question too big to fit beside the pinned part, sending nothing and changing nothing", async () => {
    const { session, model, requests } = await sessionWith(175, 2);
    const before = session.size;
    const events = await ask(session, model, "x".repeat(500));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", error: { name: "SessionTooLongError" } });
    expect(requests).toHaveLength(2);
    expect(session.size).toBe(before);
  });

  it("counts the question against the cap but not the dropped turns", async () => {
    const { session, model, requests } = await sessionWith(130, 3);
    await ask(session, model, "q3........");
    // Pinned 110 + the new question 10 = 120; only 10 characters left, so every follow-up pair goes.
    expect(requests.at(-1)!.history).toHaveLength(2);
  });
});

describe("a Session whose pinned part cannot fit", () => {
  it("is rejected before anything is sent, with the sizes in the message", () => {
    const session = new Session(100);
    expect(() => session.assertPinnedFits(150)).toThrow(/150 characters.*100/s);
    expect(() => session.assertPinnedFits(100)).not.toThrow();
  });

  it("is rejected again once the first answer is known", () => {
    const session = new Session(120);
    session.begin(firstRequest("f".repeat(100)), "z".repeat(50));
    expect(() => session.assertPinnedFits()).toThrow(/150 characters/);
    expect(() => session.assertPinnedFits()).toThrowError(expect.objectContaining({ name: "SessionTooLongError" }));
  });
});

describe("the Context report for a trimmed Session", () => {
  it("names the dropped turns and files", () => {
    const text = formatContextReport({ kind: "session-trimmed", turns: [2, 3, 5], files: ["a.ts", "b.ts:1-9"], capChars: 12_000 });
    expect(text).toContain("turns 2-3, 5");
    expect(text).toContain("a.ts, b.ts:1-9");
    expect(text).toContain("12,000");
    expect(formatContextReport({ kind: "session-trimmed", turns: [4], files: [], capChars: 5 })).toContain("turn 4");
    expect(formatContextReport({ kind: "session-trimmed", turns: [4], files: [], capChars: 5 })).not.toContain("@file");
  });
});
