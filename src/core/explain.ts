import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assertExcerptFits, resolveBudget } from "./budget.js";
import { CancelledError, LearnError, ProviderError, UnexpectedError, UsageError } from "./errors.js";
import { blockFinderFor } from "./block-finder-for.js";
import { type BlockFinder, type Context, formatRequest, gatherContext } from "./context.js";
import { DEFAULT_LEVEL, buildSystemPrompt } from "./prompt.js";
import { type ContextReport, buildContextReport, reportForError } from "./report.js";
import { findProjectRoot } from "./root.js";
import { createFileReader, resolveEndpoint } from "./sensitive.js";
import { type Excerpt, parseReference, pipedExcerpt, resolveReference } from "./reference.js";
import type { Session } from "./session.js";
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
  /** Which code to explain. Required unless `piped` is given. */
  reference?: string;
  /** Text read from standard input, explained instead of a file. A `reference` takes precedence; the frontend decides whether to read it. */
  piped?: { text: string; lang?: string; /** Where the text came from. Default: standard input. */ origin?: "piped" | "clipboard" };
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
  /** When given, the finished explanation is recorded here so follow-up questions can build on it. */
  session?: Session;
}

/**
 * Turns a reference and settings into the exact request that would be sent, with the Context report
 * built from the same Excerpt and Context. Reads the file and finds the project root, but never contacts the model.
 */
export async function prepareRequest(input: ExplainInput): Promise<{ request: ModelRequest; report: ContextReport }> {
  const requestFor = (excerpt: Excerpt, context: Context | null): ModelRequest => ({
    baseUrl: input.settings.baseUrl,
    model: input.settings.model,
    system: buildSystemPrompt(input.settings.level ?? DEFAULT_LEVEL),
    user: formatRequest(excerpt, context),
  });
  if (input.reference === undefined) {
    if (!input.piped) throw new UsageError("nothing to explain: give a file reference or pipe text in");
    // No file is read, so there is no file reader and no filename rule; the report says so.
    const excerpt = pipedExcerpt(input.piped.text, input.piped.lang, input.piped.origin);
    const endpoint = resolveEndpoint(input.settings.baseUrl);
    const budget = resolveBudget(endpoint, input.settings.contextBudget);
    assertExcerptFits(excerpt, budget);
    return { request: requestFor(excerpt, null), report: buildContextReport(excerpt, null, budget, endpoint.local) };
  }
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
  const budget = resolveBudget(reader.endpoint, input.settings.contextBudget);
  assertExcerptFits(excerpt, budget);
  const finder = input.blockFinder ?? blockFinderFor(excerpt.source?.path ?? "");
  const context = gatherContext(excerpt, finder, budget.chars);
  return {
    request: requestFor(excerpt, context),
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
    // A Session that could never fit its own first request is refused before anything is sent.
    input.session?.assertPinnedFits(request.user.length);
    yield { type: "context-report", report: prepared.report };
  } catch (err) {
    if (input.signal.aborted) {
      yield { type: "error", error: new CancelledError() };
      return;
    }
    const refused = reportForError(err);
    if (refused) yield { type: "context-report", report: refused };
    yield { type: "error", error: local(err) };
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
    // An abort that ends the stream quietly is still a cancel, not a success.
    if (!input.signal.aborted) input.session?.begin(request, answer);
    yield input.signal.aborted ? { type: "error", error: new CancelledError() } : { type: "done" };
  } catch (err) {
    // Whatever the model threw after an abort is the abort's echo, not a provider failure.
    yield { type: "error", error: input.signal.aborted ? new CancelledError() : fromModel(err) };
  }
}
