import { DEFAULT_CONTEXT_WINDOW } from "./budget.js";
import { LearnError, ProviderError, SessionTooLongError, UsageError } from "./errors.js";
import { DEFAULT_LEVEL, buildSystemPrompt, withOpenChatGuidance } from "./prompt.js";
import type { Level } from "./prompt.js";
import { resolveEndpoint } from "./sensitive.js";
import type { ExplainEvent, LanguageModel, Message, ModelRequest, Settings, TurnUsage } from "./types.js";
import { cancelled, turnUsage } from "./usage.js";

/** One finished question and answer. `number` counts from 1 (the first explanation) and never changes, so a report can name it after earlier turns were dropped. */
interface Turn {
  number: number;
  user: string;
  assistant: string;
  /** The `@file` references attached to the question, as typed (`path` or `path:N-M`). */
  files: string[];
  /** The turn carries a file the Sensitive-file rules normally exclude, let through by `--allow-sensitive` or a local endpoint. */
  sensitive: boolean;
}

const sizeOf = (t: Turn) => t.user.length + t.assistant.length;

/** What the Session has used so far: the last turn on its own, and every turn added up. A turn with any estimated figure makes the total estimated. */
export interface SessionStats {
  last?: TurnUsage;
  total: TurnUsage;
  /** What a footer needs besides usage; all absent until the first explanation has been described (see `Session.describe`). */
  model?: string;
  level?: Level;
  /** What the latest question is about: a project-relative `file:range`, `stdin`, `clipboard` or `diff`. Never an absolute path. */
  reference?: string;
  /** The model's context window in tokens; only for a local endpoint, where it is a real setting. */
  contextWindow?: number;
}

/** What `explain` tells the Session about itself once the first explanation is done. */
export interface SessionInfo {
  model: string;
  level: Level;
  reference?: string;
  contextWindow?: number;
}

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

  #info: SessionInfo | undefined;
  #last: TurnUsage | undefined;
  #total: TurnUsage = { inputTokens: 0, outputTokens: 0, source: "reported" };
  #first: ModelRequest | undefined;
  /** Where an open Session sends its questions: the endpoint, model and system prompt a first request would have carried. */
  #open: Pick<ModelRequest, "baseUrl" | "model" | "system"> | undefined;
  #turns: Turn[] = [];
  #count = 0;

  /** Records the first explanation's request and answer. Called by `explain`. */
  begin(request: ModelRequest, answer: string, sensitive = false): void {
    this.#first = request;
    this.#count = 1;
    this.#turns = [{ number: 1, user: request.user, assistant: answer, files: [], sensitive }];
  }

  /**
   * Starts the Session with no code and no first turn (a chat opened bare). Nothing is sent; the first question
   * asked becomes turn 1 and is the pinned one, so trimming still never drops it.
   */
  startEmpty(settings: Settings): void {
    const level = settings.level ?? DEFAULT_LEVEL;
    this.#open = { baseUrl: settings.baseUrl, model: settings.model, system: buildSystemPrompt(level, { open: true }) };
    this.describe({
      model: settings.model,
      level,
      // A context window is a real setting only for a local endpoint (as in `explain`).
      ...(resolveEndpoint(settings.baseUrl).local && { contextWindow: settings.contextWindow ?? DEFAULT_CONTEXT_WINDOW }),
    });
  }

  /**
   * Starts over (`/clear`): every turn, the usage and what the Session was about are forgotten, so the next question is turn 1 of a fresh
   * conversation and nothing earlier is sent again. The endpoint, model and level stay, and the model is told, as in an open Session, that
   * it may be asked a general question or shown code.
   */
  clear(): void {
    const base = this.#first ?? this.#open;
    this.#open = base && { baseUrl: base.baseUrl, model: base.model, system: withOpenChatGuidance(base.system) };
    this.#first = undefined;
    this.#turns = [];
    this.#count = 0;
    this.#last = undefined;
    this.#total = { inputTokens: 0, outputTokens: 0, source: "reported" };
    if (this.#info) {
      const { reference: _forgotten, ...kept } = this.#info;
      this.#info = kept;
    }
  }

  /** The turns still held, oldest first, for `/save`. Turns dropped to fit the cap are not here. */
  get turns(): readonly { number: number; user: string; assistant: string; sensitive: boolean }[] {
    return this.#turns.map(({ number, user, assistant, sensitive }) => ({ number, user, assistant, sensitive }));
  }

  /** Adds one turn's usage to the stats. Called by `explain` and `followUp`. */
  recordUsage(usage: TurnUsage): void {
    this.#last = usage;
    this.#total = {
      inputTokens: this.#total.inputTokens + usage.inputTokens,
      outputTokens: this.#total.outputTokens + usage.outputTokens,
      source: this.#total.source === "estimated" || usage.source === "estimated" ? "estimated" : "reported",
    };
  }

  /** Records what the Session is about, for `stats`. Called by `explain`. */
  describe(info: SessionInfo): void {
    this.#info = { ...info };
  }

  /** The chat points the Session at new code (for example an `@file` reference): the footer follows the latest. */
  focus(reference: string): void {
    if (this.#info) this.#info = { ...this.#info, reference };
  }

  /** A snapshot of the Session's usage and description: later turns, and changes to the snapshot, do not affect each other. */
  get stats(): SessionStats {
    return { ...this.#info, ...(this.#last && { last: { ...this.#last } }), total: { ...this.#total } };
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
    const base = this.#first ?? this.#open;
    if (!base) return undefined;
    const { baseUrl, model, system } = base;
    const { drop, total } = this.#plan(question.length);
    const left = this.#turns.slice(1, 1 + drop);
    const kept = this.#turns.length === 0 ? [] : [this.#turns[0]!, ...this.#turns.slice(1 + drop)];
    const history = kept.flatMap((t): Message[] => [{ role: "user", content: t.user }, { role: "assistant", content: t.assistant }]);
    return {
      request: { baseUrl, model, system, history, user: question },
      ...(drop > 0 && { dropped: { turns: left.map((t) => t.number), files: left.flatMap((t) => t.files) } }),
      total,
    };
  }

  /** Records a finished follow-up turn, dropping the turns the same question made room for. */
  record(question: string, answer: string, files: string[] = [], sensitive = false): void {
    this.#turns.splice(1, this.#plan(question.length).drop);
    this.#turns.push({ number: ++this.#count, user: question, assistant: answer, files, sensitive });
  }
}

/** Asks a follow-up question in a Session. Emits the same text and error events as `explain`; its only Context report says which old turns were dropped. */
export async function* followUp(input: {
  session: Session;
  question: string;
  /** The `@file` references attached to the question, remembered so a report can name them if their turn is later dropped. */
  files?: string[];
  /** The question carries a file the Sensitive-file rules normally exclude (see the Context reports' overrides); `/save` says so in the note. */
  sensitive?: boolean;
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
  let reported: { inputTokens?: number; outputTokens?: number } = {};
  try {
    for await (const event of input.model.stream(request, input.signal)) {
      if (input.signal.aborted) break;
      if (event.type === "usage") {
        reported = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        continue;
      }
      answer += event.text;
      yield { type: "text-delta", text: event.text };
    }
    if (input.signal.aborted) {
      yield* cancelled(input.session, request, answer);
      return;
    }
  } catch (err) {
    if (input.signal.aborted) yield* cancelled(input.session, request, answer);
    else yield { type: "error", error: err instanceof LearnError ? err : new ProviderError("the model provider returned an error that learn could not classify") };
    return;
  }
  input.session.record(input.question, answer, input.files, input.sensitive);
  const usage = turnUsage(request, answer, reported);
  input.session.recordUsage(usage);
  yield { type: "usage", usage };
  yield { type: "done" };
}
