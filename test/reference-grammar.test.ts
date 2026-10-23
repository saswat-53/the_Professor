import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { UsageError } from "../src/core/errors.js";
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

/** The excerpt text sent to the model, without the "File:" header line. */
const userFor = async (reference: string) => (await buildRequest({ reference, settings })).user.split("\n\n").slice(1).join("\n\n");

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
    ["non-integer", `${"FILE"}:1.5`, /not a line number/],
    ["words", `${"FILE"}:abc`, /not a line number/],
    ["empty spec", `${"FILE"}:`, /not a line number/],
    ["reversed range", `${"FILE"}:4-2`, /reversed/],
    ["three-part range", `${"FILE"}:1-2-3`, /not a line number/],
  ];
  for (const [label, ref, message] of cases) {
    it(`rejects ${label} as a usage error`, async () => {
      const err = await buildRequest({ reference: ref.replace("FILE", file), settings }).catch((e) => e);
      expect(err).toBeInstanceOf(UsageError);
      expect(err.message).toMatch(message);
    });
  }

  it("shows the real line count when a line or range is past the end", async () => {
    for (const spec of ["6", "4-9"]) {
      const err = await buildRequest({ reference: `${file}:${spec}`, settings }).catch((e) => e);
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
    const err = await buildRequest({ reference: "debounce", settings }).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("not supported yet");
  });

  it("a missing path-like file is still a read error, not a word", async () => {
    const err = await buildRequest({ reference: join(dir, "missing.ts"), settings }).catch((e) => e);
    expect(err).not.toBeInstanceOf(UsageError);
  });
});

describe("open reference kinds", () => {
  it("resolves a newly registered kind without changing the caller", async () => {
    const excerpt = await resolveReference(
      { kind: "fake" },
      { read: async () => "" },
      { ...defaultResolvers, fake: async () => ({ label: "fake", text: "from fake kind" }) },
    );
    expect(excerpt.text).toBe("from fake kind");
  });
});
