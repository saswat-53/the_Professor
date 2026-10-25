import { describe, expect, it } from "vitest";
import { INIT_PRESETS, parseConfig, renderConfig, resolveSettings, validateSetting } from "../src/core/index.js";

const home = "/home/u";

describe("renderConfig", () => {
  it("round-trips through the config reader to the same settings", () => {
    const answers = { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyEnv: "OPENAI_API_KEY", level: "beginner", notesDir: "~/learn-notes" } as const;
    const { settings, warnings } = resolveSettings({ flags: {}, env: {}, config: parseConfig(renderConfig(answers), "c.toml"), home });
    expect(warnings).toEqual([]);
    expect(settings).toMatchObject({ ...answers, notesDir: `${home}/learn-notes` });
  });

  it("omits key_env when there is none, and keeps a carried-over context budget", () => {
    const text = renderConfig({ baseUrl: "http://localhost:11434/v1", model: "llama3.1", level: "intermediate", notesDir: "~/n", contextBudget: 5000 });
    expect(text).not.toMatch(/^key_env/m);
    expect(resolveSettings({ flags: {}, env: {}, config: parseConfig(text, "c.toml"), home }).settings.contextBudget).toBe(5000);
  });

  it("escapes values, so a quote or newline cannot add a key", () => {
    const text = renderConfig({ baseUrl: "http://h/v1", model: 'm"\nlevel = "expert', level: "intermediate", notesDir: "~/n" });
    const config = parseConfig(text, "c.toml");
    expect(config.values.level).toBe("intermediate");
    expect((config.values.provider as { model: string }).model).toBe('m"\nlevel = "expert');
  });

  it("says the key never goes in the file", () => {
    expect(renderConfig({ baseUrl: "http://h/v1", model: "m", level: "expert", notesDir: "~/n" })).toMatch(/^# .*never/im);
  });
});

describe("validateSetting", () => {
  it("accepts what the config reader accepts", () => {
    expect(validateSetting("level", "expert", home)).toEqual({ value: "expert" });
    expect(validateSetting("notesDir", "~/x", home)).toEqual({ value: "/home/u/x" });
  });
  it("rejects with the reader's reason, and never echoes the value", () => {
    const secret = "sk-SECRET-123";
    for (const key of ["keyEnv", "baseUrl", "level"] as const) {
      const r = validateSetting(key, secret, home);
      expect("error" in r && r.error).toBeTruthy();
      expect(JSON.stringify(r)).not.toContain(secret);
    }
  });
});

describe("presets", () => {
  it("ollama is local and keyless; openai names its key variable", () => {
    expect(INIT_PRESETS.ollama).toMatchObject({ baseUrl: "http://localhost:11434/v1" });
    expect(INIT_PRESETS.ollama.keyEnv).toBeUndefined();
    expect(INIT_PRESETS.openai.keyEnv).toBe("OPENAI_API_KEY");
  });
  it("every preset passes the same validation as a typed answer", () => {
    for (const p of Object.values(INIT_PRESETS)) {
      if (p.baseUrl) expect(validateSetting("baseUrl", p.baseUrl, home)).toHaveProperty("value");
    }
  });
});
