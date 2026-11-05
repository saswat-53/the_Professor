import teachingPrompt from "./prompt/teaching-prompt.md";

export const LEVELS = ["beginner", "intermediate", "expert"] as const;
export type Level = (typeof LEVELS)[number];
export const DEFAULT_LEVEL: Level = "intermediate";

const LEVEL_GUIDANCE: Record<Level, string> = {
  beginner:
    "Level: beginner. Assume little background. Define terms, explain each step slowly, and use small analogies. Do not skip over syntax.",
  intermediate:
    "Level: intermediate. Assume the learner knows the language and common tools but not this codebase or its patterns. Explain the non-obvious parts.",
  expert:
    "Level: expert. Assume deep familiarity. Skip basics; focus on trade-offs, subtle behaviour, edge cases and the reasoning behind unusual choices.",
};

export function isLevel(value: string): value is Level {
  return (LEVELS as readonly string[]).includes(value);
}

/**
 * For a chat that starts with no code. It must not claim that no code is attached: the first message may carry some (`explain @file`), and a model that
 * believes the claim answers "I can't tell" (seen with qwen2.5-coder:14b). It says what to do for each kind of message instead.
 */
const OPEN_CHAT_GUIDANCE =
  "This conversation may start with a general question or with code. If a message includes code (a fenced block, or files attached with @), explain it in the structure above. If it is a general question with no code, answer it directly and briefly, without the four headings.";

/** `system` with the open-chat guidance added (once: a prompt that has it is returned as it is). */
export function withOpenChatGuidance(system: string): string {
  return system.includes(OPEN_CHAT_GUIDANCE) ? system : `${system}\n${OPEN_CHAT_GUIDANCE}\n`;
}

export function buildSystemPrompt(level: Level, { open = false }: { open?: boolean } = {}): string {
  const system = `${teachingPrompt.trimEnd()}\n\n${LEVEL_GUIDANCE[level]}\n`;
  return open ? withOpenChatGuidance(system) : system;
}

/** Wraps code in a backtick fence longer than any backtick run inside it, so the code cannot close the fence early. */
export function fenceCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
}
