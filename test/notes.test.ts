import { execFileSync } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, readdir, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { findRepoAround } from "../src/core/git.js";
import { appendGlossaryEntry, saveNote } from "../src/core/notes.js";

const turns = [
  { number: 1, user: "Explain this:\n```ts\nconst a = 1;\n```", assistant: "It declares **a**." },
  { number: 2, user: "why const?", assistant: "Because it never changes." },
];
const now = new Date(2026, 9, 25, 14, 30);
let dir: string;
let notesDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "learn-notes-"));
  notesDir = join(dir, "notes");
});

describe("saveNote", () => {
  it("writes one markdown file named by date and slug, creating the notes directory", async () => {
    const path = await saveNote({ notesDir, turns, title: "src/auth.ts:40-60", now });
    expect(path).toBe(join(await realNotes(), "2026-10-25-src-auth-ts-40-60.md"));
    const text = await readFile(path, "utf8");
    expect(text).toContain("why const?");
    expect(text).toContain("Because it never changes.");
    expect(text).toContain("const a = 1;");
  });

  it("begins with a warning that the note contains code", async () => {
    const text = await readFile(await saveNote({ notesDir, turns, title: "x", now }), "utf8");
    expect(text.split("\n")[0]).toMatch(/^> \*\*Warning/);
    expect(text.split("\n")[0]).toMatch(/contains code/);
  });

  it("keeps code containing fences intact by fencing with a longer run", async () => {
    const text = await readFile(await saveNote({ notesDir, turns, title: "x", now }), "utf8");
    expect(text).toContain("````text\nExplain this:\n```ts\nconst a = 1;\n```\n````");
  });

  it("says when turns were dropped from the Session", async () => {
    const text = await readFile(await saveNote({ notesDir, turns: [turns[0]!, { number: 4, user: "q", assistant: "a" }], title: "x", now }), "utf8");
    expect(text).toContain("Turns 2, 3 were dropped");
  });

  it("adds one line when a turn included a file that is normally excluded, and not otherwise", async () => {
    const plain = await readFile(await saveNote({ notesDir, turns, title: "plain", now }), "utf8");
    expect(plain).not.toContain("normally excluded");
    const flagged = [turns[0]!, { number: 2, user: "with .env", assistant: "ok", sensitive: true }];
    const text = await readFile(await saveNote({ notesDir, turns: flagged, title: "flagged", now }), "utf8");
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/contains code/);
    expect(text.match(/normally excluded/g)).toHaveLength(1);
    expect(text).toContain("this note includes content from a file normally excluded.");
  });

  it("strips terminal escape sequences from what it stores", async () => {
    const evil = [{ number: 1, user: "q", assistant: "ok\u001b]0;pwned\u0007\u001b[31mred" }];
    const text = await readFile(await saveNote({ notesDir, turns: evil, title: "x", now }), "utf8");
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u0007");
  });

  it.each(["../../x", "..", "/etc/passwd", "a/b\\c", "....//....//x", ""])("a slug such as %j stays inside the notes directory", async (title) => {
    const path = await saveNote({ notesDir, turns, title, now });
    const root = await realNotes();
    expect(path.startsWith(`${root}/`)).toBe(true);
    expect(path.slice(root.length + 1)).not.toContain("/");
    expect(await readdir(dir)).toEqual(["notes"]);
  });

  it("never overwrites: a second save the same day gets a new name", async () => {
    const first = await saveNote({ notesDir, turns, title: "same", now });
    const second = await saveNote({ notesDir, turns: [{ number: 1, user: "other", assistant: "other" }], title: "same", now });
    const third = await saveNote({ notesDir, turns, title: "same", now });
    expect(new Set([first, second, third]).size).toBe(3);
    expect(await readFile(first, "utf8")).toContain("Because it never changes.");
    expect(await readFile(second, "utf8")).toContain("other");
  });

  it("refuses a notes directory path that is a file", async () => {
    await writeFile(join(dir, "file"), "");
    await expect(saveNote({ notesDir: join(dir, "file"), turns, title: "x", now })).rejects.toThrow(/notes directory/);
  });

  it("writes through a symlinked notes directory, but only inside its real path", async () => {
    await mkdir(join(dir, "real"));
    await symlink(join(dir, "real"), join(dir, "link"));
    const path = await saveNote({ notesDir: join(dir, "link"), turns, title: "x", now });
    expect(path.startsWith(join(await (await import("node:fs/promises")).realpath(dir), "real"))).toBe(true);
  });

  it("creates files private to the owner", async () => {
    const path = await saveNote({ notesDir, turns, title: "x", now });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});

describe("appendGlossaryEntry", () => {
  it("appends entries to one glossary file in the notes directory", async () => {
    await appendGlossaryEntry({ notesDir, term: "closure", definition: "a function plus the variables it captured", now });
    const path = await appendGlossaryEntry({ notesDir, term: "hoisting", definition: "declarations move to the top of their scope", now });
    const text = await readFile(path, "utf8");
    expect(path).toBe(join(await realNotes(), "glossary.md"));
    expect(text).toContain("**closure**: a function plus the variables it captured");
    expect(text).toContain("**hoisting**: declarations move to the top of their scope");
    expect(text.indexOf("closure")).toBeLessThan(text.indexOf("hoisting"));
  });

  it("does not follow a symlinked glossary file out of the notes directory", async () => {
    await mkdir(notesDir);
    await writeFile(join(dir, "outside.md"), "keep");
    await symlink(join(dir, "outside.md"), join(notesDir, "glossary.md"));
    await expect(appendGlossaryEntry({ notesDir, term: "t", definition: "d", now })).rejects.toThrow();
    expect(await readFile(join(dir, "outside.md"), "utf8")).toBe("keep");
  });

  it("refuses a glossary file with a second hard link, and writes nothing through it", async () => {
    await mkdir(notesDir);
    await writeFile(join(dir, "outside.md"), "keep");
    await link(join(dir, "outside.md"), join(notesDir, "glossary.md"));
    await expect(appendGlossaryEntry({ notesDir, term: "t", definition: "d", now })).rejects.toThrow(/more than one link|hard link/);
    expect(await readFile(join(dir, "outside.md"), "utf8")).toBe("keep");
  });

  it("keeps a multi-line definition on one entry", async () => {
    const path = await appendGlossaryEntry({ notesDir, term: "a\nb", definition: "x\ny", now });
    expect((await readFile(path, "utf8")).split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
  });
});

async function realNotes(): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(notesDir);
}

describe("findRepoAround", () => {
  it("finds the repository around a directory that does not exist yet, and nothing outside one", async () => {
    execFileSync("git", ["init", "-q", join(dir)]);
    expect(await findRepoAround(join(dir, "a", "b"))).toMatchObject({ root: await realpath(dir) });
    const elsewhere = await mkdtemp(join(tmpdir(), "learn-norepo-"));
    expect(await findRepoAround(join(elsewhere, "notes"))).toBeUndefined();
  });
});
