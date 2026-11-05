import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_COMMANDS } from "../src/cli/chat-commands.js";

const README = readFileSync(join(import.meta.dirname, "../README.md"), "utf8");
const START = "<!-- chat-commands:start";
const END = "<!-- chat-commands:end -->";

/** The README's table of chat commands, as it must read: every row from the command table. */
const expectedTable = (): string =>
  [
    "| Command | What it does |",
    "| --- | --- |",
    ...CHAT_COMMANDS.map((command) => `| \`${command.usage}${command.aliases.length > 0 ? ` (or ${command.aliases.join(", ")})` : ""}\` | ${command.help} |`),
  ].join("\n");

describe("README.md", () => {
  it("has its table of chat commands between markers, and the table is exactly what the command table generates", () => {
    const start = README.indexOf(START);
    const end = README.indexOf(END);
    expect(start, "the start marker").toBeGreaterThan(-1);
    expect(end, "the end marker").toBeGreaterThan(start);
    const marker = README.slice(start, README.indexOf("\n", start));
    const between = README.slice(start + marker.length, end).trim();
    // On a mismatch the message holds the table to paste in.
    expect(between, `the README's chat commands drifted from src/cli/chat-commands.ts; the table should be:\n${expectedTable()}`).toBe(expectedTable());
  });

  it("does not describe a prompt that no longer exists", () => {
    expect(README).not.toContain("learn>");
  });

  it("documents --usage and the footer", () => {
    expect(README).toContain("`--usage`");
    expect(README).toContain("### The footer");
  });
});
