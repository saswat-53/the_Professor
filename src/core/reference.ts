import { stat } from "node:fs/promises";
import { UsageError } from "./errors.js";

/** A Reference says which code to explain. `kind` is open: new kinds register a resolver. */
export interface Reference {
  kind: string;
}
export interface FileReference extends Reference {
  kind: "file";
  path: string;
}
export interface LinesReference extends Reference {
  kind: "lines";
  path: string;
  start: number;
  end: number;
}
export interface WordReference extends Reference {
  kind: "word";
  word: string;
}

export interface Excerpt {
  label: string;
  text: string;
}

export interface ResolverDeps {
  read: (path: string) => Promise<string>;
}
export type Resolver<R extends Reference = Reference> = (ref: R, deps: ResolverDeps) => Promise<Excerpt>;
export type Resolvers = Record<string, Resolver<any>>;

const pathExists = (path: string) => stat(path).then(() => true, () => false);

/** Splits `text` into lines; a final newline does not start a new line. */
function lineCount(lines: string[]) {
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

/** The range part of `path:SPEC`; every malformed shape gets its own message. */
function parseSpec(spec: string): { start: number; end: number } {
  if (/^-\d/.test(spec)) throw new UsageError(`line numbers must be positive, got "${spec}"`);
  const parts = spec.split("-");
  if (parts.length > 2 || !parts.every((p) => /^\d+$/.test(p))) {
    throw new UsageError(`"${spec}" is not a line number or range; use path:N or path:N-M`);
  }
  const [start, end] = parts.map(Number) as [number, number?];
  for (const n of [start, end ?? start]) {
    if (n === 0) throw new UsageError("line numbers start at 1, got 0");
  }
  if (end !== undefined && end < start) {
    throw new UsageError(`range ${start}-${end} is reversed; write it as ${end}-${start}`);
  }
  return { start, end: end ?? start };
}

/**
 * Turns the raw argument into a Reference. A file that exists under the literal name wins over
 * any parsing, so a file called `a:b` still works.
 */
export async function parseReference(
  raw: string,
  fileExists: (path: string) => Promise<boolean> = pathExists,
): Promise<FileReference | LinesReference | WordReference> {
  if (await fileExists(raw)) return { kind: "file", path: raw } satisfies FileReference;
  const colon = raw.lastIndexOf(":");
  if (colon > 0) {
    const path = raw.slice(0, colon);
    return { kind: "lines", path, ...parseSpec(raw.slice(colon + 1)) } satisfies LinesReference;
  }
  if (!/[/\\.]/.test(raw)) return { kind: "word", word: raw } satisfies WordReference;
  return { kind: "file", path: raw } satisfies FileReference;
}

export const defaultResolvers: Resolvers = {
  file: async (ref: FileReference, { read }) => ({ label: ref.path, text: await read(ref.path) }),
  lines: async (ref: LinesReference, { read }) => {
    const lines = (await read(ref.path)).split("\n");
    const total = lineCount(lines);
    if (ref.end > total) {
      const range = ref.start === ref.end ? `line ${ref.start}` : `lines ${ref.start}-${ref.end}`;
      throw new UsageError(`${ref.path}: ${range} is past the end of the file, which has ${total} lines`);
    }
    const label = ref.start === ref.end ? `${ref.path}:${ref.start}` : `${ref.path}:${ref.start}-${ref.end}`;
    return { label, text: lines.slice(ref.start - 1, ref.end).join("\n") };
  },
  word: async (ref: WordReference) => {
    throw new UsageError(`word references like "${ref.word}" are not supported yet; use a file or path:N-M`);
  },
};

export function resolveReference(ref: Reference, deps: ResolverDeps, resolvers: Resolvers = defaultResolvers) {
  const resolve = resolvers[ref.kind];
  if (!resolve) throw new UsageError(`unsupported reference kind "${ref.kind}"`);
  return resolve(ref, deps);
}
