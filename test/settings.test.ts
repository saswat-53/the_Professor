import { stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { UsageError } from "../src/core/errors.js";
import { EXAMPLE_CONFIG, describeMissing, configPath, firstRunMessage, parseConfig, resolveSettings } from "../src/core/settings.js";

const FILE = "/home/u/.config/learn/config.toml";
const resolve = (flags = {}, env = {}, toml?: string) =>
  resolveSettings({ flags, env, config: toml === undefined ? undefined : parseConfig(toml, FILE), home: "/home/u" });

/** Builds `{ provider: { model: "x" } }` from a path, so a config is assembled as data and serialized, not written as text. */
const nest = (path: readonly string[], value: unknown): Record<string, unknown> =>
  path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>;
const tomlOf = (path: readonly string[], value: unknown) => `${stringify(nest(path, value))}\n`;

/** Every setting: where each source puts it, the value each gives, and the default when none is given. */
const SETTINGS = [
  { key: "level", flag: ["level", "beginner"], env: ["LEARN_LEVEL", "expert"], cfg: [["level"], "intermediate"], dflt: "intermediate" },
  { key: "model", flag: ["model", "f"], env: ["LEARN_MODEL", "e"], cfg: [["provider", "model"], "c"], dflt: undefined },
  { key: "baseUrl", flag: ["baseUrl", "http://f/v1"], env: ["LEARN_BASE_URL", "http://e/v1"], cfg: [["provider", "base_url"], "http://c/v1"], dflt: undefined },
  { key: "contextBudget", flag: ["contextBudget", "100"], env: ["LEARN_CONTEXT_BUDGET", "200"], cfg: [["context_budget"], 300], dflt: undefined },
] as const;

/** What the setting resolves to when its value arrives from that source (a budget flag or variable is text, the resolved value a number). */
const resolved = (key: string, value: unknown) => (key === "contextBudget" ? Number(value) : value);

describe("precedence: flag, then environment, then config file, then default (every setting, every combination of sources)", () => {
  for (const c of SETTINGS) {
    const sources = [
      { id: "flag", flags: { [c.flag[0]]: c.flag[1] }, env: {}, toml: undefined, want: resolved(c.key, c.flag[1]) },
      { id: "env", flags: {}, env: { [c.env[0]]: c.env[1] }, toml: undefined, want: resolved(c.key, c.env[1]) },
      { id: "config", flags: {}, env: {}, toml: tomlOf(c.cfg[0], c.cfg[1]), want: c.cfg[1] },
    ];
    for (let mask = 0; mask < 8; mask++) {
      const used = sources.filter((_, i) => mask & (1 << i));
      const label = used.length === 0 ? "none -> default" : `${used.map((u) => u.id).join("+")} -> ${used[0]?.id}`;
      it(`${c.key}: ${label}`, () => {
        const flags = Object.assign({}, ...used.map((u) => u.flags));
        const env = Object.assign({}, ...used.map((u) => u.env));
        const toml = used.find((u) => u.toml !== undefined)?.toml;
        const settings = resolve(flags, env, toml).settings as unknown as Record<string, unknown>;
        expect(settings[c.key]).toBe(used.length === 0 ? c.dflt : used[0]?.want);
      });
    }
  }

  it("notesDir and keyEnv are config-only: a flag or environment variable of the obvious name changes nothing", () => {
    const s = resolve({ notesDir: "/f" } as never, { LEARN_NOTES_DIR: "/e", LEARN_KEY_ENV: "E" }, 'notes_dir = "/c"\n[provider]\nkey_env = "C"\n').settings;
    expect([s.notesDir, s.keyEnv]).toEqual(["/c", "C"]);
  });
  it("level: a config value beats the default (the matrix cannot show it, since its config value is the default)", () => {
    expect(resolve({}, {}, 'level = "expert"\n').settings.level).toBe("expert");
  });
  it("keyEnv comes from the config file only", () => {
    expect(resolve({}, { LEARN_KEY_ENV: "X" }, '[provider]\nkey_env = "MY_KEY"\n').settings.keyEnv).toBe("MY_KEY");
    expect(resolve().settings.keyEnv).toBeUndefined();
  });
});

describe("empty values", () => {
  it.each([
    ["flag", { model: "" }, {}, undefined],
    ["environment", {}, { LEARN_MODEL: "" }, undefined],
    ["config file", {}, {}, '[provider]\nmodel = ""\n'],
  ])("an empty %s value is the same as not set", (_n, flags, env, toml) => {
    expect(resolve(flags, env, toml).settings.model).toBeUndefined();
  });
  it("an empty higher source does not hide a lower one", () => {
    expect(resolve({ model: "" }, { LEARN_MODEL: "" }, '[provider]\nmodel = "c"\n').settings.model).toBe("c");
  });
  it.each(SETTINGS.flatMap((c) => (["flag", "env", "config"] as const).map((source) => [c.key, source, c] as const)))(
    "%s: an empty %s value is unset",
    (_key, source, c) => {
      const flags = source === "flag" ? { [c.flag[0]]: "" } : {};
      const env = source === "env" ? { [c.env[0]]: "" } : {};
      const toml = source === "config" ? tomlOf(c.cfg[0], "") : undefined;
      expect((resolve(flags, env, toml).settings as unknown as Record<string, unknown>)[c.key]).toBe(c.dflt);
    },
  );
  it.each(['[provider]\nkey_env = ""\n', 'notes_dir = ""\n'])("an empty config value is unset: %j", (toml) => {
    const { settings } = resolve({}, {}, toml);
    expect(settings.keyEnv).toBeUndefined();
    expect(settings.notesDir).toBe("/home/u/learn-notes");
  });
  it("applies to every setting, not only model", () => {
    const s = resolve({ level: "" }, { LEARN_CONTEXT_BUDGET: "", LEARN_BASE_URL: "" }, 'context_budget = 5\nnotes_dir = ""\n').settings;
    expect([s.level, s.contextBudget, s.baseUrl, s.notesDir]).toEqual(["intermediate", 5, undefined, "/home/u/learn-notes"]);
  });
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
  it.each([
    ["context_budget", 'context_budget = "big"\n'],
    ["context_budget", "context_budget = 1.5\n"],
    ["context_budget", "context_budget = 0\n"],
    ["level", "level = 3\n"],
    ["provider.model", "[provider]\nmodel = 3\n"],
    ["provider.base_url", '[provider]\nbase_url = "ftp://h/v1"\n'],
    ["notes_dir", "notes_dir = true\n"],
  ])("a wrong type or value for %s is an error naming the key and file", (key, toml) => {
    expect(() => resolve({}, {}, toml)).toThrow(new RegExp(`"${key}" in .*config\\.toml`));
  });
  it("a TOML syntax error names the file and the position, and not the offending line", () => {
    const run = () => parseConfig('a = 1\napi_key = "sk-SECRET123" oops\n', FILE);
    expect(run).toThrow(UsageError);
    expect(run).toThrow(/config\.toml: not valid TOML at line 2, column \d+: /);
    try {
      run();
    } catch (err) {
      expect((err as Error).message).not.toContain("sk-SECRET123");
      expect((err as Error).message).not.toContain("\n");
    }
  });
  it("warns on an unknown key, naming it", () => {
    const { warnings } = resolve({}, {}, 'levle = "expert"\n[provider]\nmodle = "x"\n');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"levle"');
    expect(warnings[1]).toContain('"provider.modle"');
  });
});

describe("secrets never appear in messages", () => {
  it("an unknown key's warning names the key, never the value", () => {
    const { warnings } = resolve({}, {}, 'api_key = "sk-SECRET123"\n');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"api_key"');
    expect(warnings[0]).not.toContain("sk-SECRET123");
  });
  it.each([
    ["flag", { baseUrl: "https://user:pass@host:notaport/v1" }, {}, undefined],
    ["environment", {}, { LEARN_BASE_URL: "ftp://user:pass@host/v1" }, undefined],
    ["config file", {}, {}, '[provider]\nbase_url = "ftp://user:pass@host/v1"\n'],
    ["scheme-less userinfo", { baseUrl: "user:pass@host/v1" }, {}, undefined],
  ])("a rejected base URL from the %s is shown without userinfo", (_n, flags, env, toml) => {
    let message = "";
    try {
      resolve(flags, env, toml);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/base/i);
    expect(message).not.toContain("user:pass");
    expect(message).not.toContain("user:");
  });
  it.each([
    ["flag", { baseUrl: "https://user:pass@host/v1" }, {}, undefined],
    ["environment", {}, { LEARN_BASE_URL: "https://user:pass@host/v1" }, undefined],
    ["config file", {}, {}, '[provider]\nbase_url = "https://user:pass@host/v1"\n'],
    ["username only", { baseUrl: "https://token@host/v1" }, {}, undefined],
  ])("a base URL with credentials from the %s is refused with advice, and shown without them", (_n, flags, env, toml) => {
    const run = () => resolve(flags, env, toml);
    expect(run).toThrow(UsageError);
    expect(run).toThrow(/put the key in an environment variable/);
    if (_n === "config file") expect(run).toThrow(/"provider\.base_url" in \/home\/u\/\.config\/learn\/config\.toml/);
    else expect(run).toThrow(/https?:\/\/host \(removed: credentials\)/);
    try {
      run();
    } catch (err) {
      expect((err as Error).message).not.toMatch(/:pass@|token@/);
    }
  });
});

describe("usual base URLs are accepted exactly as written", () => {
  it.each([
    "http://localhost:11434/v1",
    "https://api.deepseek.com",
    "https://api.openai.com/v1",
    "https://generativelanguage.googleapis.com/v1beta/openai/",
    "http://[::1]:11434/v1",
    "http://127.0.0.1:1234",
    "http://my-host.internal:8080/openai/v1",
  ])("%s", (url) => {
    for (const source of [{ flags: { baseUrl: url }, env: {} }, { flags: {}, env: { LEARN_BASE_URL: url } }]) {
      expect(resolveSettings({ ...source, home: "/h" }).settings.baseUrl).toBe(url);
    }
    expect(resolve({}, {}, `[provider]\nbase_url = "${url}"\n`).settings.baseUrl).toBe(url);
  });
});

describe("safety flags are flags only", () => {
  it("LEARN_ROOT and LEARN_ALLOW_SENSITIVE are ignored, with a warning that names them", () => {
    const { settings, warnings } = resolve({}, { LEARN_ROOT: "/", LEARN_ALLOW_SENSITIVE: "1" });
    expect(Object.keys(settings)).not.toContain("root");
    expect(Object.keys(settings)).not.toContain("allowSensitive");
    expect(warnings.join("\n")).toContain("LEARN_ROOT is ignored");
    expect(warnings.join("\n")).toContain("LEARN_ALLOW_SENSITIVE is ignored");
  });
  it("an empty LEARN_ROOT or LEARN_ALLOW_SENSITIVE is unset, so it does not warn", () => {
    expect(resolve({}, { LEARN_ROOT: "", LEARN_ALLOW_SENSITIVE: "" }).warnings).toEqual([]);
  });
  it("root and allow_sensitive in the config are ignored, with a warning that names them", () => {
    const { settings, warnings } = resolve({}, {}, 'root = "/"\nallow_sensitive = true\n');
    expect(Object.keys(settings)).not.toContain("root");
    expect(Object.keys(settings)).not.toContain("allowSensitive");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/"root".*--root is a flag only/);
    expect(warnings[1]).toMatch(/"allow_sensitive".*--allow-sensitive is a flag only/);
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
    expect(m).toContain(EXAMPLE_CONFIG);
  });
  it("its example is valid TOML as shipped with no live provider block, and uncommenting any one alternative gives exactly one", () => {
    const [head, ...alternatives] = EXAMPLE_CONFIG.split(/\n(?=# Alternative)/);
    expect(alternatives).toHaveLength(2);
    expect(parseConfig(EXAMPLE_CONFIG, FILE).values.provider).toBeUndefined();
    for (const alternative of alternatives) {
      const live = alternative.split("\n").map((l) => (l.startsWith("# ") && !l.startsWith("# Alternative") ? l.slice(2) : l)).join("\n");
      const text = `${head}\n${live}`;
      expect(text.match(/^\[provider\]$/gm)).toHaveLength(1);
      const { values } = parseConfig(text, FILE);
      expect(Object.keys(values.provider as object).sort()).toEqual(expect.arrayContaining(["base_url", "model"]));
      const { warnings, settings } = resolveSettings({ flags: {}, env: {}, config: parseConfig(text, FILE), home: "/h" });
      expect(warnings).toEqual([]);
      expect(settings.baseUrl).toMatch(/^https?:\/\//);
      expect(settings.model).toBeTruthy();
    }
  });
});

describe("describeMissing", () => {
  it("names the sources from the same table the resolver walks", () => {
    expect(describeMissing("model", undefined, FILE)).toBe(`no model set (looked at --model, LEARN_MODEL, then ${FILE} (no such file); an empty value counts as not set)`);
    expect(describeMissing("baseUrl", parseConfig("", FILE), FILE)).toContain(`"provider.base_url" in ${FILE}`);
  });
});
