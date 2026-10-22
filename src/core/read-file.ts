import { open, stat } from "node:fs/promises";

const MAX_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;

/**
 * Reads a file the safe way: only ordinary text files of reasonable size are opened.
 *
 * The path is checked with `stat` first because opening a named pipe blocks until a writer
 * appears. After opening, the handle is checked again (`fstat`) so a swap between the two
 * steps is caught, and at most one byte past the limit is ever read.
 */
export async function readTextFile(path: string): Promise<string> {
  const before = await stat(path);
  if (!before.isFile()) throw new Error(`${path}: not a regular file`);
  if (before.size > MAX_BYTES) throw new Error(`${path}: file too large (over 1 MB)`);

  const handle = await open(path, "r");
  let bytes: Buffer;
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) {
      throw new Error(`${path}: changed while being read`);
    }
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) throw new Error(`${path}: file too large (over 1 MB)`);
    bytes = buffer.subarray(0, length);
  } finally {
    await handle.close();
  }

  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) throw new Error(`${path}: looks like a binary file`);
  try {
    // The decoder drops a leading BOM by default; CRLF becomes LF afterwards.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n");
  } catch {
    throw new Error(`${path}: not UTF-8 text`);
  }
}
