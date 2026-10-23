import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assertExcerptFits, resolveBudget } from "./budget.js";
import { LearnError, ProviderError, UnexpectedError } from "./errors.js";
import { blockFinderFor } from "./block-finder-for.js";
import { type BlockFinder, formatRequest, gatherContext } from "./context.js";
import { DEFAULT_LEVEL, buildSystemPrompt } from "./prompt.js";
import { type ContextReport, buildContextReport, reportForError } from "./report.js";
import { findProjectRoot } from "./root.js";
import { createFileReader } from "./sensitive.js";
import { parseReference, resolveReference } from "./reference.js";
import type { ExplainEvent, LanguageModel, ModelRequest, Settings } from "./types.js";

/**
 * Local failures (a missing file, a permission error) keep their own message. A failure from the
 * model is only trusted if it is already typed: anything else could carry raw provider output.
 */
const local = (err: unknown): LearnError =>
  err instanceof LearnError ? err : new UnexpectedError(err instanceof Error ? err.message : String(err));
const fromModel = (err: unknown): LearnError =>
  err instanceof LearnError ? err : new ProviderError("the model provider returned an error that learn could not classify");

export interface ExplainInput {
  reference: string;
  settings: Settings;
  readFile?: (path: string) => Promise<string>;
  /** Directory relative paths are resolved from. Default: the process's current directory. */
  cwd?: string;
  /** Widens the project root for one run (`--root`). */
  root?: string;
  /** Skips the sensitive-file refusal for this run (`--allow-sensitive`). */
  allowSensitive?: boolean;
  /** Finds the Enclosing block. Default: the built-in Python and brace-language finders; other file types use the fixed window. */
  blockFinder?: BlockFinder;
}

/**
 * Turns a reference and settings into the exact request that would be sent, with the Context report
 * built from the same Excerpt and Context. Reads the file and finds the project root, but never contacts the model.
 */
export async function prepareRequest(input: ExplainInput): Promise<{ request: ModelRequest; report: ContextReport }> {
  const cwd = input.cwd ?? process.cwd();
  const { root } = await findProjectRoot(cwd, input.root);
  const exists = (path: string) => stat(resolve(cwd, path)).then(() => true, () => false);
  const reader = createFileReader({
    root,
    cwd,
    allowSensitive: input.allowSensitive,
    baseUrl: input.settings.baseUrl,
    readText: input.readFile,
  });
  const excerpt = await resolveReference(await parseReference(input.reference, exists), {
    read: (path) => reader.read(path),
  });
  const budget = resolveBudget(input.settings.baseUrl, input.settings.contextBudget);
  assertExcerptFits(excerpt, budget);
  const finder = input.blockFinder ?? blockFinderFor(excerpt.source?.path ?? "");
  const context = gatherContext(excerpt, finder, budget.chars);
  return {
    request: {
      baseUrl: input.settings.baseUrl,
      model: input.settings.model,
      system: buildSystemPrompt(input.settings.level ?? DEFAULT_LEVEL),
      user: formatRequest(excerpt, context),
    },
    report: buildContextReport(excerpt, context, budget, reader.endpoint.local, reader.bypassed),
  };
}

/** The request alone, for callers that do not show a report. */
export const buildRequest = async (input: ExplainInput): Promise<ModelRequest> => (await prepareRequest(input)).request;

export async function* explain(
  input: ExplainInput & {
    model: LanguageModel;
    signal: AbortSignal;
    /** Called with the exact request just before it is sent, so a frontend can show it. */
    onRequest?: (request: ModelRequest) => void;
  },
): AsyncGenerator<ExplainEvent> {
  let request: ModelRequest;
  try {
    const prepared = await prepareRequest(input);
    request = prepared.request;
    yield { type: "context-report", report: prepared.report };
  } catch (err) {
    const refused = reportForError(err);
    if (refused) yield { type: "context-report", report: refused };
    yield { type: "error", error: local(err) };
    return;
  }
  input.onRequest?.(request);
  try {
    for await (const text of input.model.stream(request, input.signal)) {
      yield { type: "text-delta", text };
    }
    yield { type: "done" };
  } catch (err) {
    yield { type: "error", error: fromModel(err) };
  }
}
