import { QUIZ_LENGTH } from "../core/index.js";

/** One command typed at the chat prompt. This is data only: what the chat does for each is in `chat.ts`, keyed by `name`. */
export interface ChatCommand {
  name: `/${string}`;
  /** Other spellings of the same command. */
  aliases: readonly `/${string}`[];
  /** How it is typed, starting with the name: `/save [name]`. */
  usage: string;
  /** One line saying what it does. */
  help: string;
}

/**
 * The one place the chat's commands are defined. `/help`, the "is not a command" message and the "Chat commands" section
 * of `learn --help` are all generated from this table, so none of them can disagree with it. The order is the order shown.
 */
export const CHAT_COMMANDS = [
  { name: "/save", aliases: [], usage: "/save [name]", help: "write this Session as a note" },
  { name: "/glossary", aliases: [], usage: "/glossary term: meaning", help: "add a glossary entry" },
  {
    name: "/quiz",
    aliases: [],
    usage: "/quiz",
    help: `ask ${QUIZ_LENGTH} questions about this Session (answer in your own words; /skip passes, /quit stops; nothing is scored or stored)`,
  },
  { name: "/help", aliases: [], usage: "/help", help: "show this help" },
  { name: "/exit", aliases: ["/quit"], usage: "/exit", help: "end the chat (Ctrl-D or Ctrl-C at the prompt does too)" },
] as const satisfies readonly ChatCommand[];

export type ChatCommandName = (typeof CHAT_COMMANDS)[number]["name"];

/** `/exit (or /quit)`: the usage line with the other spellings. */
const label = (command: ChatCommand): string => (command.aliases.length > 0 ? `${command.usage} (or ${command.aliases.join(", ")})` : command.usage);

/** The "Chat commands" section: a heading, then one aligned line per command. */
export function chatCommandsSection(commands: readonly ChatCommand[] = CHAT_COMMANDS): string {
  const width = Math.max(...commands.map((command) => label(command).length)) + 2;
  return ["Chat commands:", ...commands.map((command) => `  ${label(command).padEnd(width)}${command.help}`)].join("\n");
}
