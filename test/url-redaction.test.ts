import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { HIDDEN, redactUrl, resolveSettings } from "../src/core/settings.js";
import { run } from "./support/cli.js";

/**
 * A base URL is printed in exactly one way, `redactUrl`: parsed, then protocol, host and path only.
 * Each case lists every fragment of the input that must never appear in any output.
 * Tokens are unique (`PASS-ZX9Q4-NOLEAK`, `XTRA-ZX9Q4-NOLEAK`, `SECRET-ZX9Q4-NOLEAK`, `USER-ZX9Q4-NOLEAK`) so a substring check cannot match by accident.
 */
const CASES = [
  // `#` and `?` end the authority, so the parser rejects these: nothing of the string may be shown.
  { url: "http://ALICE-ZX9Q4-NOLEAK:PASS-ZX9Q4-NOLEAK#XTRA-ZX9Q4-NOLEAK@host/v1", shown: HIDDEN, secrets: ["ALICE-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK", "XTRA-ZX9Q4-NOLEAK"] },
  { url: "http://ALICE-ZX9Q4-NOLEAK:PASS-ZX9Q4-NOLEAK?XTRA-ZX9Q4-NOLEAK@host/v1", shown: HIDDEN, secrets: ["ALICE-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK", "XTRA-ZX9Q4-NOLEAK"] },
  { url: "ftp://ALICE-ZX9Q4-NOLEAK:PASS-ZX9Q4-NOLEAK#XTRA-ZX9Q4-NOLEAK@host/v1", shown: HIDDEN, secrets: ["ALICE-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK", "XTRA-ZX9Q4-NOLEAK"] },
  // The last `@` ends the userinfo, so this one parses; the credentials are removed and said so.
  { url: "http://ALICE-ZX9Q4-NOLEAK:PASS-ZX9Q4-NOLEAK@XTRA-ZX9Q4-NOLEAK@host/v1", shown: "http://host/v1 (removed: credentials)", secrets: ["ALICE-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK", "XTRA-ZX9Q4-NOLEAK"] },
  { url: "http://ALICE-ZX9Q4-NOLEAK:PASS-ZX9Q4-NOLEAK%23XTRA-ZX9Q4-NOLEAK@host/v1", shown: "http://host/v1 (removed: credentials)", secrets: ["ALICE-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK", "XTRA-ZX9Q4-NOLEAK", "%23"] },
  { url: "http://ALICE-ZX9Q4-NOLEAK:PASS-ZX9Q4-NOLEAK%40XTRA-ZX9Q4-NOLEAK@host/v1", shown: "http://host/v1 (removed: credentials)", secrets: ["ALICE-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK", "XTRA-ZX9Q4-NOLEAK", "%40"] },
  { url: "https://host/v1?api_key=SECRET-ZX9Q4-NOLEAK", shown: "https://host/v1 (removed: query)", secrets: ["SECRET-ZX9Q4-NOLEAK", "api_key"] },
  { url: "https://host/v1#SECRET-ZX9Q4-NOLEAK", shown: "https://host/v1 (removed: fragment)", secrets: ["SECRET-ZX9Q4-NOLEAK"] },
  { url: "https://USR-ZX9Q4-NOLEAK:PASS-ZX9Q4-NOLEAK@host:8443/v1?k=SECRET-ZX9Q4-NOLEAK#SECRET-ZX9Q4-NOLEAK", shown: "https://host:8443/v1 (removed: credentials, query, fragment)", secrets: ["USR-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK", "SECRET-ZX9Q4-NOLEAK"] },
  // No scheme: the parser reads `USER-ZX9Q4-NOLEAK:` as the scheme, so even that must not be shown.
  { url: "USER-ZX9Q4-NOLEAK:PASS-ZX9Q4-NOLEAK@host/v1", shown: HIDDEN, secrets: ["USER-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK"] },
  { url: "not a url PASS-ZX9Q4-NOLEAK", shown: HIDDEN, secrets: ["PASS-ZX9Q4-NOLEAK"] },
  // The parser reads `\` as `/` and drops tabs and newlines, so a key pasted before one would come out as the host: these are hidden before parsing.
  { url: "http://TOK-ZX9Q4-NOLEAK\\en@host/v1", shown: HIDDEN, secrets: ["TOK-ZX9Q4-NOLEAK"] },
  { url: "http://sk-SECRET-ZX9Q4-NOLEAK\\@host/v1", shown: HIDDEN, secrets: ["SECRET-ZX9Q4-NOLEAK"] },
  { url: "http://USER-ZX9Q4-NOLEAK:PASS-ZX9Q4-NOLEAK\t@host/v1", shown: HIDDEN, secrets: ["USER-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK"] },
  { url: "http://host/v1\nSECRET-ZX9Q4-NOLEAK", shown: HIDDEN, secrets: ["SECRET-ZX9Q4-NOLEAK"] },
  // Invisible, format and lookalike characters the parser would quietly keep or fold (zero-width, soft hyphen, fullwidth, bidi, NEL): hidden before parsing.
  ...["\u200B", "\u00AD", "\u2060", "\uFF3C", "\uFF0F", "\u0085", "\u202E", "\uFEFF"].map((c) => ({
    url: `http://USR-ZX9Q4-NOLEAK${c}PASS-ZX9Q4-NOLEAK@host/v1`,
    shown: HIDDEN,
    secrets: ["USR-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK"],
  })),
  { url: "http://h\u200B/v1", shown: HIDDEN, secrets: [] },
  { url: "http://\uFF48/v1", shown: HIDDEN, secrets: [] },
  { url: "http://h/v1\u0085", shown: HIDDEN, secrets: [] },
  { url: "http://h/v1\u202E", shown: HIDDEN, secrets: [] },
  // Characters the parser reads as part of the userinfo, so they come out as "credentials removed". Safe today
  // only because of how the parser behaves: if one of these ever prints the key, this fails loudly.
  ...["\u200D", "\u200C", "\u3002", "%5C", "%09", "%0a", "%2F", "%40"].map((c) => ({
    url: `http://USR-ZX9Q4-NOLEAK${c}PASS-ZX9Q4-NOLEAK@host/v1`,
    shown: "http://host/v1 (removed: credentials)",
    secrets: ["USR-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK"],
  })),
  // Forms the parser accepts or rejects in its own way; pinned so a parser change shows up here.
  { url: "http://host%40EVIL-ZX9Q4-NOLEAK/v1", shown: HIDDEN, secrets: ["EVIL-ZX9Q4-NOLEAK"] },
  { url: "http://b\u00fccher.example/v1", shown: "http://xn--bcher-kva.example/v1", secrets: [] },
  { url: "http:host/v1", shown: "http://host/v1", secrets: [] }, // shown honestly, but refused as a setting (see settings.test.ts)
  { url: "http:///USR-ZX9Q4-NOLEAK:PASS-ZX9Q4-NOLEAK@host/x", shown: "http://host/x (removed: credentials)", secrets: ["USR-ZX9Q4-NOLEAK", "PASS-ZX9Q4-NOLEAK"] },
] as const;

/** What a pinned `shown` becomes when the path is left out: `http://host/v1 (removed: query)` -> `http://host (removed: query)`. Written out apart from `redactUrl` so the check is not circular. */
const hostOnly = (shown: string) => shown.replace(/^([a-z]+:\/\/[^/ ]+)\/\S*/, "$1");

/** None of `secrets` may appear in `text`. */
const expectNoSecrets = (text: string, secrets: readonly string[]) => {
  for (const secret of secrets) expect(text).not.toContain(secret);
};

describe("redactUrl", () => {
  it.each(CASES)("$url", ({ url, shown, secrets }) => {
    const out = redactUrl(url);
    expect(out).toBe(shown);
    expectNoSecrets(out, secrets);
  });
  it.each(CASES)("path: false shows protocol and host only, with the same note: $url", ({ url, shown, secrets }) => {
    const out = redactUrl(url, { path: false });
    expect(out).toBe(hostOnly(shown));
    expectNoSecrets(out, secrets);
  });
  it.each([
    ["http://localhost:11434/v1", "http://localhost:11434/v1"],
    ["https://api.openai.com/v1", "https://api.openai.com/v1"],
    ["http://[::1]:8080/v1", "http://[::1]:8080/v1"],
    ["http://host", "http://host/"],
  ])("leaves a clean URL alone: %s", (url, shown) => expect(redactUrl(url)).toBe(shown));
});

describe("redactUrl guard", () => {
  it("a leading space is hidden by the guard (the parser alone would trim it and accept the URL)", () => {
    expect(new URL(" http://host/v1?k=SECRET-ZX9Q4-NOLEAK").search).toBe("?k=SECRET-ZX9Q4-NOLEAK");
    expect(redactUrl(" http://host/v1?k=SECRET-ZX9Q4-NOLEAK")).toBe(HIDDEN);
  });
});

describe("what is shown of a URL that has a path", () => {
  it("the path is kept by default, because it identifies the endpoint (so no key belongs in it)", () => {
    expect(redactUrl("http://host/v1/sk-PATH-ZX9Q4-NOLEAK")).toBe("http://host/v1/sk-PATH-ZX9Q4-NOLEAK");
  });
  it("the path is what the URL parser produces, not what was typed", () => {
    expect(redactUrl("http://host/v1/../x")).toBe("http://host/x");
    expect(redactUrl("http://host/v1/%2e%2e/x")).toBe("http://host/x");
    expect(redactUrl("HTTP://Host:80/v1")).toBe("http://host/v1");
    expect(redactUrl("https://host:443/v1")).toBe("https://host/v1");
    expect(redactUrl("http://host:443/v1")).toBe("http://host:443/v1");
  });
  it("a key typed as the host is printed as a host, lowercased", () => {
    expect(redactUrl("http://SECRET-ZX9Q4-NOLEAK")).toBe("http://secret-zx9q4-noleak/");
  });
  it("an error about a rejected base URL names protocol and host only, since the path adds nothing there", () => {
    let message = "";
    try {
      resolveSettings({ flags: { baseUrl: "ftp://host/v1/sk-PATH-ZX9Q4-NOLEAK" }, env: {}, home: "/h" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('"ftp://host"');
    expect(message).not.toContain("PATH-ZX9Q4-NOLEAK");
  });
});

describe("every message that echoes a base URL goes through redactUrl", () => {
  it.each(CASES)("settings error: $url", ({ url, shown, secrets }) => {
    for (const [source, label] of [
      [{ flags: { baseUrl: url }, env: {} }, "--base-url"],
      [{ flags: {}, env: { LEARN_BASE_URL: url } }, "LEARN_BASE_URL"],
    ] as const) {
      let message = "";
      try {
        resolveSettings({ ...source, home: "/h" });
      } catch (err) {
        message = (err as Error).message;
      }
      expectNoSecrets(message, secrets);
      // Whenever the value is rejected, the error echoes exactly the host-only form, in quotes after the source's name.
      if (message !== "") expect(message).toContain(`invalid ${label} "${hostOnly(shown)}": `);
      // A value with credentials, or one that cannot be shown, is always rejected, so this cannot pass by never throwing.
      if (shown.includes("credentials") || shown === HIDDEN) expect(message).not.toBe("");
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
        expectNoSecrets(r.stdout, secrets);
        expectNoSecrets(r.stderr, secrets);
      }
    }, 30_000);
  }

  it("--dry-run and --show-prompt print the URL that will be used: parsed, with the path normalised", async () => {
    for (const flag of ["--dry-run", "--show-prompt"]) {
      const r = await run([file, "--dry-run", flag, "--base-url", "HTTP://127.0.0.1:9/v1/../x", "--model", "m"]);
      expect(r.code).toBe(0);
      expect(r.stderr).toContain("base URL: http://127.0.0.1:9/x\n");
    }
  });

  it("a query or fragment is refused before anything is printed, with advice and without the secret", async () => {
    for (const url of ["https://127.0.0.1:9/v1?api_key=SECRET-ZX9Q4-NOLEAK", "https://127.0.0.1:9/v1#SECRET-ZX9Q4-NOLEAK"]) {
      const r = await run([file, "--dry-run", "--base-url", url, "--model", "m"]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("must not contain a query or fragment");
      expect(r.stdout + r.stderr).not.toContain("SECRET-ZX9Q4-NOLEAK");
    }
  });

  it("a trailing newline in LEARN_BASE_URL (as from $(cat file)) is trimmed, and the request URL is the trimmed one", async () => {
    const r = await run([file, "--dry-run"], { LEARN_BASE_URL: "http://127.0.0.1:9/v1\n", LEARN_MODEL: "m\n" });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("base URL: http://127.0.0.1:9/v1\nmodel: m\n");
  });
});
