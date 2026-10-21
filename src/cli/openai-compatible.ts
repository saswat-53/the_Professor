import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { LanguageModel } from "../core/index.js";

/** Adapts the Vercel AI SDK to core's plain LanguageModel interface. */
export function openAICompatibleModel(apiKey: string | undefined): LanguageModel {
  return {
    async *stream(request, signal) {
      const provider = createOpenAICompatible({ name: "learn", baseURL: request.baseUrl, apiKey });
      const result = streamText({
        model: provider(request.model),
        system: request.system,
        prompt: request.user,
        abortSignal: signal,
        maxRetries: 0,
        onError: () => {}, // errors surface through the stream below
      });
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") yield part.text;
        else if (part.type === "error") throw part.error;
      }
    },
  };
}
