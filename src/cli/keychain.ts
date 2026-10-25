import type { KeyStore } from "../core/index.js";

/** The service name every entry is stored under; the account is the endpoint's host. */
export const KEYCHAIN_SERVICE = "learn";

/** The keychain cannot be used here: no library, or no keyring on this machine. The message is for the person at the terminal. */
export class KeychainUnavailableError extends Error {
  override name = "KeychainUnavailableError";
}

/**
 * The OS keychain through @napi-rs/keyring, an optional dependency. It is imported on first use, so a run whose
 * key comes from the environment never loads it, and an install without it (or without a keyring on the machine)
 * still works for everything else.
 */
export function osKeychain(): KeyStore {
  let entryClass: Promise<typeof import("@napi-rs/keyring").Entry> | undefined;
  const load = () =>
    (entryClass ??= import("@napi-rs/keyring").then(
      (m) => m.Entry,
      () => {
        throw new KeychainUnavailableError("the OS keychain library (@napi-rs/keyring) is not installed");
      },
    ));
  const entry = async (host: string) => new (await load())(KEYCHAIN_SERVICE, host);
  const unavailable = (err: unknown) => (err instanceof KeychainUnavailableError ? err : new KeychainUnavailableError(`no keyring is available on this machine (${err instanceof Error ? err.message : "unknown error"})`));
  return {
    async delete(host) {
      try {
        return (await entry(host)).deletePassword();
      } catch (err) {
        throw unavailable(err);
      }
    },
    async get(host) {
      try {
        return (await (await entry(host)).getPassword()) ?? undefined;
      } catch (err) {
        throw unavailable(err);
      }
    },
    async set(host, key) {
      try {
        (await entry(host)).setPassword(key);
      } catch (err) {
        throw unavailable(err);
      }
    },
  };
}
