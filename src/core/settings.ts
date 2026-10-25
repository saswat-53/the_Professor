import { isAbsolute } from "node:path";
import { parse } from "smol-toml";
import { UsageError } from "./errors.js";
import { DEFAULT_LEVEL, LEVELS, isLevel } from "./prompt.js";
import type { Level } from "./prompt.js";
import { isValidBudget, isValidContextWindow } from "./budget.js";

/** What the user can set. Provider and model go through the same table as level, so precedence is written once. */
export interface ResolvedSettings {
  baseUrl?: string;
  model?: string;
  level: Level;
  contextBudget?: number;
  /** The model's context window in tokens; sets the Session cap for a local endpoint. */
  contextWindow?: number;
  /** Name of the environment variable that holds the API key (never the key itself). */
  keyEnv?: string;
  /** Absolute, `~` expanded. */
  notesDir: string;
}

/** Raw values by setting name, as typed on the command line (strings). */
export interface Flags {
  level?: string;
  model?: string;
  baseUrl?: string;
  contextBudget?: string;
  contextWindow?: string;
}

/** A parsed config file, and where it came from, so an error can name the file. */
export interface Config {
  file: string;
  values: Record<string, unknown>;
}

type Where = { kind: "flag" | "env" | "config"; label: string };

interface Def<K extends keyof ResolvedSettings> {
  key: K;
  flag?: keyof Flags;
  flagName?: string;
  env?: string;
  /** Path in the config file. */
  config: readonly string[];
  /** Returns the value, or a short reason it is invalid. */
  parse: (raw: unknown, home: string) => { value: ResolvedSettings[K] } | { error: string };
  /** How a rejected value is echoed back in an error. Default: as given. */
  show?: (raw: string) => string;
}

/** What is printed in place of a base URL that cannot be shown safely. */
export const HIDDEN = "(value hidden)";

/**
 * The only schemes whose text is safe to show: for any other, the parser may have read part of a
 * credential as the scheme (`user:pass@host`). Wider than the http/https a base URL may use on
 * purpose, so a rejected `ftp://host/v1` can still be named in the error that rejects it.
 */
const SHOWN_SCHEMES = ["http:", "https:", "ftp:", "ws:", "wss:"];

/**
 * Pre-check only, for characters the parser would quietly rewrite or keep invisible: it turns `\` into
 * `/`, drops tabs and newlines, folds fullwidth letters, and passes zero-width, bidi and next-line
 * characters through, any of which can hide or move part of a URL. The parser does the real work in
 * `redactUrl`; this just refuses what it would otherwise normalise away. Covered: backslash,
 * whitespace and C0/C1 controls (including DEL and NEL), soft hyphen, Mongolian vowel separator,
 * zero-width space and the directional marks (U+200B, U+200E, U+200F, U+202A-202E; the joiners U+200C and U+200D stay allowed, as real Persian and Indic hostnames need them), the invisible operators
 * (U+2060-206F), the byte order mark, and the fullwidth block (U+FF00-FFEF). The control-character
 * ranges are intentional (a linter's no-control-regex rule or autofix must not "fix" them).
 */
const UNSAFE_CHARACTERS = /[\\\s\u0000-\u001f\u007f-\u009f\u00ad\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff\uff00-\uffef]/;

/**
 * The only way a base URL is ever printed (errors, `--dry-run`, `--show-prompt`). Whether a
 * username, password, query or fragment is present is decided by parsing, not by a pattern: `#`, `?`
 * and `@` can all appear inside a password, so no regex can tell where credentials end. If the
 * string parses as a web URL with a host, only protocol, host and path are shown (just protocol and
 * host with `path: false`, for messages where the path adds nothing), followed by a note of what was
 * removed. If it does not parse, parses into something that is not a web URL, or fails the
 * `UNSAFE_CHARACTERS` pre-check, none of it is shown. The path is kept as the parser normalises it (it identifies the
 * endpoint, so a key does not belong in it), and a key typed as the host prints as a lowercased host.
 */
export function redactUrl(raw: string, { path = true }: { path?: boolean } = {}): string {
  if (UNSAFE_CHARACTERS.test(raw)) return HIDDEN;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return HIDDEN;
  }
  if (!SHOWN_SCHEMES.includes(parsed.protocol) || parsed.host === "") return HIDDEN;
  const removed = [
    parsed.username || parsed.password ? "credentials" : "",
    parsed.search.length > 1 ? "query" : "",
    parsed.hash.length > 1 ? "fragment" : "",
  ].filter(Boolean);
  return `${parsed.protocol}//${parsed.host}${path ? parsed.pathname : ""}${removed.length > 0 ? ` (removed: ${removed.join(", ")})` : ""}`;
}

const NOT_A_BASE_URL = "must start with http:// or https://, such as http://localhost:11434/v1";
const NEEDS_SLASHES = "must be written http://host or https://host (the scheme, then exactly two slashes, then the host)";

const url = (raw: unknown) => {
  if (typeof raw !== "string") return { error: NOT_A_BASE_URL };
  // The SDK appends `/chat/completions` after whatever the URL ends with, so a query or fragment would swallow it; and a key must not be in the URL anyway.
  if (/[?#]/.test(raw)) return { error: "must not contain a query or fragment (the request path is added after the URL, and keys go in an environment variable, not in the URL)" };
  // The same characters redactUrl refuses to print: the parser would rewrite them, so the URL used would not be the one written.
  if (UNSAFE_CHARACTERS.test(raw)) return { error: "must not contain backslashes, spaces, or control or invisible characters" };
  if (!/^https?:/i.test(raw)) return { error: NOT_A_BASE_URL };
  // `scheme://host` with a real host: not `http:host`, `http:/h`, `http:////h` or `http:///x`, which the parser repairs into a different-looking URL.
  if (!/^https?:\/\/[^/\s]/i.test(raw)) return { error: NEEDS_SLASHES };
  const afterSlashes = raw.slice(raw.indexOf("//") + 2);
  const authority = afterSlashes.split("/")[0] ?? "";
  // Anything before an `@` in the authority is userinfo, even when empty (`http://@h`).
  if (authority.includes("@")) return { error: "must not contain a username or password; put the key in an environment variable (key_env), not in the URL" };
  // A pasted sentence or bracket: `http://x/v1.` and `http://x/v1)` would be requested as written and 404. (A trailing dot on the host itself is a valid name, so only the path is checked.)
  const path = afterSlashes.slice(authority.length);
  const stray = /[.,;)\]>'"]$/.exec(path)?.[0];
  if (stray) return { error: `must not end with stray punctuation: it ends with "${stray}" (pasted from a sentence or a bracket?)` };
  try {
    const { protocol, username, password } = new URL(raw);
    // fetch refuses such a URL, and stripping it would send the request without credentials the user thought they gave.
    if (username || password) return { error: "must not contain a username or password; put the key in an environment variable (key_env), not in the URL" };
    if (protocol === "http:" || protocol === "https:") return { value: raw };
  } catch {
    // falls through to the error
  }
  return { error: NOT_A_BASE_URL };
};

const text = (what: string): Def<"model">["parse"] => (raw) =>
  typeof raw === "string" && raw !== "" ? { value: raw } : { error: `${what} must be a non-empty string` };

/**
 * Prefixes real API keys start with (`sk-`, `ghp_`, `AIza`...), in the case real keys use (a variable is SHOUTING_CASE). A name that starts like one is a pasted key: the
 * letters, digits and underscores of many keys also make a valid variable name, so shape alone cannot tell them apart.
 */
const KEY_PREFIX = /^(sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[a-z]|gsk|hf)[-_]|^(AIza|AKIA)/;

/** A variable name, not a key: a pasted key would otherwise be echoed back in the "not set" error, or written to the config file. */
const envName = (raw: unknown) => {
  const ok =
    typeof raw === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(raw) &&
    raw.length <= 64 &&
    !KEY_PREFIX.test(raw) &&
    // Mixed case with digits (`Xk9aQ2...`) is how a token looks; variable names are SHOUTING_CASE or lowercase words.
    !(/[a-z]/.test(raw) && /[A-Z]/.test(raw) && /[0-9]/.test(raw));
  return ok ? { value: raw } : { error: "must be the NAME of an environment variable (letters, digits and underscores), not the key itself" };
};

const budget = (raw: unknown) => {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && isValidBudget(n) ? { value: n } : { error: "must be a whole number of characters above 0" };
};

const contextWindow = (raw: unknown) => {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && isValidContextWindow(n) ? { value: n } : { error: "must be a whole number of tokens above 0" };
};

const level = (raw: unknown) =>
  typeof raw === "string" && isLevel(raw) ? { value: raw } : { error: `must be one of: ${LEVELS.join(", ")}` };

/** A directory setting: `~`, `~/...` or an absolute path. A relative one would mean "wherever learn happens to run", which is often a project; `~user` is not expanded, so it would be read as a relative name. */
const dir = (raw: unknown, home: string) => {
  if (typeof raw !== "string" || raw === "") return { error: "must be a non-empty path" };
  if (raw === "~") return { value: home };
  if (raw.startsWith("~/")) return { value: `${home}/${raw.slice(2)}` };
  if (isAbsolute(raw)) return { value: raw };
  return { error: "must be an absolute path or start with ~/ (a relative path would put notes in whatever folder you run learn from, possibly a project)" };
};

const DEFS: readonly Def<keyof ResolvedSettings>[] = [
  { key: "level", flag: "level", flagName: "--level", env: "LEARN_LEVEL", config: ["level"], parse: level },
  { key: "contextBudget", flag: "contextBudget", flagName: "--context-budget", env: "LEARN_CONTEXT_BUDGET", config: ["context_budget"], parse: budget },
  { key: "contextWindow", flag: "contextWindow", flagName: "--context-window", env: "LEARN_CONTEXT_WINDOW", config: ["context_window"], parse: contextWindow },
  { key: "baseUrl", flag: "baseUrl", flagName: "--base-url", env: "LEARN_BASE_URL", config: ["provider", "base_url"], parse: url, show: (raw) => redactUrl(raw, { path: false }) },
  { key: "model", flag: "model", flagName: "--model", env: "LEARN_MODEL", config: ["provider", "model"], parse: text("a model name") },
  { key: "keyEnv", config: ["provider", "key_env"], parse: envName },
  { key: "notesDir", config: ["notes_dir"], parse: dir },
];

/** Checks one typed answer (for `learn init`) with the very parser the config reader uses, so a value the wizard accepts is a value the file can hold. */
export function validateSetting(key: "level" | "baseUrl" | "model" | "keyEnv" | "notesDir", raw: string, home: string): { value: unknown } | { error: string } {
  const def = DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`unknown setting ${key}`);
  return def.parse(raw, home);
}

/** Reads TOML text; a syntax error names the file. */
export function parseConfig(source: string, file: string): Config {
  try {
    return { file, values: parse(source) };
  } catch (err) {
    // The parser's full message quotes the offending source line, which could be a secret: only its position and reason are kept.
    const e = err as { line?: number; column?: number; message?: string };
    const reason = (e.message ?? "").split("\n")[0]?.replace(/^Invalid TOML document: /, "") ?? "";
    const where = e.line === undefined ? "" : ` at line ${e.line}, column ${e.column}`;
    throw new UsageError(`${file}: not valid TOML${where}: ${reason}`);
  }
}

export const trimEnds = (value: string | undefined) => value?.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");

const at = (values: Record<string, unknown>, path: readonly string[]): unknown =>
  path.reduce<unknown>((v, k) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>)[k] : undefined), values);

/** Safety flags: they widen what is read or sent, so only a command-line flag may turn them on. */
const FLAG_ONLY = [
  { flag: "--root", env: "LEARN_ROOT", key: "root" },
  { flag: "--allow-sensitive", env: "LEARN_ALLOW_SENSITIVE", key: "allow_sensitive" },
] as const;

type FlagOnly = (typeof FLAG_ONLY)[number];

/** One wording for a flag-only setting found where only a flag is honoured. `where` names the variable or the file key. */
const flagOnlyWarning = (f: FlagOnly, where: string) => `warning: ${where} is ignored; ${f.flag} is a flag only, so a persistent setting cannot widen access`;

/** A config key that no setting uses: a flag-only name gets the flag-only wording, anything else is a typo to name. */
function unknownKeyWarning(key: string, file: string): string {
  const f = FLAG_ONLY.find((x) => x.key === key);
  return f ? flagOnlyWarning(f, `"${key}" in ${file}`) : `warning: unknown key "${key}" in ${file}; ignored`;
}

/** Dotted names of config keys that no setting uses. */
function unknownKeys(values: Record<string, unknown>): string[] {
  const known = DEFS.map((d) => d.config);
  const walk = (obj: Record<string, unknown>, prefix: string[]): string[] =>
    Object.entries(obj).flatMap(([k, v]) => {
      const path = [...prefix, k];
      if (known.some((c) => c.length === path.length && c.every((p, i) => p === path[i]))) return [];
      const isTable = typeof v === "object" && v !== null && !Array.isArray(v);
      if (isTable && known.some((c) => c.length > path.length && path.every((p, i) => p === c[i]))) return walk(v as Record<string, unknown>, path);
      return [path.join(".")];
    });
  return walk(values, []);
}

export interface ResolveInput {
  flags: Flags;
  env: Record<string, string | undefined>;
  config?: Config;
  home: string;
}

/**
 * Precedence for every setting: flag, then environment, then config file, then default. One loop
 * over one table, so no setting has its own copy of the rule. An empty environment variable
 * counts as unset. An invalid value is an error that names where it came from.
 */
export interface Resolution {
  settings: ResolvedSettings;
  /** One line each, for stderr: unknown keys and flag-only settings found in a file or variable. */
  warnings: string[];
}

export function resolveSettings({ flags, env, config, home }: ResolveInput): Resolution {
  const out: Record<string, unknown> = { level: DEFAULT_LEVEL, notesDir: `${home}/learn-notes` };
  for (const def of DEFS) {
    const candidates: [Where, unknown][] = [];
    // A flag or variable often arrives with a stray newline (`$(cat file)`, a pasted line): trimmed, so it is not mistaken for part of the value. A config value is taken as written.
    if (def.flag && def.flagName) candidates.push([{ kind: "flag", label: def.flagName }, trimEnds(flags[def.flag])]);
    if (def.env) candidates.push([{ kind: "env", label: def.env }, trimEnds(env[def.env])]);
    if (config) candidates.push([{ kind: "config", label: `"${def.config.join(".")}" in ${config.file}` }, at(config.values, def.config)]);
    // One rule for every setting and source: an empty string is the same as not set.
    const found = candidates.find(([, v]) => v !== undefined && v !== "");
    if (!found) continue;
    const [where, raw] = found;
    const result = def.parse(raw, home);
    if ("error" in result) {
      const subject = where.kind === "config" ? `invalid ${where.label}` : `invalid ${where.label} "${typeof raw === "string" && def.show ? def.show(raw) : String(raw)}"`;
      throw new UsageError(`${subject}: ${result.error}`);
    }
    out[def.key] = result.value;
  }
  const warnings = [
    ...FLAG_ONLY.filter((f) => env[f.env] !== undefined && env[f.env] !== "").map((f) => flagOnlyWarning(f, f.env)),
    ...(config ? unknownKeys(config.values).map((k) => unknownKeyWarning(k, config.file)) : []),
  ];
  return { settings: out as unknown as ResolvedSettings, warnings };
}

/**
 * Why a required setting is missing, derived from the same table the resolver walks, so the
 * sources named here cannot drift from the sources actually consulted.
 */
export function describeMissing(key: "baseUrl" | "model", config: Config | undefined, file: string): string {
  const def = DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`unknown setting ${key}`);
  const inFile = config ? `"${def.config.join(".")}" in ${file}` : `${file} (no such file)`;
  const what = key === "baseUrl" ? "base URL" : "model";
  return `no ${what} set (looked at ${def.flagName}, ${def.env}, then ${inFile}; an empty value counts as not set)`;
}

/** `$XDG_CONFIG_HOME/learn/config.toml` when that is an absolute path, else `~/.config/learn/config.toml`. Never relative to the project. */
export function configPath(env: Record<string, string | undefined>, home: string): string {
  const xdg = env.XDG_CONFIG_HOME;
  return `${xdg?.startsWith("/") ? xdg : `${home}/.config`}/learn/config.toml`;
}

/** An example config. Real TOML: every provider block is commented out, so the user enables one. */
export const EXAMPLE_CONFIG = `level = "intermediate"
notes_dir = "~/learn-notes"

# For a local model in --chat: its context window in tokens (Ollama's default is about 4096 below 24 GiB of VRAM).
# Raise it here after raising it in Ollama; a longer chat is then kept before old turns are dropped.
# context_window = 4096

# Provider: uncomment exactly ONE of the blocks below. They are alternatives to each other.

# Alternative 1: Ollama, local and free
# [provider]
# base_url = "http://localhost:11434/v1"
# model = "llama3.1"

# Alternative 2: OpenAI (the key stays in your environment, never in this file)
# [provider]
# base_url = "https://api.openai.com/v1"
# model = "gpt-4o-mini"
# key_env = "OPENAI_API_KEY"`;

/** Shown when there is no config file yet. */
export const firstRunMessage = (file: string): string =>
  `No config file at ${file}. Settings can also come from flags or LEARN_BASE_URL, LEARN_MODEL, LEARN_LEVEL, LEARN_CONTEXT_BUDGET and LEARN_CONTEXT_WINDOW.
To create one, save this there (uncomment one "Alternative" block; they are alternatives to each other, not additions):

${EXAMPLE_CONFIG}`;
