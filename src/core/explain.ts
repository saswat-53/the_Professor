import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { LearnError, ProviderError, UnexpectedError } from "./errors.js";
import { braceBlockFinder } from "./brace-block-finder.js";
import { type BlockFinder, formatRequest, gatherContext } from "./context.js";
import { DEFAULT_LEVEL, buildSystemPrompt } from "./prompt.js";
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
  /** Finds the Enclosing block. Default: the brace-language finder; other file types use the fixed window. */
  blockFinder?: BlockFinder;
}

/** Turns a reference and settings into the exact request that would be sent. Reads the file and finds the project root, but never contacts the model. */
export async function buildRequest(input: ExplainInput): Promise<ModelRequest> {
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
  return {
    baseUrl: input.settings.baseUrl,
    model: input.settings.model,
    system: buildSystemPrompt(input.settings.level ?? DEFAULT_LEVEL),
    user: formatRequest(excerpt, gatherContext(excerpt, input.blockFinder ?? braceBlockFinder)),
  };
}

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
    request = await buildRequest(input);
  } catch (err) {
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
