import type { TurnUsage } from "../core/index.js";
import { createEscapeStripper } from "./escape-stripper.js";

/** A token count for a glance: exact under a thousand, then thousands to one decimal (`1.2k`, `12k`). */
export const shortCount = (n: number): string => (n < 1000 ? String(n) : `${Math.round(n / 100) / 10}k`);

/**
 * The one line `--usage` prints after a one-shot explanation: `in 1.2k · out 340 · <model>`, with `~` before a figure
 * that was estimated, not reported. The model name is the user's own setting but not otherwise checked, so terminal
 * escapes are stripped from it and it is kept to one line.
 */
export function formatUsageLine(usage: TurnUsage, model: string): string {
  const mark = usage.source === "estimated" ? "~" : "";
  const name = createEscapeStripper()(model).replace(/\s+/g, " ").trim();
  return `in ${mark}${shortCount(usage.inputTokens)} · out ${mark}${shortCount(usage.outputTokens)} · ${name}`;
}
