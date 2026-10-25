import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

/** The file operations the writer uses, as a seam: a test can make any step fail. */
export interface FsOps {
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
  rename: typeof rename;
  rm: typeof rm;
}

const real: FsOps = { mkdir, writeFile, rename, rm };

/**
 * Writes `text` to `file` so that a reader (or a crash) sees the old file or the whole new one, never half.
 * The text goes to a new file beside the target (owner-only from the first byte, `wx` so an existing name is
 * never reused), and a rename, which is atomic within one directory, puts it in place. Any failure removes the
 * temporary file and leaves the target as it was. The directory is created private (0700) if missing.
 */
export async function writeFileAtomic(file: string, text: string, ops: FsOps = real): Promise<void> {
  const dir = dirname(file);
  await ops.mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await ops.writeFile(temp, text, { mode: 0o600, flag: "wx" });
    await ops.rename(temp, file);
  } catch (err) {
    await ops.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}
