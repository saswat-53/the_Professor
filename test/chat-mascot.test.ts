import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { runChat } from "../src/cli/chat.js";
import type { ChatOptions } from "../src/cli/chat.js";
import type { Mood } from "../src/cli/mascot/animator.js";
import { explain, Session } from "../src/core/index.js";
import type { LanguageModel } from "../src/core/index.js";

const quiet: LanguageModel = { async *stream() { yield "an answer"; } };

/** A Session that already holds one explanation, which is what a chat follows up on. */
async function started() {
  const dir = await mkdtemp(join(tmpdir(), "learn-mascot-"));
  await writeFile(join(dir, "a.ts"), "export const x = 1;\n");
  const session = new Session();
  for await (const _ of explain({ reference: join(dir, "a.ts"), root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model: quiet, signal: new AbortController().signal, session })) void _;
  return session;
}

/** Runs a chat that reads `lines`, then ends; returns the moods the owl was asked for, in order. */
async function moodsFor(lines: string[], overrides: Partial<ChatOptions> = {}, model?: LanguageModel) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const moods: Mood[] = [];
  const done = runChat({
    input,
    output,
    session: await started(),
    model: model ?? quiet,
    stripper: () => (text) => text,
    report: () => {},
    describe: String,
    attach: async (question) => ({ content: question, files: [], reports: [], notes: [] }),
    takeSignals: () => {},
    save: async () => "note.md",
    glossary: async () => "glossary.md",
    mascot: { mood: (m) => void moods.push(m) },
    ...overrides,
  });
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  await done;
  return moods;
}

/** The moods with immediate repeats collapsed, which is what the owl sees (repeating a mood does nothing). */
const distinct = (moods: Mood[]) => moods.filter((m, i) => m !== moods[i - 1]);

describe("chat tells the owl what it is doing", () => {
  it("thinks while waiting for a question's answer, speaks while it streams, then rests", async () => {
    expect(distinct(await moodsFor(["what is this?"]))).toEqual(["thinking", "speaking", "idle"]);
  });

  it("writes while saving and while adding a glossary entry", async () => {
    expect(distinct(await moodsFor(["/save"]))).toEqual(["saving"]);
    expect(distinct(await moodsFor(["/glossary term: meaning"]))).toEqual(["saving"]);
  });

  it("is startled when a save fails", async () => {
    const moods = await moodsFor(["/save"], {
      save: async () => {
        throw new Error("disk full");
      },
    });
    expect(distinct(moods)).toEqual(["saving", "startled"]);
  });

  it("is startled when the model fails, and when a message cannot be attached", async () => {
    const failing: LanguageModel = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error("boom");
      },
    };
    expect(distinct(await moodsFor(["hello"], {}, failing))).toEqual(["thinking", "startled"]);
    const moods = await moodsFor(["@nope"], {
      attach: async () => {
        throw new Error("no such file");
      },
    });
    expect(moods).toEqual(["startled"]);
  });

  it("works without an owl", async () => {
    await expect(moodsFor(["hi"], { mascot: undefined })).resolves.toEqual([]);
  });
});
