import type { FileHandle } from "node:fs/promises";
import { mkdtemp, open, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// These tests assume macOS or Linux: the inode comparison relies on `dev` and `ino` being
// reliable, and Windows reports them differently.
//
// The 1 MB boundary is written out here on purpose: importing the source constant would let an
// accidental change to it pass these tests silently.

// The real module is wrapped so individual calls can be made to misbehave or be observed.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat), open: vi.fn(actual.open), readFile: vi.fn(actual.readFile) };
});

const { readTextFile } = await import("../src/core/read-file.js");
const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const MB = 1024 * 1024;
let big: string;
let justOver: string;
let atLimit: string;
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "learn-race-"));
  big = join(dir, "big.txt");
  justOver = join(dir, "over.txt");
  atLimit = join(dir, "limit.txt");
  await writeFile(big, "a".repeat(2 * MB));
  await writeFile(justOver, "a".repeat(MB + 1));
  await writeFile(atLimit, "a".repeat(MB));
});

/** The next path `stat` reports `lies` about the file; later calls tell the truth. */
async function lyingStat(path: string, lies: Record<string, unknown>) {
  const truth = await real.stat(path);
  vi.mocked(stat).mockResolvedValueOnce(Object.assign(Object.create(truth), lies));
}

/** The next `open` returns the real handle, but `adjust` may replace or observe its methods. */
function observeNextOpen(adjust: (handle: FileHandle) => void) {
  vi.mocked(open).mockImplementationOnce((async (...args: Parameters<typeof real.open>) => {
    const handle = await real.open(...args);
    adjust(handle);
    return handle;
  }) as typeof open);
}

describe("file reading races", () => {
  it("refuses a file that is bigger than its stat said", async () => {
    await lyingStat(big, { size: 10 });
    await expect(readTextFile(big)).rejects.toThrow(/too large/);
  });

  it("refuses a file one byte over the limit even when stat said it was small", async () => {
    await lyingStat(justOver, { size: 10 });
    await expect(readTextFile(justOver)).rejects.toThrow(/too large/);
  });

  it("reads a file of exactly the limit in full even when stat said it was small", async () => {
    await lyingStat(atLimit, { size: 10 });
    expect((await readTextFile(atLimit)).length).toBe(MB);
  });

  it("trusts the opened handle: a different inode on the handle is refused though the path stat is true", async () => {
    observeNextOpen((handle) => {
      const handleStat = handle.stat.bind(handle);
      handle.stat = (async (...args: Parameters<typeof handleStat>) =>
        Object.assign(Object.create(await handleStat(...args)), { ino: -1 })) as typeof handle.stat;
    });
    await expect(readTextFile(atLimit)).rejects.toThrow(/changed/);
  });

  it("never reads the whole file at once and never reads more than the limit plus one byte", async () => {
    const reads: number[] = [];
    observeNextOpen((handle) => {
      const read = handle.read.bind(handle) as (...a: unknown[]) => Promise<{ bytesRead: number }>;
      (handle as unknown as { read: unknown }).read = async (...args: unknown[]) => {
        const result = await read(...args);
        reads.push(result.bytesRead);
        return result;
      };
    });
    vi.mocked(readFile).mockClear();
    await lyingStat(big, { size: 10 });
    await expect(readTextFile(big)).rejects.toThrow(/too large/);
    expect(readFile).not.toHaveBeenCalled();
    expect(reads.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MB + 1);
    expect(Math.max(...reads)).toBeLessThanOrEqual(MB + 1);
  });

  it("closes the handle when it refuses a file", async () => {
    let close: ReturnType<typeof vi.fn> | undefined;
    observeNextOpen((handle) => {
      const realClose = handle.close.bind(handle);
      close = vi.fn(realClose);
      handle.close = close as typeof handle.close;
      const handleStat = handle.stat.bind(handle);
      handle.stat = (async (...args: Parameters<typeof handleStat>) =>
        Object.assign(Object.create(await handleStat(...args)), { ino: -1 })) as typeof handle.stat;
    });
    await expect(readTextFile(atLimit)).rejects.toThrow(/changed/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the handle when the file turns out to be too large", async () => {
    let close: ReturnType<typeof vi.fn> | undefined;
    observeNextOpen((handle) => {
      close = vi.fn(handle.close.bind(handle));
      handle.close = close as typeof handle.close;
    });
    await lyingStat(big, { size: 10 });
    await expect(readTextFile(big)).rejects.toThrow(/too large/);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
