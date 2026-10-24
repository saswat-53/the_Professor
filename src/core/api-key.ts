import { UsageError } from "./errors.js";
import { isLocalHost, resolveEndpoint } from "./sensitive.js";

/**
 * The API key, read from the one environment variable the config names (`key_env`). There is no key
 * flag and no key in the config, so the key can only come from the environment. A localhost
 * endpoint may run without a key; a hosted one may not, and the error names the variable (never a value).
 */
export function resolveApiKey({ keyEnv, baseUrl, env }: { keyEnv: string | undefined; baseUrl: string; env: Record<string, string | undefined> }): string | undefined {
  const key = keyEnv === undefined ? undefined : env[keyEnv]?.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (key) return key;
  if (isLocalHost(baseUrl)) return undefined;
  if (keyEnv === undefined) {
    throw new UsageError('no API key variable is set for this hosted endpoint; name the environment variable that holds the key with key_env under [provider] in the config file, such as key_env = "OPENAI_API_KEY"');
  }
  throw new UsageError(`the environment variable ${keyEnv} (key_env in the config file) is not set or is empty; set it to your API key`);
}

/** A key sent over plain http to another machine can be read on the way; undefined when the endpoint is https or local. */
export function insecureTransportWarning(baseUrl: string): string | undefined {
  const { host, local } = resolveEndpoint(baseUrl);
  if (local || host === undefined || !/^http:/i.test(baseUrl)) return undefined;
  return `warning: ${host} is reached over plain http, so the request (and any API key) is not encrypted; use https unless the network is trusted`;
}
