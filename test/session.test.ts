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
      yield answers[requests.length - 1] ?? "";
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
