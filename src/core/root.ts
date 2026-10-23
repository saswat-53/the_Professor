import { realpath } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { FileNotFoundError, PathEscapeError, UsageError } from "./errors.js";
import { findRepo } from "./git.js";

/**
 * `realpath.native` asks the operating system, which reports a folder's true letter case. The
 * JavaScript `realpath` keeps whatever case was typed, so on a case-insensitive disk (the macOS
 * default) the same folder spelled two ways would look like two different places.
 */
const real = promisify(realpath.native);

export interface ProjectRoot {
  /** Real path of the directory learn treats as "the project". */
  root: string;
  /** True when the root is the user's home directory, which is almost never what they mean. */
  isHome: boolean;
}

/**
 * The root is the explicit `--root` directory if given, else the git root above `cwd` (found by
 * the hardened git runner), else `cwd` itself. Always a real path, so symlinks cannot disguise it.
 */
export async function findProjectRoot(cwd: string, explicit?: string): Promise<ProjectRoot> {
  const start = explicit !== undefined ? resolve(cwd, explicit) : ((await findRepo(cwd))?.root ?? cwd);
  const root = await real(start).catch(() => {
    throw new UsageError(`the project root ${start} does not exist`);
  });
  if (!(await stat(root)).isDirectory()) throw new UsageError(`the project root ${start} is not a directory`);
  // Labels are relative to the root, so a filesystem root would turn them into absolute paths that include the home directory.
  if (explicit !== undefined && root === dirname(root)) {
    throw new UsageError("--root cannot be the filesystem root: labels would reveal full paths; pick a narrower directory");
  }
  return { root, isHome: root === (await real(homedir()).catch(() => homedir())) };
}

/** `child` is inside `root` when the relative path between them does not climb out. Comparing relative paths (not string prefixes) keeps `app-secrets` from passing as inside `app`. */
export function isInside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export interface LocatedFile {
  /** The real path, after following symlinks: the only path ever opened. */
  real: string;
  /** The project-relative name shown to the model; never absolute. */
  name: string;
}

/**
 * Follows symlinks, then refuses anything that ends up outside the root. A file with no repo and
 * no `--root` can only be inside the current directory, so "elsewhere" is simply outside the root.
 */
export async function locateFile(root: string, cwd: string, path: string): Promise<LocatedFile> {
  const target = resolve(cwd, path);
  const resolved = await real(target).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") throw new FileNotFoundError(`${path}: no such file`);
    throw err;
  });
  if (!isInside(root, resolved)) {
    throw new PathEscapeError(
      `${path} is outside the project root; pass --root <dir> to allow reading outside it`,
    );
  }
  return { real: resolved, name: relative(root, resolved) };
}
