import type { LearnError } from "./errors.js";
import type { Level } from "./prompt.js";
import type { ContextReport } from "./report.js";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  baseUrl: string;
  model: string;
  system: string;
  /** Earlier turns of the Session, oldest first; absent for a first explanation. */
  history?: readonly Message[];
  /** The newest user message. */
  user: string;
}

/** What a model streams: pieces of the answer, and (when the endpoint reports it) the tokens the request used. */
export type ModelEvent =
  | { type: "text"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number };

/** The model is a plain dependency: anything that turns a request into events. */
export interface LanguageModel {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

/** Tokens one request used: as the endpoint reported them, or as learn estimated them when it did not. */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  source: "reported" | "estimated";
}

export interface Settings {
  baseUrl: string;
  model: string;
  level?: Level;
  /** Most characters of Excerpt plus Context to send. Default: by endpoint, see `defaultBudget` (on a local endpoint it follows the context window). */
  contextBudget?: number;
  /** The model's context window in tokens. Default: `DEFAULT_CONTEXT_WINDOW`, used only for local endpoints. */
  contextWindow?: number;
}

export type ExplainEvent =
  | { type: "context-report"; report: ContextReport }
  | { type: "text-delta"; text: string }
  | { type: "usage"; usage: TurnUsage }
  | { type: "done" }
  | { type: "error"; error: LearnError };
