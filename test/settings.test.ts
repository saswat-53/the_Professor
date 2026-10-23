import { describe, expect, it } from "vitest";
import { UsageError } from "../src/core/errors.js";
import { EXAMPLE_CONFIG, configPath, firstRunMessage, parseConfig, resolveSettings } from "../src/core/settings.js";

const FILE = "/home/u/.config/learn/config.toml";
const resolve = (flags = {}, env = {}, toml?: string) =>
  resolveSettings({ flags, env, config: toml === undefined ? undefined : parseConfig(toml, FILE), home: "/home/u" });

describe("precedence: flag, then environment, then config file, then default", () => {
  const cases = [
    { name: "level", flag: { level: "beginner" }, env: { LEARN_LEVEL: "expert" }, toml: 'level = "intermediate"\n', pick: (s: any) => s.level, want: ["beginner", "expert", "intermediate", "intermediate"] },
    { name: "model", flag: { model: "f" }, env: { LEARN_MODEL: "e" }, toml: '[provider]\nmodel = "c"\n', pick: (s: any) => s.model, want: ["f", "e", "c", undefined] },
    { name: "baseUrl", flag: { baseUrl: "http://f/v1" }, env: { LEARN_BASE_URL: "http://e/v1" }, toml: '[provider]\nbase_url = "http://c/v1"\n', pick: (s: any) => s.baseUrl, want: ["http://f/v1", "http://e/v1", "http://c/v1", undefined] },
    { name: "contextBudget", flag: { contextBudget: "100" }, env: { LEARN_CONTEXT_BUDGET: "200" }, toml: "context_budget = 300\n", pick: (s: any) => s.contextBudget, want: [100, 200, 300, undefined] },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(c.pick(resolve(c.flag, c.env, c.toml).settings)).toBe(c.want[0]);
      expect(c.pick(resolve({}, c.env, c.toml).settings)).toBe(c.want[1]);
      expect(c.pick(resolve({}, {}, c.toml).settings)).toBe(c.want[2]);
      expect(c.pick(resolve().settings)).toBe(c.want[3]);
    });
  }
});

describe("validation", () => {
  it("names the flag for a bad flag value", () => {
    expect(() => resolve({ level: "guru" })).toThrow(/--level/);
  });
  it("names the variable for a bad environment value", () => {
    expect(() => resolve({}, { LEARN_CONTEXT_BUDGET: "0" })).toThrow(/LEARN_CONTEXT_BUDGET/);
  });
  it("names the key and the file for a bad config value, as a usage error", () => {
    const run = () => resolve({}, {}, 'level = "guru"\n');
    expect(run).toThrow(UsageError);
    expect(run).toThrow(/"level".*config\.toml/);
  });
  it("rejects a non-integer budget in the config", () => {
    expect(() => resolve({}, {}, 'context_budget = "big"\n')).toThrow(/"context_budget"/);
  });
  it("names the file for TOML that does not parse", () => {
    expect(() => parseConfig("level = = 1", FILE)).toThrow(/config\.toml/);
  });
  it("warns on an unknown key, naming it", () => {
    const { warnings } = resolve({}, {}, 'levle = "expert"\n[provider]\nmodle = "x"\n');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"levle"');
    expect(warnings[1]).toContain('"provider.modle"');
  });
});

describe("notes directory", () => {
  it("expands ~", () => expect(resolve({}, {}, 'notes_dir = "~/n"\n').settings.notesDir).toBe("/home/u/n"));
  it("defaults to ~/learn-notes", () => expect(resolve().settings.notesDir).toBe("/home/u/learn-notes"));
});

describe("config location", () => {
  it("honours an absolute XDG_CONFIG_HOME", () => expect(configPath({ XDG_CONFIG_HOME: "/x" }, "/home/u")).toBe("/x/learn/config.toml"));
  it("ignores a relative XDG_CONFIG_HOME, so a project cannot redirect it", () =>
    expect(configPath({ XDG_CONFIG_HOME: "rel" }, "/home/u")).toBe("/home/u/.config/learn/config.toml"));
  it("falls back to ~/.config", () => expect(configPath({}, "/home/u")).toBe("/home/u/.config/learn/config.toml"));
});

describe("first-run message", () => {
  it("names the file and marks the alternatives as alternatives", () => {
    const m = firstRunMessage(FILE);
    expect(m).toContain(FILE);
    expect(m).toMatch(/alternative/i);
    expect(m).toContain("LEARN_BASE_URL");
  });
  it("its example is valid as shipped, and each alternative works when uncommented alone", () => {
    const blocks = EXAMPLE_CONFIG.split(/\n(?=# Alternative)/).slice(1);
    expect(blocks).toHaveLength(2);
    const base = EXAMPLE_CONFIG.split(/\n(?=# Alternative)/)[0] ?? "";
    for (const block of blocks) {
      const live = block.split("\n").map((l) => (l.startsWith("# ") && !l.startsWith("# Alternative") ? l.slice(2) : l)).join("\n");
      const { warnings, settings } = resolveSettings({ flags: {}, env: {}, config: parseConfig(`${base}\n${live}`, FILE), home: "/h" });
      expect(warnings).toEqual([]);
      expect(settings.model).toBeTruthy();
    }
    expect(resolveSettings({ flags: {}, env: {}, config: parseConfig(EXAMPLE_CONFIG, FILE), home: "/h" }).settings.model).toBeUndefined();
  });
});
