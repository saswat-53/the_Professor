import { CancelledError, LearnError, ProviderError, SessionTooLongError, UsageError } from "./errors.js";
import type { ExplainEvent, LanguageModel, Message, ModelRequest } from "./types.js";

/** One finished question and answer. `number` counts from 1 (the first explanation) and never changes, so a report can name it after earlier turns were dropped. */
interface Turn {
  number: number;
  user: string;
  assistant: string;
  /** The `@file` references attached to the question, as typed (`path` or `path:N-M`). */
  files: string[];
}

const sizeOf = (t: Turn) => t.user.length + t.assistant.length;

/** What a request leaves out of the Session to fit the cap. */
export interface DroppedTurns {
  turns: number[];
  files: string[];
}

/**
 * One conversation: the first explanation plus its follow-up questions, kept in memory only.
 * A turn is added only once its answer is complete, so a cancelled or failed turn leaves nothing behind.
 *
 * The first turn is pinned: the first Excerpt, its Context and the first explanation are never dropped.
 * When a new question would push the transcript over the cap, the oldest follow-up turns are dropped, a
 * question and its answer together, until it fits. Dropping is only applied when the new turn is recorded.
 */
export class Session {
  /** @param capChars the most characters the transcript may hold, counting the new question. Default: no cap. */
  constructor(readonly capChars: number = Number.POSITIVE_INFINITY) {}

  #first: ModelRequest | undefined;
  #turns: Turn[] = [];
  #count = 0;

  /** Records the first explanation's request and answer. Called by `explain`. */
  begin(request: ModelRequest, answer: string): void {
    this.#first = request;
    this.#count = 1;
    this.#turns = [{ number: 1, user: request.user, assistant: answer, files: [] }];
  }

  /** Characters in the transcript so far. */
  get size(): number {
    return this.#turns.reduce((total, t) => total + sizeOf(t), 0);
  }

  /**
   * Throws unless the pinned part, plus `extra` characters not yet in it (the first answer, before it exists),
   * fits the cap, so a Session cannot start in a state where no question could ever be asked.
   */
  assertPinnedFits(extra = 0): void {
    const pinned = (this.#turns[0] ? sizeOf(this.#turns[0]) : 0) + extra;
    if (pinned > this.capChars) {
      throw new SessionTooLongError(
        `the first Excerpt, its Context and the explanation come to ${pinned.toLocaleString("en-US")} characters, over the Session cap of ${this.capChars.toLocaleString("en-US")}, so the chat could not continue`,
      );
    }
  }

  /** How many follow-up turns, oldest first, must go for a question of `length` characters to fit, and whether it then does. */
  #plan(length: number): { drop: number; total: number } {
    let total = this.size + length;
    let drop = 0;
    while (total > this.capChars && 1 + drop < this.#turns.length) total -= sizeOf(this.#turns[1 + drop++]!);
    return { drop, total };
  }

  /**
   * The request for a follow-up question: the first request's endpoint, model and system prompt, with the turns
   * that fit as history. `dropped` names what was left out; `total` is the transcript's size with the question.
   */
  planFor(question: string): { request: ModelRequest; dropped?: DroppedTurns; total: number } | undefined {
    if (!this.#first) return undefined;
    const { baseUrl, model, system } = this.#first;
    const { drop, total } = this.#plan(question.length);
    const left = this.#turns.slice(1, 1 + drop);
    const kept = [this.#turns[0]!, ...this.#turns.slice(1 + drop)];
    const history = kept.flatMap((t): Message[] => [{ role: "user", content: t.user }, { role: "assistant", content: t.assistant }]);
    return {
      request: { baseUrl, model, system, history, user: question },
      ...(drop > 0 && { dropped: { turns: left.map((t) => t.number), files: left.flatMap((t) => t.files) } }),
      total,
    };
  }

  /** Records a finished follow-up turn, dropping the turns the same question made room for. */
  record(question: string, answer: string, files: string[] = []): void {
    this.#turns.splice(1, this.#plan(question.length).drop);
    this.#turns.push({ number: ++this.#count, user: question, assistant: answer, files });
  }
}

/** Asks a follow-up question in a Session. Emits the same text and error events as `explain`; its only Context report says which old turns were dropped. */
export async function* followUp(input: {
  session: Session;
  question: string;
  /** The `@file` references attached to the question, remembered so a report can name them if their turn is later dropped. */
  files?: string[];
  model: LanguageModel;
  signal: AbortSignal;
  /** Called with the exact request just before it is sent, as for `explain`. */
  onRequest?: (request: ModelRequest) => void;
}): AsyncGenerator<ExplainEvent> {
  const plan = input.session.planFor(input.question);
  if (!plan) {
    yield { type: "error", error: new UsageError("there is no explanation yet to ask follow-up questions about") };
    return;
  }
  const cap = input.session.capChars;
  if (plan.total > cap) {
    yield {
      type: "error",
      error: new SessionTooLongError(
        `this message is too long to send: with the first explanation it comes to ${plan.total.toLocaleString("en-US")} of the Session's ${cap.toLocaleString("en-US")} characters even with every earlier follow-up dropped; shorten it or attach less`,
      ),
    };
    return;
  }
  if (plan.dropped) yield { type: "context-report", report: { kind: "session-trimmed", ...plan.dropped, capChars: cap } };
  const { request } = plan;
  input.onRequest?.(request);
  let answer = "";
  try {
    for await (const text of input.model.stream(request, input.signal)) {
      if (input.signal.aborted) break;
      answer += text;
      yield { type: "text-delta", text };
    }
    if (input.signal.aborted) {
      yield { type: "error", error: new CancelledError() };
      return;
    }
  } catch (err) {
    yield { type: "error", error: input.signal.aborted ? new CancelledError() : err instanceof LearnError ? err : new ProviderError("the model provider returned an error that learn could not classify") };
    return;
  }
  input.session.record(input.question, answer, input.files);
  yield { type: "done" };
}
