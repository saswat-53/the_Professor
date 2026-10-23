import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, streamText } from "ai";
import { BadKeyError, ModelNotFoundError, NetworkError, ProviderError, RateLimitError } from "../core/index.js";
import type { LanguageModel } from "../core/index.js";

/**
 * Turns whatever the SDK threw into one of learn's typed errors. The provider's response body is
 * deliberately dropped: only the status code is used, so raw provider output cannot reach the user.
 */
export function classifyProviderError(err: unknown): Error {
  // Cancellation is not a provider failure; ticket 19 gives it its own handling.
  if (err instanceof Error && err.name === "AbortError") return err;
  const unreachable = new NetworkError("could not reach the model provider; check the base URL and your connection");
  if (!APICallError.isInstance(err)) return unreachable;
  switch (err.statusCode) {
    case 401:
      return new BadKeyError("the provider rejected the API key; check LEARN_API_KEY");
    case 403:
      // 403 can also mean the key is fine but not allowed this model or region, so it does not blame the key alone.
      return new BadKeyError(
        "the provider rejected the request (key invalid or not permitted for this model); check LEARN_API_KEY and --model",
      );
    case 429:
      return new RateLimitError("the provider says you are sending too many requests; wait a moment and try again");
    case 404:
      return new ModelNotFoundError("the provider does not know that model; check --model or LEARN_MODEL");
    case undefined:
      return unreachable;
    default:
      return new ProviderError(`the provider returned an error (HTTP ${err.statusCode})`);
  }
}

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
        else if (part.type === "error") throw classifyProviderError(part.error);
      }
    },
  };
}
