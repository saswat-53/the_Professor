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
}

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

const DEFS = [
  { key: "level", flag: "level", flagName: "--level", env: "LEARN_LEVEL", config: ["level"], parse: level },
  { key: "contextBudget", flag: "contextBudget", flagName: "--context-budget", env: "LEARN_CONTEXT_BUDGET", config: ["context_budget"], parse: budget },
  { key: "baseUrl", flag: "baseUrl", flagName: "--base-url", env: "LEARN_BASE_URL", config: ["provider", "base_url"], parse: text("a base URL") },
  { key: "model", flag: "model", flagName: "--model", env: "LEARN_MODEL", config: ["provider", "model"], parse: text("a model name") },
  { key: "keyEnv", config: ["provider", "key_env"], parse: text("a variable name") },
  { key: "notesDir", config: ["notes_dir"], parse: dir },
] as const satisfies readonly Def<keyof ResolvedSettings>[];

/** Reads TOML text; a syntax error names the file. */
export function parseConfig(source: string, file: string): Config {
  try {
    return { file, values: parse(source) };
  } catch (err) {
    throw new UsageError(`${file}: not valid TOML: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}

const at = (values: Record<string, unknown>, path: readonly string[]): unknown =>
  path.reduce<unknown>((v, k) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>)[k] : undefined), values);

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
export function resolveSettings({ flags, env, config, home }: ResolveInput): { settings: ResolvedSettings; warnings: string[] } {
  const out: Record<string, unknown> = { level: DEFAULT_LEVEL, notesDir: `${home}/learn-notes` };
  for (const def of DEFS) {
    const candidates: [Where, unknown][] = [];
    if ("flag" in def) candidates.push([{ kind: "flag", label: def.flagName }, flags[def.flag]]);
    if ("env" in def) candidates.push([{ kind: "env", label: def.env }, env[def.env] === "" ? undefined : env[def.env]]);
    if (config) candidates.push([{ kind: "config", label: `"${def.config.join(".")}" in ${config.file}` }, at(config.values, def.config)]);
    const found = candidates.find(([, v]) => v !== undefined);
    if (!found) continue;
    const [where, raw] = found;
    const result = def.parse(raw, home);
    if ("error" in result) {
      const subject = where.kind === "config" ? `invalid ${where.label}` : `invalid ${where.label} "${String(raw)}"`;
      throw new UsageError(`${subject}: ${result.error}`);
    }
    out[def.key] = result.value;
  }
  const warnings = config ? unknownKeys(config.values).map((k) => `warning: unknown key "${k}" in ${config.file}; ignored`) : [];
  return { settings: out as unknown as ResolvedSettings, warnings };
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
