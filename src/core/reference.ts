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
  /** Set for text that arrived on standard input or from the clipboard: it has no filename, so no filename rule could apply to it. */
  origin?: "piped" | "clipboard";
  /** Where the Excerpt sits in its file. Absent for input with no file behind it, which gets no Context. */
  source?: { path: string; text: string; start: number; end: number };
}

export interface ResolverDeps {
  /** Reads a file inside the project; `name` is its project-relative path, the only name a label may use. */
  read: (path: string) => Promise<{ text: string; name: string }>;
}
export type Resolver<R extends Reference = Reference> = (ref: R, deps: ResolverDeps) => Promise<Excerpt>;
export type Resolvers = Record<string, Resolver<any>>;

const pathExists = (path: string) => stat(path).then(() => true, () => false);

/** A final newline does not start a new line, so "a\n" has one line. */
function lineCount(lines: string[]) {
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

const formatRange = (start: number, end: number) => (start === end ? `${start}` : `${start}-${end}`);

/** The range part of `path:SPEC`; every malformed shape gets its own message. */
function parseSpec(spec: string): { start: number; end: number } {
  if (/^-\d/.test(spec)) throw new UsageError(`line numbers must be positive, got "${spec}"`);
  if (spec === "") throw new UsageError("the line reference is missing a line number after the colon");
  const parts = spec.split("-");
  if (parts.length === 2 && parts[1] === "") {
    throw new UsageError(`open-ended ranges like "${spec}" are not supported; give both ends as N-M`);
  }
  if (parts.length > 2) throw new UsageError(`a range has two ends, got "${spec}"; use N-M`);
  const bad = parts.find((p) => !/^\d+$/.test(p));
  if (bad !== undefined) throw new UsageError(`"${bad}" is not a whole number; use path:N or path:N-M`);
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
  file: async (ref: FileReference, { read }) => {
    const { text, name } = await read(ref.path);
    return { label: name, text };
  },
  lines: async (ref: LinesReference, { read }) => {
    // A lone CR counts as a line break, as editors show it; CRLF was already normalised by the reader.
    const { text, name } = await read(ref.path);
    const lines = text.split(/\r\n|\r|\n/);
    const total = lineCount(lines);
    if (ref.end > total) {
      const noun = ref.start === ref.end ? "line" : "lines";
      throw new UsageError(
        `${name}: ${noun} ${formatRange(ref.start, ref.end)} is past the end of the file, which has ${total} lines`,
      );
    }
    return {
      label: `${name}:${formatRange(ref.start, ref.end)}`,
      text: lines.slice(ref.start - 1, ref.end).join("\n"),
      source: { path: name, text, start: ref.start, end: ref.end },
    };
  },
  word: async (ref: WordReference) => {
    throw new UsageError(
      `"${ref.word}" was not found as a file. Word references are not supported yet; use a file or path:N-M`,
    );
  },
};

/** A language hint is one short token, since it goes into the request: no spaces or line breaks to carry instructions. */
const LANG_HINT = /^[A-Za-z0-9_+#.-]{1,30}$/;

/** The Excerpt for text with no file behind it (piped in with `cat file | learn`, or from the clipboard): all of it, and so no Context. */
export function pipedExcerpt(text: string, lang?: string, origin: "piped" | "clipboard" = "piped"): Excerpt {
  if (lang !== undefined && !LANG_HINT.test(lang)) {
    throw new UsageError(`--lang takes a language name such as python or ts (letters, digits, + # . _ -), got "${lang}"`);
  }
  return { label: `${origin === "piped" ? "piped input" : "clipboard"}${lang ? ` (language: ${lang})` : ""}`, text, origin };
}

export function resolveReference(ref: Reference, deps: ResolverDeps, resolvers: Resolvers = defaultResolvers) {
  const resolve = resolvers[ref.kind];
  if (!resolve) throw new UsageError(`unsupported reference kind "${ref.kind}"`);
  return resolve(ref, deps);
}
