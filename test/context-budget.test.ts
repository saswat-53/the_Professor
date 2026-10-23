import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContextTooLongError, ExitCode } from "../src/core/errors.js";
import { buildRequest } from "../src/core/explain.js";
import { defaultBudget } from "../src/core/budget.js";
import { run } from "./support/cli.js";

const hosted = { baseUrl: "https://api.example.com/v1", model: "m" };
const local = { baseUrl: "http://localhost:11434/v1", model: "m" };

/** A project whose file has `header` lines, then lines `l01`..`lNN`: every one 3 characters, 4 with its newline. */
async function project(name: string, header: string[], total: number) {
  const dir = await mkdtemp(join(tmpdir(), "learn-budget-"));
  await mkdir(join(dir, ".git"));
  const body = Array.from({ length: total }, (_, i) => `l${String(i + 1).padStart(2, "0")}`);
  await writeFile(join(dir, name), [...header, ...body].join("\n") + "\n");
  return dir;
}

/** The numbers of all the `lNN` lines the request sends, Excerpt included, in order. */
const sent = (user: string) => [...user.matchAll(/^l(\d\d)$/gm)].map((m) => Number(m[1])).sort((a, b) => a - b);

describe("default budget", () => {
  it("is 24,000 characters for hosted endpoints and 8,000 for localhost, 127.0.0.1 and ::1", () => {
    expect(defaultBudget("https://api.openai.com/v1")).toBe(24_000);
    expect(defaultBudget("http://localhost:11434/v1")).toBe(8_000);
    expect(defaultBudget("http://127.0.0.1:1234/v1")).toBe(8_000);
    expect(defaultBudget("http://[::1]:1234/v1")).toBe(8_000);
    expect(defaultBudget("http://localhost.evil.example/v1")).toBe(24_000);
  });

  it("applies to a real request: a hosted run keeps what a local run drops", async () => {
    const dir = await project("a.txt", [], 1);
    await writeFile(join(dir, "b.txt"), Array.from({ length: 6 }, () => "x".repeat(2_000)).join("\n") + "\n");
    const kept = (await buildRequest({ reference: "b.txt:3", cwd: dir, settings: hosted })).user;
    const dropped = (await buildRequest({ reference: "b.txt:3", cwd: dir, settings: local })).user;
    expect(kept.match(/x{2000}/g)).toHaveLength(6);
    expect(dropped.match(/x{2000}/g)!.length).toBeLessThan(6);
  });
});

describe("trimming to the budget", () => {
  // Budget 40: the Excerpt (l50, 3 characters) leaves 37, room for nine 4-character lines.
  it("drops the lines farthest from the Excerpt first, keeping both sides contiguous", async () => {
    const dir = await project("a.txt", [], 99);
    const { user } = await buildRequest({ reference: "a.txt:50", cwd: dir, settings: { ...hosted, contextBudget: 40 } });
    expect(sent(user)).toEqual([45, 46, 47, 48, 49, 50, 51, 52, 53, 54]);
    expect(user).toContain("lines 45-49)");
    expect(user).toContain("lines 51-54)");
  });

  it("keeps a Context that costs exactly the budget and drops a line when one character short", async () => {
    const dir = await project("a.txt", [], 99);
    // Excerpt 3 + ten Context lines at 4 = 43 exactly.
    const exact = (await buildRequest({ reference: "a.txt:50", cwd: dir, settings: { ...hosted, contextBudget: 43 } })).user;
    expect(sent(exact)).toHaveLength(11);
    const short = (await buildRequest({ reference: "a.txt:50", cwd: dir, settings: { ...hosted, contextBudget: 42 } })).user;
    expect(sent(short)).toHaveLength(10);
  });

  it("changes nothing when the Context fits", async () => {
    const dir = await project("a.txt", [], 99);
    const { user } = await buildRequest({ reference: "a.txt:50", cwd: dir, settings: { ...hosted, contextBudget: 4_000 } });
    expect(sent(user)).toHaveLength(51);
  });

  it("trims inside an Enclosing block too", async () => {
    const dir = await project("a.txt", [], 99);
    const { user } = await buildRequest({
      reference: "a.txt:50",
      cwd: dir,
      settings: { ...hosted, contextBudget: 40 },
      blockFinder: { name: "fixed", find: () => ({ start: 10, end: 90 }) },
    });
    expect(sent(user)).toEqual([45, 46, 47, 48, 49, 50, 51, 52, 53, 54]);
    expect(user).toContain("Enclosing block, lines before the Excerpt (a.txt lines 45-49)");
  });

  it("keeps all of one side when the other side is short", async () => {
    const dir = await project("a.txt", [], 99);
    const { user } = await buildRequest({ reference: "a.txt:2", cwd: dir, settings: { ...hosted, contextBudget: 40 } });
    // Nearest first, ties before the Excerpt: l01, l03, l04 ... l10 are nine lines.
    expect(sent(user)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("drops the imports first, whole, when everything does not fit", async () => {
    const imports = ['import {', "  a,", "  b,", '} from "./x";'];
    const dir = await project("a.ts", imports, 99);
    // The imports cost 32; the 50-line window costs 200. Budget 60 leaves 57: fourteen lines.
    const { user } = await buildRequest({ reference: "a.ts:54", cwd: dir, settings: { ...hosted, contextBudget: 60 } });
    expect(user).not.toContain("Imports (");
    expect(user).not.toContain("import {");
    expect(sent(user)).toEqual([43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57]);
  });

  it("keeps the imports whole when everything fits", async () => {
    const dir = await project("a.ts", ['import a from "./a";'], 99);
    const { user } = await buildRequest({ reference: "a.ts:80", cwd: dir, settings: { ...hosted, contextBudget: 400 } });
    expect(user).toContain('import a from "./a";');
  });

  it("drops straddling imports whole and shrinks the nearby lines back to their normal span", async () => {
    const imports = ["import {", "  alpha,", "  beta,", '} from "./x";'];
    const dir = await project("a.ts", imports, 99);
    // Excerpt at line 29 (l25): the window starts at line 4, inside the import, so it grows up to line 1.
    const wide = (await buildRequest({ reference: "a.ts:29", cwd: dir, settings: { ...hosted, contextBudget: 400 } })).user;
    expect(wide).toContain("lines 1-28)");
    // With the imports the Context costs 236 characters, without them 196: budget 225 leaves 221.
    const { user } = await buildRequest({ reference: "a.ts:29", cwd: dir, settings: { ...hosted, contextBudget: 225 } });
    expect(user).not.toContain("alpha");
    expect(user).not.toContain("beta");
    expect(user).not.toContain("import {");
    expect(user).toContain("lines 5-28)");
    expect(user).toContain("lines 30-54)");
  });
});

describe("Excerpt limit", () => {
  it("never trims the Excerpt: up to half the budget is accepted", async () => {
    const dir = await project("a.txt", [], 99);
    // Lines 10-14 are 19 characters; half of 38 is 19.
    const { user } = await buildRequest({ reference: "a.txt:10-14", cwd: dir, settings: { ...hosted, contextBudget: 38 } });
    expect(user).toContain("l10\nl11\nl12\nl13\nl14");
  });

  it("refuses an Excerpt over half the budget with ContextTooLongError and a narrowing hint", async () => {
    const dir = await project("a.txt", [], 99);
    const err = await buildRequest({ reference: "a.txt:10-14", cwd: dir, settings: { ...hosted, contextBudget: 37 } }).catch((e) => e);
    expect(err).toBeInstanceOf(ContextTooLongError);
    expect(err.exitCode).toBe(ExitCode.Refused);
    expect(err.message).toMatch(/narrow your range/i);
    expect(err.message).toContain("19");
    expect(err.message).toContain("37");
  });

  it("refuses a minified single-line file with the same message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-budget-"));
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, "app.min.js"), "var a=1;".repeat(2_000));
    for (const reference of ["app.min.js", "app.min.js:1"]) {
      const err = await buildRequest({ reference, cwd: dir, settings: local }).catch((e) => e);
      expect(err).toBeInstanceOf(ContextTooLongError);
      expect(err.message).toMatch(/narrow your range/i);
    }
  });

  it("refuses a minified file at the default budgets, saying which budget and how to raise it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-budget-"));
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, "app.min.js"), "var a=1;".repeat(2_000));
    const hostedErr = await buildRequest({ reference: "app.min.js", cwd: dir, settings: hosted }).catch((e) => e);
    expect(hostedErr).toBeInstanceOf(ContextTooLongError);
    expect(hostedErr.message).toContain("24,000-character budget (hosted default)");
    expect(hostedErr.message).toMatch(/narrow your range/i);
    const localErr = await buildRequest({ reference: "app.min.js", cwd: dir, settings: local }).catch((e) => e);
    expect(localErr.message).toContain("8,000-character budget (local default)");
    const r = await run(["app.min.js", "--dry-run"], { LEARN_BASE_URL: local.baseUrl, LEARN_MODEL: "m" }, dir);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("--context-budget");
  });

  it("measures the default budget for the endpoint: 5,000 characters pass hosted and fail local", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-budget-"));
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, "a.txt"), "y".repeat(5_000) + "\n");
    await expect(buildRequest({ reference: "a.txt", cwd: dir, settings: hosted })).resolves.toBeDefined();
    await expect(buildRequest({ reference: "a.txt", cwd: dir, settings: local })).rejects.toBeInstanceOf(ContextTooLongError);
  });
});

describe("CLI", () => {
  const env = { LEARN_BASE_URL: "http://127.0.0.1:9/v1", LEARN_MODEL: "m" };

  it("exits 3 with the hint when the Excerpt is over budget, before contacting the model", async () => {
    const dir = await project("a.txt", [], 99);
    const r = await run(["a.txt:10-14", "--context-budget", "37", "--dry-run"], env, dir);
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/narrow your range/i);
  });

  it("accepts --context-budget and trims accordingly", async () => {
    const dir = await project("a.txt", [], 99);
    const r = await run(["a.txt:50", "--context-budget", "40", "--dry-run"], env, dir);
    expect(r.code).toBe(0);
    expect(sent(r.stderr)).toEqual([45, 46, 47, 48, 49, 50, 51, 52, 53, 54]);
  });

  it.each(["0", "-5", "abc", "1.5"])("rejects --context-budget %s as a usage error", async (value) => {
    const dir = await project("a.txt", [], 9);
    const r = await run(["a.txt:5", "--context-budget", value, "--dry-run"], env, dir);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--context-budget");
  });
});

describe("core validation", () => {
  it.each([0, -1, 1.5, Number.NaN])("rejects a budget of %s as a usage error", async (contextBudget) => {
    const dir = await project("a.txt", [], 9);
    const err = await buildRequest({ reference: "a.txt:5", cwd: dir, settings: { ...hosted, contextBudget } }).catch((e) => e);
    expect(err.exitCode).toBe(ExitCode.Usage);
  });
});
