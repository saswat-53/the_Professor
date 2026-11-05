import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explain, followUp, Session } from "../src/core/index.js";
import type { ExplainEvent, LanguageModel, ModelRequest } from "../src/core/index.js";

function fakeModel(answers: string[]) {
  const requests: ModelRequest[] = [];
  const model: LanguageModel = {
    async *stream(request) {
      requests.push(request);
      yield { type: "text", text: answers[requests.length - 1] ?? "" };
    },
  };
  return { model, requests };
}

const collect = async (events: AsyncIterable<ExplainEvent>) => {
  const all: ExplainEvent[] = [];
  for await (const e of events) all.push(e);
  return all;
};

async function firstExplanation(session: Session, model: LanguageModel) {
  const dir = await mkdtemp(join(tmpdir(), "learn-session-"));
  const file = join(dir, "a.ts");
  await writeFile(file, "export const x = 1;\n");
  return await collect(explain({ reference: file, root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model, signal: new AbortController().signal, session }));
}

describe("the Session cap on a question that cannot fit", () => {
  it("refuses a question that would pass it even with every earlier turn dropped, sends nothing, and leaves the Session as it was", async () => {
    const { model, requests } = fakeModel(["first answer", "second"]);
    const session = new Session(200);
    await firstExplanation(session, model);
    const before = session.size;
    const events = await collect(followUp({ session, question: "x".repeat(500), model, signal: new AbortController().signal }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", error: { name: "SessionTooLongError" } });
    expect(requests).toHaveLength(1);
    expect(session.size).toBe(before);
    // A question that fits is still answered.
    const ok = await collect(followUp({ session, question: "short", model, signal: new AbortController().signal }));
    expect(ok.at(-1)?.type).toBe("done");
  });
});

describe("follow-up questions", () => {
  it("send the earlier turns, in order, ahead of the new question", async () => {
    const { model, requests } = fakeModel(["first answer", "second answer", "third answer"]);
    const session = new Session();
    await firstExplanation(session, model);
    await collect(followUp({ session, question: "why 1?", model, signal: new AbortController().signal }));
    await collect(followUp({ session, question: "and then?", model, signal: new AbortController().signal }));

    const third = requests[2]!;
    expect(third.user).toBe("and then?");
    expect(third.history?.map((m) => [m.role, m.role === "assistant" ? m.content : m.content.includes("export const x = 1;") ? "excerpt" : m.content])).toEqual([
      ["user", "excerpt"],
      ["assistant", "first answer"],
      ["user", "why 1?"],
      ["assistant", "second answer"],
    ]);
    expect(third.system).toBe(requests[0]!.system);
    expect(third.model).toBe("m");
  });

  it("leave no trace of a cancelled or failed turn", async () => {
    const { model, requests } = fakeModel(["first answer", "after"]);
    const session = new Session();
    await firstExplanation(session, model);
    const aborted = new AbortController();
    aborted.abort();
    const failing: LanguageModel = { async *stream() { throw new Error("boom"); } };
    const events = await collect(followUp({ session, question: "lost", model: failing, signal: new AbortController().signal }));
    expect(events.at(-1)?.type).toBe("error");
    await collect(followUp({ session, question: "kept", model, signal: new AbortController().signal }));
    expect(requests.at(-1)!.history?.map((m) => m.content).includes("lost")).toBe(false);
  });

  it("ends with a usage error when the Session has no first explanation yet", async () => {
    const { model } = fakeModel([]);
    const events = await collect(followUp({ session: new Session(), question: "hi", model, signal: new AbortController().signal }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
  });
});

describe("turns that carry a file the Sensitive-file rules normally exclude", () => {
  const explainEnv = async (session: Session, baseUrl: string, allowSensitive?: boolean) => {
    const dir = await mkdtemp(join(tmpdir(), "learn-session-"));
    const file = join(dir, ".env");
    await writeFile(file, "KEY=value\n");
    return await collect(explain({ reference: file, root: dir, settings: { baseUrl, model: "m" }, model: fakeModel(["ok"]).model, signal: new AbortController().signal, session, allowSensitive }));
  };

  it("are marked when the first Excerpt was let through (local endpoint, or --allow-sensitive)", async () => {
    for (const [baseUrl, allow] of [["http://127.0.0.1:1/v1", false], ["https://api.example.com/v1", true]] as const) {
      const session = new Session();
      await explainEnv(session, baseUrl, allow);
      expect(session.turns.map((t) => t.sensitive)).toEqual([true]);
    }
  });

  it("are not marked for an ordinary file", async () => {
    const session = new Session();
    await firstExplanation(session, fakeModel(["ok"]).model);
    expect(session.turns.map((t) => t.sensitive)).toEqual([false]);
  });

  it("are marked per follow-up, so a note only warns while such a turn is still in the Session", async () => {
    const { model } = fakeModel(["a", "b", "c"]);
    const session = new Session();
    await firstExplanation(session, model);
    await collect(followUp({ session, question: "q2", model, signal: new AbortController().signal, sensitive: true }));
    await collect(followUp({ session, question: "q3", model, signal: new AbortController().signal }));
    expect(session.turns.map((t) => t.sensitive)).toEqual([false, true, false]);
  });
});

describe("an open Session (a chat started with no code)", () => {
  const settings = { baseUrl: "http://h/v1", model: "m", level: "beginner" as const };

  it("answers the first question with nothing before it, and that question becomes the pinned turn", async () => {
    const { model, requests } = fakeModel(["one", "two"]);
    const session = new Session();
    session.startEmpty(settings);
    expect(session.stats).toMatchObject({ model: "m", level: "beginner" });
    const first = await collect(followUp({ session, question: "what is a closure?", model, signal: new AbortController().signal }));
    expect(first.at(-1)?.type).toBe("done");
    expect(requests[0]).toMatchObject({ baseUrl: "http://h/v1", model: "m", user: "what is a closure?" });
    expect(requests[0]!.history).toEqual([]);
    expect(requests[0]!.system).toContain("Level: beginner");
    await collect(followUp({ session, question: "and a generator?", model, signal: new AbortController().signal }));
    expect(requests[1]!.history?.map((m) => m.content)).toEqual(["what is a closure?", "one"]);
    expect(session.turns.map((t) => t.number)).toEqual([1, 2]);
  });

  it("tells the model what to do for a general question and for attached code, without claiming that no code is attached", () => {
    const session = new Session();
    session.startEmpty(settings);
    const system = session.planFor("hi")!.request.system;
    expect(system).toMatch(/general question/i);
    expect(system).toMatch(/attached with @/i);
    // The first message may carry code (`explain @file`); a prompt that says otherwise made a 14b model answer "I can't tell".
    expect(system).not.toMatch(/no code has been attached|not been attached|nothing has been attached/i);
  });

  it("keeps its first turn when the cap forces older turns out", async () => {
    const { model, requests } = fakeModel(["a".repeat(40), "b".repeat(40), "c".repeat(40)]);
    const session = new Session(200);
    session.startEmpty(settings);
    for (const q of ["first", "second", "third"]) await collect(followUp({ session, question: q, model, signal: new AbortController().signal }));
    expect(requests[2]!.history?.[0]?.content).toBe("first");
    expect(session.turns[0]?.number).toBe(1);
  });

  it("has no turns to save or quiz on until something has been asked", () => {
    const session = new Session();
    session.startEmpty(settings);
    expect(session.turns).toEqual([]);
  });
});

describe("clearing a Session (/clear)", () => {
  it("forgets every turn, the usage and what it was about, so the next question starts a fresh conversation with nothing before it", async () => {
    const { model, requests } = fakeModel(["first answer", "second answer", "fresh answer"]);
    const session = new Session();
    await firstExplanation(session, model);
    await collect(followUp({ session, question: "why 1?", model, signal: new AbortController().signal }));
    expect(session.turns).toHaveLength(2);
    session.clear();
    expect(session.turns).toEqual([]);
    expect(session.size).toBe(0);
    expect(session.stats.total).toEqual({ inputTokens: 0, outputTokens: 0, source: "reported" });
    expect(session.stats.last).toBeUndefined();
    expect(session.stats.reference).toBeUndefined();
    // The model and level the footer shows are still the Session's.
    expect(session.stats.model).toBe("m");
    const events = await collect(followUp({ session, question: "something new", model, signal: new AbortController().signal }));
    expect(events.at(-1)?.type).toBe("done");
    const sent = requests.at(-1)!;
    expect(sent.history).toEqual([]);
    expect(sent.user).toBe("something new");
    // The earlier code and answers are not sent again.
    expect(JSON.stringify(sent)).not.toContain("export const x = 1;");
    expect(JSON.stringify(sent)).not.toContain("first answer");
    expect(session.turns.map((t) => t.number)).toEqual([1]);
  });

  it("goes on with the same endpoint and model, and tells the model no code is pinned any more", async () => {
    const { model, requests } = fakeModel(["a", "b"]);
    const session = new Session();
    await firstExplanation(session, model);
    session.clear();
    await collect(followUp({ session, question: "hi", model, signal: new AbortController().signal }));
    expect(requests.at(-1)).toMatchObject({ baseUrl: "http://h/v1", model: "m" });
    expect(requests.at(-1)!.system).toMatch(/general question/i);
    // Clearing again does not stack the guidance.
    session.clear();
    session.clear();
    const plan = session.planFor("again")!;
    expect(plan.request.system.match(/This conversation may start/g)).toHaveLength(1);
  });

  it("is harmless on a Session that was never started", () => {
    const session = new Session();
    session.clear();
    expect(session.turns).toEqual([]);
    expect(session.planFor("hi")).toBeUndefined();
  });
});

