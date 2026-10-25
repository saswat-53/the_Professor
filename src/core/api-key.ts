import { UsageError } from "./errors.js";
import { resolveEndpoint } from "./sensitive.js";
import { trimEnds } from "./settings.js";

/**
 * Where a stored key lives, one entry per host (`api.openai.com`, or `host:port` when the URL names a port; never the
 * whole URL), so a key saved for one provider is never sent to another. The core only knows this shape; the CLI supplies the OS keychain behind it.
 * `get` gives undefined when nothing is stored and throws when the store cannot be used at all.
 */
export interface KeyStore {
  get(host: string): Promise<string | undefined>;
  set(host: string, key: string): Promise<void>;
  /** True when an entry was there to remove. */
  delete(host: string): Promise<boolean>;
}

/**
 * The API key. The environment variable the config names (`key_env`) wins; if it is not set, the keychain entry
 * for the endpoint's host is used (for a local endpoint only when `key_env` is named). There is no key flag and no key in the config. A localhost endpoint may run
 * without a key; a hosted one may not, and the error names the variable (never a value).
 */
export async function resolveApiKey({ keyEnv, baseUrl, env, store }: { keyEnv: string | undefined; baseUrl: string; env: Record<string, string | undefined>; store?: KeyStore }): Promise<string | undefined> {
  const raw = keyEnv === undefined ? undefined : env[keyEnv];
  const fromEnv = trimEnds(raw);
  if (fromEnv) return fromEnv;
  const endpoint = resolveEndpoint(baseUrl);
  // A local endpoint needs no key, so the keychain (which can raise an OS permission dialog) is asked only if the config names a key variable.
  if (!endpoint.local || keyEnv !== undefined) {
    const stored = await storedKey(store, endpoint.keyHost);
    if (stored) return stored;
  }
  if (endpoint.local) return undefined;
  if (keyEnv === undefined) {
    throw new UsageError('no API key is available for this hosted endpoint; name the environment variable that holds the key with key_env under [provider] in the config file, such as key_env = "OPENAI_API_KEY", or store a key with `learn auth set`');
  }
  throw new UsageError(`the environment variable ${keyEnv} (key_env in the config file) is not set or is empty; set it to your API key, or store a key with \`learn auth set\``);
}

/** The stored key for the host, or undefined: a keychain that is missing or locked must not stop the environment variable from being the answer. */
async function storedKey(store: KeyStore | undefined, host: string | undefined): Promise<string | undefined> {
  if (!store || host === undefined) return undefined;
  try {
    return (await store.get(host)) || undefined;
  } catch {
    return undefined;
  }
}
