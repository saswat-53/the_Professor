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

export function buildSystemPrompt(level: Level): string {
  return `${teachingPrompt.trimEnd()}\n\n${LEVEL_GUIDANCE[level]}\n`;
}

/** Wraps code in a backtick fence longer than any backtick run inside it, so the code cannot close the fence early. */
export function fenceCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
}
