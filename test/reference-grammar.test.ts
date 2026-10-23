import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FileNotFoundError, UsageError } from "../src/core/errors.js";
import { buildRequest } from "../src/core/explain.js";
import { defaultResolvers, resolveReference } from "../src/core/reference.js";

const settings = { baseUrl: "http://h/v1", model: "m" };
let dir: string;
let file: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "learn-ref-"));
  file = join(dir, "five.ts");
  await writeFile(file, "one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n");
});

/** The excerpt text sent to the model, without the "File:" header line and the code fence. */
const userFor = async (reference: string) => {
  const user = (await buildRequest({ reference, settings, root: tmpdir() })).user;
  return user.split("\n").slice(3, -1).join("\n");
};

describe("line and range references", () => {
  it("path:N makes the excerpt that single line", async () => {
    const user = await userFor(`${file}:2`);
    expect(user).toContain("two");
    expect(user).not.toMatch(/one|three/);
  });

  it("path:N-M makes the excerpt lines N to M inclusive, counted after CRLF normalisation", async () => {
    const user = await userFor(`${file}:2-4`);
    expect(user).toContain("two\nthree\nfour");
    expect(user).not.toMatch(/one|five|\r/);
  });

  it("counts a lone CR as a line break, as editors show it", async () => {
    const old = join(dir, "old-mac.txt");
    await writeFile(old, "a\rb\rc\r");
    expect(await userFor(`${old}:2`)).toBe("b");
    const err = await buildRequest({ reference: `${old}:4`, settings, root: tmpdir() }).catch((e) => e);
    expect(err.message).toContain("has 3 lines");
  });

  it("accepts a single-line range and the last line", async () => {
    expect(await userFor(`${file}:3-3`)).toContain("three");
    expect(await userFor(`${file}:5`)).toContain("five");
  });
});

describe("malformed references", () => {
  const cases: [string, string, RegExp][] = [
    ["line 0", `${"FILE"}:0`, /start at 1/],
    ["range starting at 0", `${"FILE"}:0-3`, /start at 1/],
    ["negative number", `${"FILE"}:-3`, /positive/],
    ["non-integer", `${"FILE"}:1.5`, /not a whole number/],
    ["words", `${"FILE"}:abc`, /not a whole number/],
    ["empty spec", `${"FILE"}:`, /missing a line number/],
    ["open-ended range", `${"FILE"}:5-`, /open-ended ranges/],
    ["reversed range", `${"FILE"}:4-2`, /reversed/],
    ["three-part range", `${"FILE"}:1-2-3`, /two ends/],
  ];
  for (const [label, ref, message] of cases) {
    it(`rejects ${label} as a usage error`, async () => {
      const err = await buildRequest({ reference: ref.replace("FILE", file), settings, root: tmpdir() }).catch((e) => e);
      expect(err).toBeInstanceOf(UsageError);
      expect(err.message).toMatch(message);
    });
  }

  it("shows the real line count when a line or range is past the end", async () => {
    for (const spec of ["6", "4-9"]) {
      const err = await buildRequest({ reference: `${file}:${spec}`, settings, root: tmpdir() }).catch((e) => e);
      expect(err).toBeInstanceOf(UsageError);
      expect(err.message).toContain("has 5 lines");
    }
  });
});

describe("file names and words", () => {
  it("reads a file literally named like a:b instead of parsing a line number", async () => {
    const odd = join(dir, "a:2");
    await writeFile(odd, "literal content\n");
    expect(await userFor(odd)).toContain("literal content");
  });

  it("answers a bare word with a not-supported-yet usage error", async () => {
    const err = await buildRequest({ reference: "debounce", settings, root: tmpdir() }).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("not found as a file");
    expect(err.message).toContain("not supported yet");
  });

  it("a missing path-like file is a file-not-found error (exit 2), not a word", async () => {
    const err = await buildRequest({ reference: join(dir, "missing.ts"), settings, root: tmpdir() }).catch((e) => e);
    expect(err).toBeInstanceOf(FileNotFoundError);
    expect(err.exitCode).toBe(2);
    expect(err.message).toContain("no such file");
    expect(err.message).not.toContain("Word references");
  });
});

describe("open reference kinds", () => {
  it("resolves a newly registered kind without changing the caller", async () => {
    const excerpt = await resolveReference(
      { kind: "fake" },
      { read: async () => ({ text: "", name: "x" }) },
      { ...defaultResolvers, fake: async () => ({ label: "fake", text: "from fake kind" }) },
    );
    expect(excerpt.text).toBe("from fake kind");
  });
});
