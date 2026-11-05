import { QUIZ_LENGTH } from "../core/index.js";

/** A line that opens a pasted block, and the line that closes it. Code can contain `"""` or a trailing backslash, so neither is used. */
export const BLOCK_OPEN = "<<<";
export const BLOCK_CLOSE = ">>>";

/** One command typed at the chat prompt. This is data only: what the chat does for each is in `chat.ts`, keyed by `name`. */
export interface ChatCommand {
  name: `/${string}`;
  /** Other spellings of the same command. */
  aliases: readonly `/${string}`[];
  /** How it is typed, starting with the name: `/save [name]`. */
  usage: string;
  /** One line saying what it does. */
  help: string;
  /** Whether it can be followed by words. One that cannot, typed with words after it, is an ordinary question for the model. */
  takesArgs: boolean;
}

/**
 * The one place the chat's commands are defined. `/help`, the "is not a command" message and the "Chat commands" section
 * of `learn --help` are all generated from this table, so none of them can disagree with it. The order is the order shown.
 */
export const CHAT_COMMANDS = [
  { name: "/save", aliases: [], usage: "/save [name]", help: "write this Session as a note", takesArgs: true },
  { name: "/glossary", aliases: [], usage: "/glossary term: meaning", help: "add a glossary entry", takesArgs: true },
  {
    name: "/quiz",
    aliases: [],
    usage: "/quiz",
    help: `ask ${QUIZ_LENGTH} questions about this Session (answer in your own words; /skip passes, /quit stops; nothing is scored or stored)`,
    takesArgs: false,
  },
  { name: "/clear", aliases: [], usage: "/clear", help: "clear the screen and start a fresh chat (notes you saved stay)", takesArgs: false },
  { name: "/help", aliases: [], usage: "/help", help: "show this help", takesArgs: false },
  { name: "/exit", aliases: ["/quit"], usage: "/exit", help: "end the chat (Ctrl-D or Ctrl-C at the prompt does too)", takesArgs: false },
] as const satisfies readonly ChatCommand[];

export type ChatCommandName = (typeof CHAT_COMMANDS)[number]["name"];

/** `/exit (or /quit)`: the usage line with the other spellings. */
const label = (command: ChatCommand): string => (command.aliases.length > 0 ? `${command.usage} (or ${command.aliases.join(", ")})` : command.usage);

/** The "Chat commands" section: a heading, then one aligned line per command. */
export function chatCommandsSection(commands: readonly ChatCommand[] = CHAT_COMMANDS): string {
  const width = Math.max(...commands.map((command) => label(command).length)) + 2;
  return ["Chat commands:", ...commands.map((command) => `  ${label(command).padEnd(width)}${command.help}`)].join("\n");
}

/** The command a spelling stands for (a name or an alias), or undefined when the table has none. */
export const findChatCommand = (spelling: string): (typeof CHAT_COMMANDS)[number] | undefined =>
  CHAT_COMMANDS.find((command) => command.name === spelling || (command.aliases as readonly string[]).includes(spelling));

/** What the chat prints when it opens and for `/help`: how to type, the commands, and what Ctrl-C does while an answer streams. */
export function chatHelpText(): string {
  return [
    `Type a question and press Enter. To paste code or several lines, type ${BLOCK_OPEN} on a line of its own, paste, then type ${BLOCK_CLOSE} on a line of its own.`,
    chatCommandsSection(),
    "Ctrl-C while an answer is streaming cancels just that answer.",
  ].join("\n");
}

/** The reply to `/word` when the table has no such command. `typed` is only ever `/` and lower-case letters, so it is safe to show. */
export const unknownCommandMessage = (typed: string, commands: readonly ChatCommand[] = CHAT_COMMANDS): string =>
  `${typed} is not a command (commands: ${commands.map((command) => command.name).join(", ")}; /help shows what each does)`;
