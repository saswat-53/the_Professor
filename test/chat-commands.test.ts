import { describe, expect, it } from "vitest";
import { CHAT_COMMANDS, chatCommandsSection } from "../src/cli/chat-commands.js";

describe("the chat command table", () => {
  it("lists the commands the chat accepts, in the order they are shown", () => {
    expect(CHAT_COMMANDS.map((c) => c.name)).toEqual(["/save", "/glossary", "/quiz", "/help", "/exit"]);
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
        "  /help                    show this help",
        "  /exit (or /quit)         end the chat (Ctrl-D or Ctrl-C at the prompt does too)",
      ].join("\n"),
    );
  });
});
