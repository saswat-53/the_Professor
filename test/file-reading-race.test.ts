import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Stand-in for a file that changes between the path check and the read: the first stat lies.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

const { readTextFile } = await import("../src/core/read-file.js");

let big: string;
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "learn-race-"));
  big = join(dir, "big.txt");
  await writeFile(big, "a".repeat(2 * 1024 * 1024));
});

async function lyingStat(path: string, lies: Record<string, unknown>) {
  const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const truth = await real.stat(path);
  vi.mocked(stat).mockResolvedValueOnce(Object.assign(Object.create(truth), lies));
}

describe("file reading races", () => {
  it("refuses a file that is bigger than its stat said, without reading it all", async () => {
    await lyingStat(big, { size: 10 });
    await expect(readTextFile(big)).rejects.toThrow(/too large/);
  });

  it("refuses when the opened file is not the one the path check saw", async () => {
    await lyingStat(big, { ino: -1, size: 10 });
    await expect(readTextFile(big)).rejects.toThrow(/changed/);
  });
});
