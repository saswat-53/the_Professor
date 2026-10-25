import { constants } from "node:fs";
import { lstat, open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { FileRefusedError } from "./errors.js";

const MAX_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;

const describeSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${+(bytes / (1024 * 1024)).toFixed(1)} MB` : `${+(bytes / 1024).toFixed(1)} KB`);

/** Reads until end of file or `limit` bytes, whichever comes first; a single read can come back short. */
async function readBounded(handle: FileHandle, limit: number): Promise<Buffer> {
  const buffer = Buffer.alloc(limit);
  let total = 0;
  while (total < limit) {
    const { bytesRead } = await handle.read(buffer, total, limit - total, total);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return buffer.subarray(0, total);
}

/**
 * Reads a file the safe way: only ordinary text files of reasonable size are opened.
 *
 * The path is checked with `stat` first because opening a named pipe blocks until a writer
 * appears. `maxBytes` caps the size (default 1 MB). With `noFollow` a symbolic link at the end of the path is refused,
 * not followed: the path is checked with `lstat` and opened with `O_NOFOLLOW`, so a link swapped in after the check
 * fails the open instead of leading elsewhere. Links in the directories above the file are still followed. After opening, the handle is checked again (`fstat`) so a swap between the two
 * steps is caught, and at most one byte past the limit is ever read.
 */
export async function readTextFile(path: string, maxBytes = MAX_BYTES, noFollow = false): Promise<string> {
  const pathStat = await (noFollow ? lstat : stat)(path);
  if (!pathStat.isFile()) throw new FileRefusedError("not-regular", path, `not a regular file`);
  if (pathStat.size > maxBytes) throw new FileRefusedError("too-large", path, `file too large (over ${describeSize(maxBytes)})`);

  const handle = await open(path, noFollow ? constants.O_RDONLY | constants.O_NOFOLLOW : "r").catch((err: NodeJS.ErrnoException) => {
    if (noFollow && err.code === "ELOOP") throw new FileRefusedError("not-regular", path, "not a regular file");
    throw err;
  });
  let bytes: Buffer;
  try {
    const handleStat = await handle.stat();
    if (!handleStat.isFile() || handleStat.dev !== pathStat.dev || handleStat.ino !== pathStat.ino) {
      throw new FileRefusedError("changed", path, `changed while being read`);
    }
    bytes = await readBounded(handle, maxBytes + 1);
    if (bytes.length > maxBytes) throw new FileRefusedError("too-large", path, `file too large (over ${describeSize(maxBytes)})`);
  } finally {
    await handle.close();
  }

  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) throw new FileRefusedError("binary", path, "looks like a binary file");
  try {
    // The decoder drops a leading BOM by default; CRLF becomes LF afterwards.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n");
  } catch {
    throw new FileRefusedError("not-utf8", path, "not UTF-8 text");
  }
}
