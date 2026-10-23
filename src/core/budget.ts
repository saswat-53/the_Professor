import { ContextTooLongError, UsageError } from "./errors.js";
import type { Excerpt } from "./reference.js";
import { isLocalHost } from "./sensitive.js";

/** Characters of Excerpt plus Context sent to a hosted endpoint, and to a local one (small models, small windows). */
export const HOSTED_BUDGET = 24_000;
export const LOCAL_BUDGET = 8_000;

export const defaultBudget = (baseUrl: string) => (isLocalHost(baseUrl) ? LOCAL_BUDGET : HOSTED_BUDGET);

/** The Excerpt is never trimmed, so one that leaves no room for Context is refused instead. */
export function assertExcerptFits(excerpt: Excerpt, budget: number): void {
  if (!Number.isInteger(budget) || budget <= 0) throw new UsageError(`the context budget must be a whole number of characters above 0, got ${budget}`);
  if (excerpt.text.length > budget / 2) {
    throw new ContextTooLongError(
      `the Excerpt is ${excerpt.text.length} characters, over half of the ${budget}-character budget; narrow your range (for example file:40-60)`,
    );
  }
}
