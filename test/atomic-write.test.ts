import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "../src/cli/atomic-write.js";
import type { FsOps } from "../src/cli/atomic-write.js";
import * as fs from "node:fs/promises";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "learn-atomic-"));
  file = join(dir, "learn", "config.toml");
});

const real: FsOps = { mkdir: fs.mkdir, writeFile: fs.writeFile, rename: fs.rename, rm: fs.rm };

describe("writeFileAtomic", () => {
  it("creates the directory private and the file owner-only", async () => {
    await writeFileAtomic(file, "a = 1\n");
    expect(await readFile(file, "utf8")).toBe("a = 1\n");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "learn"))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(dir, "learn"))).toEqual(["config.toml"]);
  });

  it("replaces an existing file, and the new file is owner-only even if the old one was not", async () => {
    await mkdir(join(dir, "learn"));
    await writeFile(file, "old\n", { mode: 0o644 });
    await writeFileAtomic(file, "new\n");
    expect(await readFile(file, "utf8")).toBe("new\n");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("a write that fails half-way leaves no partial file and no existing file changed", async () => {
    await mkdir(join(dir, "learn"));
    await writeFile(file, "old\n");
    const ops: FsOps = {
      ...real,
      writeFile: async (path, data, options) => {
        await fs.writeFile(path, String(data).slice(0, 3), options); // half of it reaches the disk...
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); // ...then the write dies
      },
    };
    await expect(writeFileAtomic(file, "new contents\n", ops)).rejects.toThrow("disk full");
    expect(await readFile(file, "utf8")).toBe("old\n");
    expect(await readdir(join(dir, "learn"))).toEqual(["config.toml"]);
  });

  it("a failed rename leaves no file at all when there was none, and no temp file", async () => {
    const ops: FsOps = { ...real, rename: async () => { throw new Error("interrupted"); } };
    await expect(writeFileAtomic(file, "x\n", ops)).rejects.toThrow("interrupted");
    expect(await readdir(join(dir, "learn"))).toEqual([]);
  });
});
