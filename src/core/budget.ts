import { ContextTooLongError, UsageError } from "./errors.js";
import type { Excerpt } from "./reference.js";
import { isLocalHost } from "./sensitive.js";

/**
 * The Budget counts code only: the Excerpt's text, and each Context line plus its newline. The fixed
 * prompt text (labels, fences, the system prompt) is extra. Length is JavaScript string length, so an
 * emoji counts as 2; it is an estimate of size, not a token count.
 */
export const HOSTED_BUDGET = 24_000;
export const LOCAL_BUDGET = 8_000;

/** Where a budget came from, so a refusal can say which limit the user hit. */
export type BudgetSource = "hosted default" | "local default" | "setting";
export interface Budget {
  chars: number;
  source: BudgetSource;
}

export function resolveBudget(baseUrl: string, setting?: number): Budget {
  if (setting !== undefined) return { chars: setting, source: "setting" };
  return isLocalHost(baseUrl) ? { chars: LOCAL_BUDGET, source: "local default" } : { chars: HOSTED_BUDGET, source: "hosted default" };
}

export const defaultBudget = (baseUrl: string) => resolveBudget(baseUrl).chars;

/** The Excerpt is never trimmed, so one that leaves no room for Context is refused instead. */
export function assertExcerptFits(excerpt: Excerpt, { chars, source }: Budget): void {
  if (!Number.isInteger(chars) || chars <= 0) throw new UsageError(`the context budget must be a whole number of characters above 0, got ${chars}`);
  if (excerpt.text.length > chars / 2) {
    throw new ContextTooLongError(
      `the Excerpt is ${excerpt.text.length} characters, over half of the ${chars.toLocaleString("en-US")}-character budget (${source}); narrow your range (for example file:40-60)`,
    );
  }
}
