import { lstat, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { BRACE_EXTENSIONS } from "./brace-block-finder.js";
import { blockFinderFor } from "./block-finder-for.js";
import { WordNotFoundError } from "./errors.js";
import { extensionOf } from "./extension.js";
import { findRepo, runGit } from "./git.js";
import { PYTHON_EXTENSIONS } from "./python-block-finder.js";
import { denylistRule } from "./sensitive.js";

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

/**
 * The absolute paths a word may be searched in: source files inside `root` that are not ignored by git
 * (tracked or not), not on the Sensitive-file denylist, not vendored, and not symbolic links (a link could lead
 * outside the root or to a Sensitive file). This is stricter than the file reader on purpose: the reader's
 * checks can be skipped (`--allow-sensitive`, a local endpoint), but a search reads files nobody pointed at,
 * so it never skips them.
 */
export async function listSearchableFiles(root: string): Promise<string[]> {
  const relative = (await findRepo(root)) ? await listWithGit(root) : await listByWalking(root);
  const kept: string[] = [];
  for (const rel of relative.sort()) {
    if (!isSource(rel) || isVendored(rel) || denylistRule(rel)) continue;
    const full = join(root, rel);
    if ((await lstat(full).catch(() => undefined))?.isFile()) kept.push(full);
  }
  return kept.slice(0, MAX_FILES);
}

async function listWithGit(root: string): Promise<string[]> {
  const names = async (args: string[]) => (await runGit(root, "ls-files", { args: ["-z", ...args, "--exclude-standard"] })).split("\0").filter((n) => n !== "" && !n.endsWith("/"));
  // A tracked file that a later .gitignore rule covers is still a file its owner chose not to share.
  const ignored = new Set(await names(["--cached", "--ignored"]));
  return (await names(["--cached", "--others"])).filter((n) => !ignored.has(n));
}

async function listByWalking(root: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [""];
  while (pending.length > 0 && found.length < MAX_FILES) {
    const dir = pending.pop()!;
    for (const entry of await readdir(join(root, dir), { withFileTypes: true }).catch(() => [])) {
      const rel = dir === "" ? entry.name : `${dir}${sep}${entry.name}`;
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) pending.push(rel);
      else if (entry.isFile()) found.push(rel);
    }
  }
  return found;
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

export interface FoundDefinition {
  /** Project-relative name of the file. */
  name: string;
  text: string;
  /** The definition: its enclosing block when that starts on the definition line (or on the decorators above it), else the one line. */
  start: number;
  end: number;
}

interface Candidate extends FoundDefinition {
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

function extentOf(name: string, lines: string[], line: number): { start: number; end: number } {
  const block = blockFinderFor(name).find({ path: name, lines }, { start: line, end: line });
  const decorated = block && block.start <= line && lines.slice(block.start - 1, line - 1).every((l) => /^\s*(@|#|\/\/|\/\*|\*|$)/.test(l));
  return block && decorated && block.end - block.start < MAX_BLOCK_LINES ? block : { start: line, end: line };
}

/**
 * Finds the best definition of `word` among `files` (absolute paths). Every file is opened with `read`, the
 * reader that does the root check and the file reading rules; one that fails them is skipped, not an error.
 */
export async function findDefinition(
  word: string,
  deps: { read: (path: string) => Promise<{ text: string; name: string }>; files: () => Promise<string[]> },
): Promise<FoundDefinition> {
  let best: Candidate | undefined;
  let searched = 0;
  for (const path of await deps.files()) {
    const file = await deps.read(path).catch(() => undefined);
    if (!file) continue;
    searched++;
    if (!file.text.includes(word)) continue;
    const lines = file.text.split(LINE_BREAK);
    for (let i = 0; i < lines.length; i++) {
      const score = definitionScore(lines[i]!, lines[i + 1] ?? "", word);
      if (score === 0) continue;
      const candidate: Candidate = { name: file.name, text: file.text, score, line: i + 1, start: 0, end: 0 };
      if (!best || better(candidate, best)) best = Object.assign(candidate, extentOf(file.name, lines, i + 1));
    }
  }
  if (!best) throw new WordNotFoundError(word, searched);
  return { name: best.name, text: best.text, start: best.start, end: best.end };
}
