import { parse } from "smol-toml";
import { UsageError } from "./errors.js";
import { DEFAULT_LEVEL, LEVELS, isLevel } from "./prompt.js";
import type { Level } from "./prompt.js";
import { isValidBudget } from "./budget.js";

/** What the user can set. Provider and model go through the same table as level, so precedence is written once. */
export interface ResolvedSettings {
  baseUrl?: string;
  model?: string;
  level: Level;
  contextBudget?: number;
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

/** Backslashes, whitespace and control characters: the parser silently turns `\` into `/` and drops tabs and newlines, which can move a pasted key into the host. */
const UNSAFE_CHARACTERS = /[\\\s\u0000-\u001f\u007f]/;

/**
 * The only way a base URL is ever printed (errors, `--dry-run`, `--show-prompt`). It cannot be
 * done with a pattern: `#`, `?` and `@` can all appear inside a password, so no regex can tell where
 * credentials end. So the string is parsed. If it parses as a web URL with a host, only protocol,
 * host and path are shown, followed by a note of what was removed (credentials, query, fragment).
 * If it does not parse, parses into something that is not a web URL, or holds a character the
 * parser would quietly rewrite, none of it is shown.
 */
export function redactUrl(raw: string): string {
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
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${removed.length > 0 ? ` (removed: ${removed.join(", ")})` : ""}`;
}

const NOT_A_BASE_URL = "must be an http or https URL, such as http://localhost:11434/v1";

const url = (raw: unknown) => {
  if (typeof raw !== "string") return { error: NOT_A_BASE_URL };
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

const budget = (raw: unknown) => {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && isValidBudget(n) ? { value: n } : { error: "must be a whole number of characters above 0" };
};

const level = (raw: unknown) =>
  typeof raw === "string" && isLevel(raw) ? { value: raw } : { error: `must be one of: ${LEVELS.join(", ")}` };

const dir = (raw: unknown, home: string) =>
  typeof raw === "string" && raw !== "" ? { value: raw === "~" ? home : raw.startsWith("~/") ? `${home}/${raw.slice(2)}` : raw } : { error: "must be a non-empty path" };

const DEFS: readonly Def<keyof ResolvedSettings>[] = [
  { key: "level", flag: "level", flagName: "--level", env: "LEARN_LEVEL", config: ["level"], parse: level },
  { key: "contextBudget", flag: "contextBudget", flagName: "--context-budget", env: "LEARN_CONTEXT_BUDGET", config: ["context_budget"], parse: budget },
  { key: "baseUrl", flag: "baseUrl", flagName: "--base-url", env: "LEARN_BASE_URL", config: ["provider", "base_url"], parse: url, show: redactUrl },
  { key: "model", flag: "model", flagName: "--model", env: "LEARN_MODEL", config: ["provider", "model"], parse: text("a model name") },
  { key: "keyEnv", config: ["provider", "key_env"], parse: text("a variable name") },
  { key: "notesDir", config: ["notes_dir"], parse: dir },
];

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
    if (def.flag && def.flagName) candidates.push([{ kind: "flag", label: def.flagName }, flags[def.flag]]);
    if (def.env) candidates.push([{ kind: "env", label: def.env }, env[def.env]]);
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
  `No config file at ${file}. Settings can also come from flags or LEARN_BASE_URL, LEARN_MODEL, LEARN_LEVEL and LEARN_CONTEXT_BUDGET.
To create one, save this there (uncomment one "Alternative" block; they are alternatives to each other, not additions):

${EXAMPLE_CONFIG}`;
