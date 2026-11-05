import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { runChat } from "../src/cli/chat.js";
import { CHAT_COMMANDS, chatCommandsSection, chatHelpText, type ChatCommandName } from "../src/cli/chat-commands.js";
import { explain, Session } from "../src/core/index.js";
import type { LanguageModel } from "../src/core/index.js";

describe("the chat command table", () => {
  it("lists the commands the chat accepts, in the order they are shown", () => {
    expect(CHAT_COMMANDS.map((c) => c.name)).toEqual(["/save", "/glossary", "/quiz", "/clear", "/help", "/exit"]);
  });

  it("gives every command a usage line that starts with its name, and some help text, none of them blank", () => {
    for (const command of CHAT_COMMANDS) {
      expect(command.usage.trim(), command.name).not.toBe("");
      expect(command.usage.startsWith(command.name), command.name).toBe(true);
      expect(command.help.trim(), command.name).not.toBe("");
    }
  });

  it("has each name and alias once, written as a slash and lower-case letters", () => {
    const spellings = CHAT_COMMANDS.flatMap((c) => [c.name, ...c.aliases]);
    expect(new Set(spellings).size).toBe(spellings.length);
    for (const spelling of spellings) expect(spelling).toMatch(/^\/[a-z]+$/);
  });

  it("generates the Chat commands section exactly, from the table", () => {
    expect(chatCommandsSection()).toBe(
      [
        "Chat commands:",
        "  /save [name]             write this Session as a note",
        "  /glossary term: meaning  add a glossary entry",
        "  /quiz                    ask 5 questions about this Session (answer in your own words; /skip passes, /quit stops; nothing is scored or stored)",
        "  /clear                   clear the screen and start a fresh chat (notes you saved stay)",
        "  /help                    show this help",
        "  /exit (or /quit)         end the chat (Ctrl-D or Ctrl-C at the prompt does too)",
      ].join("\n"),
    );
  });
});

describe("the chat's help text", () => {
  it("says how to paste several lines, lists the commands, and says what Ctrl-C does while an answer streams", () => {
    const help = chatHelpText();
    expect(help).toContain("type <<< on a line of its own, paste, then type >>> on a line of its own");
    expect(help).toContain(chatCommandsSection());
    expect(help).toContain("Ctrl-C while an answer is streaming cancels just that answer.");
    // Ctrl-D and Ctrl-C at the prompt leave the chat: said on the line for /exit.
    expect(help).toContain("(Ctrl-D or Ctrl-C at the prompt does too)");
  });
});

/** What happened when a chat was given one line at its prompt. */
interface Run {
  reports: string[];
  output: string;
  saved: (string | undefined)[];
  glossaryEntries: [string, string][];
  /** Requests the model was sent after the first explanation. */
  asked: number;
  /** The chat's exit code, once it ended. */
  code: number;
  /** How many turns the Session held when the chat ended. */
  turns: number;
  /** How many times the chat asked the frontend to clear the screen. */
  cleared: number;
}

/** Runs the real chat, in memory, on a Session that already holds one explanation, and types `line`, then ends the input. */
async function typeAtPrompt(line: string): Promise<Run> {
  let asked = 0;
  const model: LanguageModel = { async *stream() { asked++; yield { type: "text", text: "an answer" }; } };
  const dir = await mkdtemp(join(tmpdir(), "learn-commands-"));
  await writeFile(join(dir, "a.ts"), "export const x = 1;\n");
  const session = new Session();
  for await (const _ of explain({ reference: join(dir, "a.ts"), root: tmpdir(), settings: { baseUrl: "http://h/v1", model: "m" }, model, signal: new AbortController().signal, session })) void _;
  asked = 0;
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => (text += chunk));
  const run: Run = { reports: [], output: "", saved: [], glossaryEntries: [], asked: 0, code: -1, turns: -1, cleared: 0 };
  const done = runChat({
    input,
    output,
    session,
    model,
    stripper: () => (t) => t,
    report: (_kind, t) => void run.reports.push(t),
    describe: String,
    attach: async (question) => ({ content: question, files: [], reports: [], notes: [] }),
    takeSignals: () => {},
    save: async (name) => (run.saved.push(name), "note.md"),
    glossary: async (term, definition) => (run.glossaryEntries.push([term, definition]), "glossary.md"),
    onClear: () => void (run.cleared += 1),
  });
  input.write(`${line}\n`);
  input.end();
  run.code = await done;
  run.output = text;
  run.asked = asked;
  run.turns = session.turns.length;
  return run;
}

describe("every command in the table works at the chat prompt", () => {
  /**
   * What typing the command's own usage line must do. Typed by the table's names, so a command added to the table makes this
   * stop compiling until someone says what it is for, and a command here that the table lacks does not compile either.
   */
  const effects = {
    "/save": (run) => expect(run.saved).toEqual(["[name]"]),
    "/glossary": (run) => expect(run.glossaryEntries).toEqual([["term", " meaning"]]),
    "/quiz": (run) => expect(run.asked, "the quiz asks the model for its questions").toBe(1),
    "/clear": (run) => {
      expect(run.turns, "the Session is emptied (it held one explanation)").toBe(0);
      expect(run.cleared, "the screen is cleared").toBe(1);
      expect(run.asked, "nothing is sent to the model").toBe(0);
    },
    // Once when the chat opens and once for /help.
    "/help": (run) => expect(run.output.match(/Chat commands:/g)).toHaveLength(2),
    "/exit": (run) => expect(run.asked).toBe(0),
  } satisfies Record<ChatCommandName, (run: Run) => void>;

  it.each(CHAT_COMMANDS.map((command) => [command.name, command.usage] as const))("%s: its usage line, typed as shown, is recognised and does its job", async (name, usage) => {
    const run = await typeAtPrompt(usage);
    expect(run.reports.join("\n"), usage).not.toContain("is not a command");
    expect(run.code, usage).toBe(0);
    effects[name](run);
  });

  it.each(CHAT_COMMANDS.flatMap((command) => command.aliases.map((alias) => [alias, command.name] as const)))("%s, an alias of %s, is recognised", async (alias) => {
    const run = await typeAtPrompt(alias);
    expect(run.reports.join("\n"), alias).not.toContain("is not a command");
    expect(run.code, alias).toBe(0);
    expect(run.asked, alias).toBe(0);
  });

  it("says a word that is not in the table is not a command, naming every command that is", async () => {
    const run = await typeAtPrompt("/zzz");
    expect(run.reports).toEqual([`/zzz is not a command (commands: ${CHAT_COMMANDS.map((c) => c.name).join(", ")}; /help shows what each does)`]);
    expect(run.asked).toBe(0);
  });
});

