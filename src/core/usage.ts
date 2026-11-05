import { CancelledError } from "./errors.js";
import type { ExplainEvent, ModelRequest, TurnUsage } from "./types.js";

/** The part of a Session that usage is recorded into (kept narrow so this module does not depend on the Session class). */
interface UsageSink {
  recordUsage(usage: TurnUsage): void;
}

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

/**
 * The events that end a cancelled turn. The request was sent, so the tokens it spent are counted, as an estimate
 * from the text that arrived (a cancelled stream reports nothing); then the cancelled error. Nothing is added to the transcript.
 */
export function* cancelled(sink: UsageSink | undefined, request: ModelRequest, answer: string): Generator<ExplainEvent> {
  const usage = turnUsage(request, answer);
  sink?.recordUsage(usage);
  yield { type: "usage", usage };
  yield { type: "error", error: new CancelledError() };
}
