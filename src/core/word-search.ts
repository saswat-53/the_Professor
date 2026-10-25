import { lstat, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { BRACE_EXTENSIONS } from "./brace-block-finder.js";
import { blockFinderFor } from "./block-finder-for.js";
import { WordNotFoundError } from "./errors.js";
import { extensionOf } from "./extension.js";
import { findRepo, runGit } from "./git.js";
import { PYTHON_EXTENSIONS } from "./python-block-finder.js";
import { type SearchablePath, denylistRule } from "./sensitive.js";

/** Source files only: a word in a README or a config file is not a definition, and a guess at one would mislead. */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([...BRACE_EXTENSIONS, ...PYTHON_EXTENSIONS, ..."rb scala dart lua zig ex exs sh bash zsh vue svelte".split(" ")]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".venv", "venv", "site-packages", "__pycache__", "vendor", "dist", "build"]);
/** A project with more source files than this is searched only in part. */
const MAX_FILES = 20_000;
/** A definition longer than this is cut down to its first line: the Context still carries the block. */
const MAX_BLOCK_LINES = 80;

export const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const isSource = (path: string) => SOURCE_EXTENSIONS.has(extensionOf(path));
const isVendored = (path: string) => path.split(/[\\/]/).some((part) => SKIPPED_DIRECTORIES.has(part));

/** What may be searched, and what could not be: so an empty or unlucky result can say why. */
export interface SearchList {
  files: SearchablePath[];
  /** Source files left out by a safety rule (Sensitive, git-ignored, a link). Counted, never named. */
  skipped: number;
  /** Set to the limit when the project had more source files than were searched. */
  truncatedAt?: number;
}

/** What a word Reference needs: the vetted files, and a way to read them. */
export interface SearchDeps {
  list: () => Promise<SearchList>;
  read: (path: SearchablePath) => Promise<{ text: string; name: string }>;
}

/**
 * The absolute paths a word may be searched in: source files inside `root` that are not ignored by git
 * (tracked or not), not on the Sensitive-file denylist, not vendored, and not symbolic links (a link could lead
 * outside the root or to a Sensitive file). This is stricter than the file reader on purpose: the reader's
 * checks can be skipped (`--allow-sensitive`, a local endpoint), but a search reads files nobody pointed at,
 * so it never skips them. Files left out by those rules are counted in `skipped`, for the "not found" message.
 */
export async function listSearchableFiles(root: string, maxFiles = MAX_FILES): Promise<SearchList> {
  const listing = (await findRepo(root)) ? await listWithGit(root) : await listByWalking(root);
  let skipped = listing.ignored;
  const candidates: string[] = [];
  for (const rel of listing.names.sort()) {
    if (!isSource(rel) || isVendored(rel)) continue;
    if (denylistRule(rel)) skipped++;
    else candidates.push(rel);
  }
  const truncated = candidates.length > maxFiles;
  const files: SearchablePath[] = [];
  for (const rel of candidates.slice(0, maxFiles)) {
    const full = join(root, rel);
    const info = await lstat(full).catch(() => undefined);
    if (info?.isSymbolicLink()) skipped++;
    else if (info?.isFile()) files.push(full as SearchablePath);
  }
  return { files, skipped, ...(truncated && { truncatedAt: maxFiles }) };
}

interface Listing {
  names: string[];
  /** Source files that git ignores (even ones it tracks). */
  ignored: number;
}

async function listWithGit(root: string): Promise<Listing> {
  const names = async (args: string[]) => (await runGit(root, "ls-files", { args: ["-z", ...args, "--exclude-standard"] })).split("\0").filter((n) => n !== "" && !n.endsWith("/"));
  // A tracked file that a later .gitignore rule covers is still a file its owner chose not to share.
  const ignored = new Set([...(await names(["--cached", "--ignored"])), ...(await names(["--others", "--ignored"]))]);
  const counted = [...ignored].filter((n) => isSource(n) && !isVendored(n)).length;
  return { names: (await names(["--cached", "--others"])).filter((n) => !ignored.has(n)), ignored: counted };
}

async function listByWalking(root: string): Promise<Listing> {
  const found: string[] = [];
  const pending = [""];
  while (pending.length > 0 && found.length <= MAX_FILES) {
    const dir = pending.pop()!;
    for (const entry of await readdir(join(root, dir), { withFileTypes: true }).catch(() => [])) {
      const rel = dir === "" ? entry.name : `${dir}${sep}${entry.name}`;
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) pending.push(rel);
      else if ((entry.isFile() || entry.isSymbolicLink()) && isSource(rel)) found.push(rel);
    }
  }
  return { names: found, ignored: 0 };
}

const MODIFIERS = "(?:(?:export|default|declare|public|private|protected|internal|static|abstract|final|open|sealed|data|inline|suspend|async|override|partial|readonly|unsafe|extern|const|pub(?:\\([^)]*\\))?)\\s+)*";
const DECLARATION_KEYWORDS = "(?:function\\*?|class|interface|enum|namespace|struct|trait|type|def|fn|func|fun|object|record|protocol|module|union|actor)";
const NOT_A_TYPE = new Set("return new throw await yield else case delete typeof in of and or not if while for".split(" "));

/** How likely a line is to be the definition of `word`: 4 a declaration, 3 a variable or property bound to it, 2 a method, 0 anything else. */
function definitionScore(line: string, next: string, word: string): number {
  const trimmed = line.trim();
  if (/^(\/\/|#|\*|\/\*|--|<!--)/.test(trimmed)) return 0;
  const w = word.replaceAll("$", "\\$");
  const name = `${w}(?![\\w$])`;
  if (new RegExp(`^\\s*${MODIFIERS}${DECLARATION_KEYWORDS}\\s+(?:self\\.)?${name}`).test(line)) return 4;
  if (new RegExp(`^\\s*func\\s*\\([^)]*\\)\\s*${name}`).test(line)) return 4;
  if (new RegExp(`^\\s*${MODIFIERS}(?:let|var|val|const)\\s+${name}`).test(line)) return 3;
  if (new RegExp(`^${name}\\s*=(?!=)`).test(line)) return 3;
  if (new RegExp(`^\\s*${MODIFIERS}${name}\\s*[:=]\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|[\\w$]+\\s*=>)`).test(line)) return 3;
  // A method has a parameter list closed by `)` and then a body, so `word(x);` and `return word(x)` are calls.
  const opensBody = /\)\s*(?::[^{;=]*)?\{\s*$/.test(line) || (/\)\s*$/.test(line) && /^\s*\{/.test(next));
  if (!opensBody) return 0;
  if (new RegExp(`^\\s*(?:(?:public|private|protected|static|async|override|abstract|final|get|set|readonly)\\s+)*\\*?${w}\\s*(?:<[^>(]*>)?\\s*\\(`).test(line)) return 2;
  const typed = new RegExp(`^\\s*((?:[A-Za-z_][\\w<>\\[\\],.?*&:]*\\s+)+)\\*?${w}\\s*\\(`).exec(line);
  return typed && !typed[1]!.trim().split(/\s+/).some((token) => NOT_A_TYPE.has(token)) ? 2 : 0;
}

const isTestFile = (path: string) => /(^|[\\/])(tests?|__tests__|specs?)[\\/]|[._-](test|spec)\.[^\\/]+$|(^|[\\/])test_[^\\/]+$/i.test(path);
const LINE_BREAK = /\r\n|\r|\n/;

interface Span {
  /** Project-relative name of the file. */
  name: string;
  start: number;
  end: number;
}

export interface FoundDefinition extends Span {
  text: string;
  /** The best definition in each other file, best first, at most `MAX_ALSO_FOUND`: what the user may ask for instead with `file:N-M`. */
  alsoFound: Span[];
  /** How many more files hold a definition than `alsoFound` lists. */
  more: number;
  /** Set to the limit when the project had more source files than were searched. */
  truncatedAt?: number;
}

interface Candidate {
  name: string;
  text: string;
  score: number;
  line: number;
}

/** Best first: a source file over a test file, then a stronger kind of definition, then the shallower path, then the name. */
function better(a: Candidate, b: Candidate): boolean {
  const [aTest, bTest] = [isTestFile(a.name), isTestFile(b.name)];
  if (aTest !== bTest) return !aTest;
  if (a.score !== b.score) return a.score > b.score;
  const [aDepth, bDepth] = [a.name.split(sep).length, b.name.split(sep).length];
  if (aDepth !== bDepth) return aDepth < bDepth;
  return a.name !== b.name ? a.name < b.name : a.line < b.line;
}

function extentOf(candidate: Candidate): Span {
  const lines = candidate.text.split(LINE_BREAK);
  const { name, line } = candidate;
  const block = blockFinderFor(name).find({ path: name, lines }, { start: line, end: line });
  const decorated = block && block.start <= line && lines.slice(block.start - 1, line - 1).every((l) => /^\s*(@|#|\/\/|\/\*|\*|$)/.test(l));
  return { name, ...(block && decorated && block.end - block.start < MAX_BLOCK_LINES ? block : { start: line, end: line }) };
}

const MAX_ALSO_FOUND = 5;

/**
 * Finds the best definition of `word` among the vetted files, and notes where else it is defined. Every file is
 * opened with `deps.read`; one that fails the file reading rules is skipped, not an error.
 */
export async function findDefinition(word: string, deps: SearchDeps): Promise<FoundDefinition> {
  const { files, skipped, truncatedAt } = await deps.list();
  const perFile: Candidate[] = [];
  let searched = 0;
  for (const path of files) {
    const file = await deps.read(path).catch(() => undefined);
    if (!file) continue;
    searched++;
    if (!file.text.includes(word)) continue;
    const lines = file.text.split(LINE_BREAK);
    let best: Candidate | undefined;
    for (let i = 0; i < lines.length; i++) {
      const score = definitionScore(lines[i]!, lines[i + 1] ?? "", word);
      if (score === 0) continue;
      const candidate: Candidate = { name: file.name, text: file.text, score, line: i + 1 };
      if (!best || better(candidate, best)) best = candidate;
    }
    if (best) perFile.push(best);
  }
  perFile.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  const [chosen, ...others] = perFile;
  if (!chosen) throw new WordNotFoundError(word, searched, { skipped, truncatedAt });
  const { name, start, end } = extentOf(chosen);
  return {
    name,
    start,
    end,
    text: chosen.text,
    alsoFound: others.slice(0, MAX_ALSO_FOUND).map(extentOf),
    more: Math.max(0, others.length - MAX_ALSO_FOUND),
    ...(truncatedAt !== undefined && { truncatedAt }),
  };
}
