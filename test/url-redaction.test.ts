import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { redactUrl, resolveSettings } from "../src/core/settings.js";
import { run } from "./support/cli.js";

/**
 * A base URL is printed in exactly one way, `redactUrl`: parsed, then protocol, host and path only.
 * Each case lists every fragment of the input that must never appear in any output.
 * Tokens are unique (`pw7Q`, `x9Z`, `SECRET7`, `user7`) so a substring check cannot match by accident.
 */
const CASES = [
  // `#` and `?` end the authority, so the parser rejects these: nothing of the string may be shown.
  { url: "http://alice:pw7Q#x9Z@host/v1", shown: "(value hidden)", secrets: ["alice", "pw7Q", "x9Z"] },
  { url: "http://alice:pw7Q?x9Z@host/v1", shown: "(value hidden)", secrets: ["alice", "pw7Q", "x9Z"] },
  { url: "ftp://alice:pw7Q#x9Z@host/v1", shown: "(value hidden)", secrets: ["alice", "pw7Q", "x9Z"] },
  // The last `@` ends the userinfo, so this one parses; the credentials are removed and said so.
  { url: "http://alice:pw7Q@x9Z@host/v1", shown: "http://host/v1 (removed: credentials)", secrets: ["alice", "pw7Q", "x9Z"] },
  { url: "http://alice:pw7Q%23x9Z@host/v1", shown: "http://host/v1 (removed: credentials)", secrets: ["alice", "pw7Q", "x9Z", "%23"] },
  { url: "http://alice:pw7Q%40x9Z@host/v1", shown: "http://host/v1 (removed: credentials)", secrets: ["alice", "pw7Q", "x9Z", "%40"] },
  { url: "https://host/v1?api_key=SECRET7", shown: "https://host/v1 (removed: query)", secrets: ["SECRET7", "api_key"] },
  { url: "https://host/v1#SECRET7", shown: "https://host/v1 (removed: fragment)", secrets: ["SECRET7"] },
  { url: "https://u7:pw7Q@host:8443/v1?k=SECRET7#SECRET7", shown: "https://host:8443/v1 (removed: credentials, query, fragment)", secrets: ["u7", "pw7Q", "SECRET7"] },
  // No scheme: the parser reads `user7:` as the scheme, so even that must not be shown.
  { url: "user7:pw7Q@host/v1", shown: "(value hidden)", secrets: ["user7", "pw7Q"] },
  { url: "not a url pw7Q", shown: "(value hidden)", secrets: ["pw7Q"] },
] as const;

describe("redactUrl", () => {
  it.each(CASES)("$url", ({ url, shown, secrets }) => {
    const out = redactUrl(url);
    expect(out).toBe(shown);
    for (const s of secrets) expect(out).not.toContain(s);
  });
  it.each([
    ["http://localhost:11434/v1", "http://localhost:11434/v1"],
    ["https://api.openai.com/v1", "https://api.openai.com/v1"],
    ["http://[::1]:8080/v1", "http://[::1]:8080/v1"],
    ["http://host", "http://host/"],
  ])("leaves a clean URL alone: %s", (url, shown) => expect(redactUrl(url)).toBe(shown));
});

describe("every message that echoes a base URL goes through redactUrl", () => {
  it.each(CASES)("settings error: $url", ({ url, secrets }) => {
    for (const source of [{ flags: { baseUrl: url }, env: {} }, { flags: {}, env: { LEARN_BASE_URL: url } }]) {
      let message = "";
      try {
        resolveSettings({ ...source, home: "/h" });
      } catch (err) {
        message = (err as Error).message;
      }
      for (const s of secrets) expect(message).not.toContain(s);
    }
  });
});

let dir: string;
let file: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "learn-redact-"));
  file = join(dir, "a.ts");
  await writeFile(file, "export const a = 1;\n");
});

/** A config file whose provider block holds the URL, reached through XDG_CONFIG_HOME. */
async function configWith(url: string) {
  const xdg = await mkdtemp(join(tmpdir(), "learn-xdg-"));
  await mkdir(join(xdg, "learn"));
  await writeFile(join(xdg, "learn", "config.toml"), `[provider]\nbase_url = ${JSON.stringify(url)}\nmodel = "m"\n`);
  return { XDG_CONFIG_HOME: xdg };
}

describe("no output path of the CLI shows a secret, from the flag, the environment or the config file", () => {
  const sources = ["flag", "env", "config"] as const;
  // Both flags print the request; --dry-run keeps either from contacting the endpoint.
  const modes = [["--dry-run"], ["--dry-run", "--show-prompt"]];
  for (const { url, secrets } of CASES) {
    it(`${url}`, async () => {
      const runs = sources.flatMap((source) =>
        modes.map(async (mode) => {
          const args = [file, ...mode, ...(source === "flag" ? ["--base-url", url, "--model", "m"] : [])];
          const env: Record<string, string> = source === "env" ? { LEARN_BASE_URL: url, LEARN_MODEL: "m" } : source === "config" ? await configWith(url) : {};
          return run(args, env);
        }),
      );
      for (const r of await Promise.all(runs)) {
        for (const s of secrets) {
          expect(r.stdout).not.toContain(s);
          expect(r.stderr).not.toContain(s);
        }
      }
    }, 30_000);
  }

  it("--dry-run and --show-prompt print the sanitized URL and say what was removed", async () => {
    for (const flag of ["--dry-run", "--show-prompt"]) { // each alone with --dry-run, so the request is printed but never sent
      const r = await run([file, "--dry-run", flag, "--base-url", "https://127.0.0.1:9/v1?api_key=SECRET7#SECRET7", "--model", "m"]);
      expect(r.code).toBe(0);
      expect(r.stderr).toContain("base URL: https://127.0.0.1:9/v1 (removed: query, fragment)\n");
    }
  });
});
