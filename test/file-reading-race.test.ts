import { mkdtemp, open, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Stand-in for a file that changes between the path check and the read: the first stat lies.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat), open: vi.fn(actual.open) };
});

const { readTextFile } = await import("../src/core/read-file.js");

let big: string;
let justOver: string;
let atLimit: string;
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "learn-race-"));
  big = join(dir, "big.txt");
  justOver = join(dir, "over.txt");
  atLimit = join(dir, "limit.txt");
  await writeFile(justOver, "a".repeat(1024 * 1024 + 1));
  await writeFile(atLimit, "a".repeat(1024 * 1024));
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

  it("refuses a file one byte over the limit even when stat said it was small", async () => {
    await lyingStat(justOver, { size: 10 });
    await expect(readTextFile(justOver)).rejects.toThrow(/too large/);
  });

  it("reads a file of exactly the limit in full even when stat said it was small", async () => {
    await lyingStat(atLimit, { size: 10 });
    expect((await readTextFile(atLimit)).length).toBe(1024 * 1024);
  });

  it("closes the handle when it refuses a file", async () => {
    await lyingStat(big, { ino: -1, size: 10 });
    await expect(readTextFile(big)).rejects.toThrow(/changed/);
    const handle = await vi.mocked(open).mock.results.at(-1)?.value;
    expect(handle.fd).toBe(-1);
  });
});
