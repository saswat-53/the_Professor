import type { LearnError } from "./errors.js";
import type { Level } from "./prompt.js";
import type { ContextReport } from "./report.js";

export interface ModelRequest {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
}

/** The model is a plain dependency: anything that turns a request into text chunks. */
export interface LanguageModel {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<string>;
}

export interface Settings {
  baseUrl: string;
  model: string;
  level?: Level;
  /** Most characters of Excerpt plus Context to send. Default: by endpoint, see `defaultBudget`. */
  contextBudget?: number;
}

export type ExplainEvent =
  | { type: "context-report"; report: ContextReport }
  | { type: "text-delta"; text: string }
  | { type: "done" }
  | { type: "error"; error: LearnError };
