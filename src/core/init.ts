import { stringify } from "smol-toml";
import type { Level } from "./prompt.js";
import type { ModelRequest } from "./types.js";

/** What the wizard asks for. The key itself is never one of them: only the NAME of the variable that holds it. */
export interface InitAnswers {
  baseUrl: string;
  model: string;
  keyEnv?: string;
  level: Level;
  /** As typed, with `~` unexpanded, so the file stays portable. */
  notesDir: string;
  /** Carried over from an existing file; the wizard does not ask about it. */
  contextBudget?: number;
}

/** A starting point for the provider questions. Every field is only a default the user can overwrite. */
export interface InitPreset {
  label: string;
  baseUrl?: string;
  model?: string;
  keyEnv?: string;
}

export type PresetName = "ollama" | "openai" | "other";

export const INIT_PRESETS: Record<PresetName, InitPreset> = {
  ollama: { label: "Ollama (local, free)", baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyEnv: "OPENAI_API_KEY" },
  other: { label: "Another OpenAI-compatible endpoint" },
};

/** The config file's text. TOML is produced by the library, so a quote or newline in an answer is escaped rather than able to add a key. */
export function renderConfig(a: InitAnswers): string {
  const provider: Record<string, string> = { base_url: a.baseUrl, model: a.model };
  if (a.keyEnv) provider.key_env = a.keyEnv;
  const body = stringify({
    level: a.level,
    notes_dir: a.notesDir,
    ...(a.contextBudget === undefined ? {} : { context_budget: a.contextBudget }),
    provider,
  });
  return `# Written by \`learn init\`. Edit freely.\n# The API key never goes in this file: key_env names the environment variable that holds it.\n\n${body}\n`;
}

/** The smallest request that proves the endpoint, model and key work. */
export function testRequest(a: Pick<InitAnswers, "baseUrl" | "model">): ModelRequest {
  return { baseUrl: a.baseUrl, model: a.model, system: "You are a connectivity check. Reply with one word.", user: "Reply with the word: ready" };
}
