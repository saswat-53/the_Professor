import { constants } from "node:fs";
import { appendFile, lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NotesError } from "./errors.js";
import { isInside } from "./root.js";

/** One finished question and answer, as `/save` writes it. */
export interface NoteTurn {
  number: number;
  user: string;
  assistant: string;
  /** The turn carries a file the Sensitive-file rules normally exclude. */
  sensitive?: boolean;
}

const WARNING = "> **Warning:** this note contains code (and the model's explanation of it) from your project. Check it for secrets before you share it.";
const SENSITIVE = "> **Note:** this note includes content from a file normally excluded.";
const GLOSSARY = "glossary.md";
const MAX_SLUG = 48;
const MAX_SAME_NAME = 1000;

/** `YYYY-MM-DD` in local time, the day the user would call it. */
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A file-name-safe version of `text`: lower-case letters and digits joined by single dashes, nothing else. Every
 * character that could climb a path (`.`, `/`, `\`) becomes a dash, so `../../x` is just `x`.
 */
function slugOf(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_SLUG).replace(/-+$/, "");
  return slug === "" ? "session" : slug;
}

/** Terminal control characters (escape sequences, bell, C1 controls) have no place in a file that will be `cat`ted; newline and tab stay. */
const stripControls = (text: string) =>
  text
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");

/** A code fence longer than any run of backticks in `text`, so the text cannot close it early. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(longest + 1);
}

const oneLine = (text: string) => stripControls(text).replace(/\s+/g, " ").trim();

/** The real path of the notes directory, created private (0700) if missing. */
async function openNotesDir(notesDir: string): Promise<string> {
  try {
    await mkdir(notesDir, { recursive: true, mode: 0o700 });
    const real = await realpath(notesDir);
    if (!(await stat(real)).isDirectory()) throw new NotesError(`the notes directory ${notesDir} is not a directory`);
    return real;
  } catch (err) {
    if (err instanceof NotesError) throw err;
    throw new NotesError(`cannot use the notes directory ${notesDir}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
  }
}

/** Throws unless `file`, once symlinks are followed, is inside `dir` (a real path). Used after the file exists. */
async function assertInside(dir: string, file: string): Promise<void> {
  if (!isInside(dir, await realpath(file))) throw new NotesError(`${file} resolves outside the notes directory`);
}

function render(turns: readonly NoteTurn[], title: string, now: Date): string {
  const parts = [WARNING, ...(turns.some((t) => t.sensitive) ? [">", SENSITIVE] : []), "", `# ${oneLine(title) || "Session"}`, "", `Saved ${dayOf(now)}.`];
  const kept = new Set(turns.map((t) => t.number));
  const missing = Array.from({ length: Math.max(0, ...kept) }, (_, i) => i + 1).filter((n) => !kept.has(n));
  if (missing.length > 0) parts.push("", `_Turns ${missing.join(", ")} were dropped from the Session to fit its cap and are not in this note._`);
  for (const t of turns) {
    const q = stripControls(t.user).trimEnd();
    const f = fence(q);
    parts.push("", `## Turn ${t.number}`, "", "**You:**", "", `${f}text`, q, f, "", "**Explanation:**", "", stripControls(t.assistant).trim());
  }
  return `${parts.join("\n")}\n`;
}

/**
 * Writes one Session as a new markdown file in the notes directory and returns its real path. The name is the
 * date plus a sanitised slug of `title`. The file is created exclusively (`wx`: fails if the name exists, and
 * never follows a symlink at that name), so a second save gets `-2`, `-3`, ... and nothing is overwritten.
 * This module is the one place the tool writes (see ADR 0002).
 */
export async function saveNote(input: { notesDir: string; turns: readonly NoteTurn[]; title: string; now: Date }): Promise<string> {
  const dir = await openNotesDir(input.notesDir);
  const base = `${dayOf(input.now)}-${slugOf(input.title)}`;
  const text = render(input.turns, input.title, input.now);
  for (let n = 1; n <= MAX_SAME_NAME; n++) {
    const file = join(dir, n === 1 ? `${base}.md` : `${base}-${n}.md`);
    try {
      await writeFile(file, text, { flag: "wx", mode: 0o600 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new NotesError(`cannot write the note ${file}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
    }
    await assertInside(dir, file);
    return file;
  }
  throw new NotesError(`there are already ${MAX_SAME_NAME} notes named ${base} in ${dir}; give this one a different name`);
}

/**
 * Appends one entry to the single glossary file in the notes directory (created if missing) and returns its path.
 * The file is opened with O_NOFOLLOW, so a symlink planted at `glossary.md` is refused instead of followed out.
 */
export async function appendGlossaryEntry(input: { notesDir: string; term: string; definition: string; now: Date }): Promise<string> {
  const dir = await openNotesDir(input.notesDir);
  const file = join(dir, GLOSSARY);
  // An existing glossary must be a plain file with one name: a hard link would write through to a file elsewhere.
  // (`open` is reserved for the file reader, so this is checked just before the append rather than on the open handle.)
  const existing = await lstat(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined;
    throw new NotesError(`cannot check the glossary ${file}: ${err.code ?? err.message}`);
  });
  if (existing && (!existing.isFile() || existing.nlink > 1)) {
    throw new NotesError(`${file} is not a plain file with a single name (it is a link or has more than one link); nothing was written to it`);
  }
  const line = `- **${oneLine(input.term)}**: ${oneLine(input.definition)} _(${dayOf(input.now)})_\n`;
  try {
    await appendFile(file, line, { flag: constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), mode: 0o600 });
  } catch (err) {
    throw new NotesError(`cannot add to the glossary ${file}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
  }
  await assertInside(dir, file);
  return file;
}
