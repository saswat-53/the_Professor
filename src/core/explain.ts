import { readFile as nodeReadFile } from "node:fs/promises";
import type { ExplainEvent, LanguageModel, ModelRequest, Settings } from "./types.js";

// Placeholder until the bundled teaching prompt (ticket 07) replaces it.
const SYSTEM_PROMPT =
  "You are a patient teacher. Explain the supplied code: what it does and, above all, why it is written this way.";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface ExplainInput {
  reference: string;
  settings: Settings;
  readFile?: (path: string) => Promise<string>;
}

/** Pure: turns a reference and settings into the exact request that would be sent. */
export async function buildRequest(input: ExplainInput): Promise<ModelRequest> {
  const read = input.readFile ?? ((p: string) => nodeReadFile(p, "utf8"));
  const content = await read(input.reference);
  return {
    baseUrl: input.settings.baseUrl,
    model: input.settings.model,
    system: SYSTEM_PROMPT,
    user: `File: ${input.reference}\n\n${content}`,
  };
}

export async function* explain(
  input: ExplainInput & { model: LanguageModel; signal: AbortSignal },
): AsyncGenerator<ExplainEvent> {
  let request: ModelRequest;
  try {
    request = await buildRequest(input);
  } catch (err) {
    yield { type: "error", message: errorMessage(err) };
    return;
  }
  try {
    for await (const text of input.model.stream(request, input.signal)) {
      yield { type: "text-delta", text };
    }
    yield { type: "done" };
  } catch (err) {
    yield { type: "error", message: errorMessage(err) };
  }
}
