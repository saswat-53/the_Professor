import { readFile, stat } from "node:fs/promises";

const MAX_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;

/** Reads a file the safe way: only ordinary text files of reasonable size are opened. */
export async function readTextFile(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path}: not a regular file`);
  if (info.size > MAX_BYTES) throw new Error(`${path}: file too large (over 1 MB)`);
  const bytes = await readFile(path);
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) throw new Error(`${path}: looks like a binary file`);
  try {
    // The decoder drops a leading BOM by default; CRLF becomes LF afterwards.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n");
  } catch {
    throw new Error(`${path}: not UTF-8 text`);
  }
}
