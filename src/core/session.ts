import { CancelledError, ContextTooLongError, LearnError, ProviderError, UsageError } from "./errors.js";
import type { ExplainEvent, LanguageModel, Message, ModelRequest } from "./types.js";

/**
 * One conversation: the first explanation plus its follow-up questions, kept in memory only.
 * A turn is added only once its answer is complete, so a cancelled or failed turn leaves nothing behind.
 */
export class Session {
  /**
   * @param capChars a hard limit on the transcript (earlier turns plus the new question). Until ticket 34 trims old turns
   * instead, a question that would pass it is refused. Default: no limit.
   */
  constructor(readonly capChars: number = Number.POSITIVE_INFINITY) {}

  #first: ModelRequest | undefined;
  #messages: Message[] = [];

  /** Records the first explanation's request and answer. Called by `explain`. */
  begin(request: ModelRequest, answer: string): void {
    this.#first = request;
    this.#messages = [{ role: "user", content: request.user }, { role: "assistant", content: answer }];
  }

  /** Characters in the transcript so far. */
  get size(): number {
    return this.#messages.reduce((total, m) => total + m.content.length, 0);
  }

  /** The request for a follow-up question: the first request's endpoint, model and system prompt, with every earlier turn as history. */
  requestFor(question: string): ModelRequest | undefined {
    if (!this.#first) return undefined;
    const { baseUrl, model, system } = this.#first;
    return { baseUrl, model, system, history: [...this.#messages], user: question };
  }

  /** Records a finished follow-up turn. */
  record(question: string, answer: string): void {
    this.#messages.push({ role: "user", content: question }, { role: "assistant", content: answer });
  }
}

/** Asks a follow-up question in a Session. Emits the same text and error events as `explain`, without a Context report. */
export async function* followUp(input: {
  session: Session;
  question: string;
  model: LanguageModel;
  signal: AbortSignal;
  /** Called with the exact request just before it is sent, as for `explain`. */
  onRequest?: (request: ModelRequest) => void;
}): AsyncGenerator<ExplainEvent> {
  const request = input.session.requestFor(input.question);
  if (!request) {
    yield { type: "error", error: new UsageError("there is no explanation yet to ask follow-up questions about") };
    return;
  }
  const total = input.session.size + input.question.length;
  if (total > input.session.capChars) {
    yield { type: "error", error: new ContextTooLongError(`this Session is too long to continue (${total.toLocaleString("en-US")} of ${input.session.capChars.toLocaleString("en-US")} characters); end it and start a new one`) };
    return;
  }
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
  input.session.record(input.question, answer);
  yield { type: "done" };
}
