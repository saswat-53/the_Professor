import type { ModelRequest, TurnUsage } from "./types.js";

/** Characters per token, the rule of thumb used wherever an endpoint reports no usage. Rough on purpose: any figure built on it is marked estimated. */
const CHARS_PER_TOKEN = 4;

/** Tokens in `chars` characters of text, rounded up. */
export const estimateTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

/** Everything a request sends: the system prompt, the earlier turns and the new message. */
const requestChars = (request: ModelRequest): number =>
  request.system.length + request.user.length + (request.history ?? []).reduce((total, m) => total + m.content.length, 0);

/**
 * The tokens one turn used. A figure the endpoint reported is kept; a missing one is estimated from the text, and a
 * turn with any estimated figure is marked `estimated`, never `reported`.
 */
export function turnUsage(request: ModelRequest, answer: string, reported: { inputTokens?: number; outputTokens?: number } = {}): TurnUsage {
  const inputTokens = reported.inputTokens ?? estimateTokens(requestChars(request));
  const outputTokens = reported.outputTokens ?? estimateTokens(answer.length);
  const complete = reported.inputTokens !== undefined && reported.outputTokens !== undefined;
  return { inputTokens, outputTokens, source: complete ? "reported" : "estimated" };
}
