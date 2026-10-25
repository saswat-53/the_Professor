import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, streamText } from "ai";
import { BadKeyError, ModelNotFoundError, NetworkError, ProviderError, RateLimitError } from "../core/index.js";
import type { LanguageModel } from "../core/index.js";

const IMF_FIXDATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * How many seconds a `Retry-After` header asks for: a whole number of seconds, or an HTTP date (the one fixed format
 * HTTP uses). Anything else, and any wait that is not in the future, is undefined. The header's text is only ever parsed,
 * never shown, so what the provider put in it cannot reach the terminal.
 */
function retryAfterSeconds(value: string | undefined, now: number): number | undefined {
  const text = value?.trim();
  if (text === undefined) return undefined;
  const seconds = /^\d{1,7}$/.test(text) ? Number(text) : IMF_FIXDATE.test(text) ? Math.ceil((Date.parse(text) - now) / 1000) : NaN;
  return seconds > 0 ? seconds : undefined;
}

/** A wait in plain words, rounded: seconds under two minutes, then minutes, then hours. */
function describeWait(seconds: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (seconds > 86_400) return "more than 24 hours";
  if (seconds < 120) return `about ${unit(seconds, "second")}`;
  if (seconds < 7_200) return `about ${unit(Math.round(seconds / 60), "minute")}`;
  return `about ${unit(Math.round(seconds / 3_600), "hour")}`;
}

/**
 * Turns whatever the SDK threw into one of learn's typed errors. The provider's response body is
 * deliberately dropped: only the status code is used, so raw provider output cannot reach the user.
 */
export function classifyProviderError(err: unknown, keyEnv?: string, now = Date.now()): Error {
  // Only the variable's name is ever shown, never its value.
  const keyHint = keyEnv === undefined ? "set key_env in the config file to the variable that holds your key" : `check $${keyEnv}`;
  // Cancellation is not a provider failure; explain() turns it into a CancelledError.
  if (err instanceof Error && err.name === "AbortError") return err;
  const unreachable = new NetworkError("could not reach the model provider; check the base URL and your connection");
  if (!APICallError.isInstance(err)) return unreachable;
  switch (err.statusCode) {
    case 401:
      return new BadKeyError(`the provider rejected the API key; ${keyHint}`);
    case 403:
      // 403 can also mean the key is fine but not allowed this model or region, so it does not blame the key alone.
      return new BadKeyError(
        `the provider rejected the request (key invalid or not permitted for this model); ${keyHint}, and --model`,
      );
    case 429: {
      const wait = retryAfterSeconds(err.responseHeaders?.["retry-after"], now);
      return new RateLimitError(
        `the provider says you are sending too many requests; ${wait === undefined ? "wait a moment and try again" : `wait ${describeWait(wait)} and try again`}`,
      );
    }
    case 404:
      return new ModelNotFoundError("the provider does not know that model; check --model or LEARN_MODEL");
    case undefined:
      return unreachable;
    default:
      return new ProviderError(`the provider returned an error (HTTP ${err.statusCode})`);
  }
}

/** Adapts the Vercel AI SDK to core's plain LanguageModel interface. */
export function openAICompatibleModel(apiKey: string | undefined, keyEnv?: string): LanguageModel {
  return {
    async *stream(request, signal) {
      const provider = createOpenAICompatible({ name: "learn", baseURL: request.baseUrl, apiKey });
      const result = streamText({
        model: provider(request.model),
        system: request.system,
        messages: [...(request.history ?? []), { role: "user" as const, content: request.user }],
        abortSignal: signal,
        maxRetries: 0,
        onError: () => {}, // errors surface through the stream below
      });
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") yield part.text;
        else if (part.type === "error") throw classifyProviderError(part.error, keyEnv);
      }
    },
  };
}
