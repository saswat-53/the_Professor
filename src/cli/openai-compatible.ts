import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, streamText } from "ai";
import { BadKeyError, LearnError, ModelNotFoundError, NetworkError, ProviderError, RateLimitError, UnexpectedError } from "../core/index.js";
import type { LanguageModel } from "../core/index.js";

/** Error codes of the connection itself: the socket could not be made, was reset, or the name did not resolve. */
const CONNECTION_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE", "EHOSTUNREACH", "ENETUNREACH",
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);

/** The failure came from the connection (refused, reset, DNS, timeout), looking through the `cause` chain where fetch hides the real error. */
function isConnectionFailure(err: unknown): boolean {
  for (let e = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if (e.name === "TimeoutError" || CONNECTION_CODES.has((e as { code?: string }).code ?? "")) return true;
  }
  return false;
}

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
  if (err instanceof LearnError) return err;
  const unreachable = new NetworkError("could not reach the model provider; check the base URL and your connection");
  // Only the connection itself is a network problem. Anything else that is not an API error (a parse error mid-stream, a bug here) is not, and says so; its text is dropped because it can quote the provider's data.
  const unexpected = new UnexpectedError("something unexpected went wrong while reading the provider's response; this is probably a bug in learn");
  if (!APICallError.isInstance(err)) return isConnectionFailure(err) ? unreachable : unexpected;
  // A 2xx status means the request worked and reading the response failed: the connection dropped, or the data was not what it should be.
  if (err.statusCode !== undefined && err.statusCode >= 200 && err.statusCode < 300) return isConnectionFailure(err) ? unreachable : unexpected;
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
      // The SDK raises a status-less API error when it cannot connect; a cause that is clearly something else is not that.
      return err.cause === undefined || isConnectionFailure(err) ? unreachable : unexpected;
    default:
      return new ProviderError(`the provider returned an error (HTTP ${err.statusCode})`);
  }
}

/** A 400 that names `stream_options`: the endpoint does not know the usage option we asked for, and nothing else is wrong with the request. */
function rejectsStreamOptions(err: unknown): boolean {
  if (!APICallError.isInstance(err) || err.statusCode !== 400) return false;
  return /stream_options/i.test(`${err.message} ${err.responseBody ?? ""}`);
}

/** Adapts the Vercel AI SDK to core's plain LanguageModel interface. */
export function openAICompatibleModel(
  apiKey: string | undefined,
  keyEnv?: string,
  /** Called once, with the endpoint's host only (never its path, query or key), when the endpoint rejects the usage option. */
  onUsageUnavailable?: (host: string) => void,
): LanguageModel {
  /** Remembered for the life of this model (one chat), in memory only: once an endpoint has rejected the usage option, it is not asked again. */
  let usageUnsupported = false;

  /** One request. Raw errors are thrown as they are so the caller can tell a rejected `stream_options` from any other failure. */
  async function* attempt(request: Parameters<LanguageModel["stream"]>[0], signal: AbortSignal | undefined, includeUsage: boolean) {
    const provider = createOpenAICompatible({ name: "learn", baseURL: request.baseUrl, apiKey, includeUsage });
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
      else if (part.type === "error") throw part.error;
    }
  }

  return {
    async *stream(request, signal) {
      let yielded = false;
      try {
        for await (const text of attempt(request, signal, !usageUnsupported)) {
          yielded = true;
          yield text;
        }
        return;
      } catch (err) {
        // The one automatic retry (ADR 0004): only a 400 naming stream_options, and only before any output was streamed.
        // `yielded` is defence in depth: a real HTTP 400 cannot follow a started body (a mid-stream error is an SSE event with no status, which
        // rejectsStreamOptions already refuses), so no test on the wire can reach it. It keeps the rule "never retry after output" explicit.
        if (yielded || usageUnsupported || !rejectsStreamOptions(err)) throw classifyProviderError(err, keyEnv);
        usageUnsupported = true;
        onUsageUnavailable?.(new URL(request.baseUrl).host);
      }
      try {
        yield* attempt(request, signal, false);
      } catch (err) {
        // The stream itself can throw too (a connection cut mid-stream): classify it the same way.
        throw classifyProviderError(err, keyEnv);
      }
    },
  };
}
