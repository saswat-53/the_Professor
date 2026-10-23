import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { PathEscapeError, UsageError } from "./errors.js";
import { findRepo } from "./git.js";

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
  const root = await realpath(start).catch(() => {
    throw new UsageError(`the project root ${start} does not exist`);
  });
  return { root, isHome: root === (await realpath(homedir()).catch(() => homedir())) };
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
  const real = await realpath(resolve(cwd, path));
  if (!isInside(root, real)) {
    throw new PathEscapeError(
      `${path} is outside the project root; pass --root <dir> to allow reading outside it`,
    );
  }
  return { real, name: relative(root, real) };
}
