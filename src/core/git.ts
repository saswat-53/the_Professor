import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { UnexpectedError, UsageError } from "./errors.js";

/** The only git subcommands learn will ever run: all read-only. */
const ALLOWED = ["log", "diff", "blame", "show", "rev-parse"] as const;
export type GitSubcommand = (typeof ALLOWED)[number];

export interface GitRepo {
  root: string;
  shallow: boolean;
  hasCommits: boolean;
}

export interface GitOptions {
  /** Flags chosen by our own code, never by the user. */
  args?: string[];
  /** Revisions from the user; a leading dash would be read by git as a flag, so it is rejected. */
  refs?: string[];
  /** Files from the user; each must stay inside the root and is placed after `--`. */
  paths?: string[];
  signal?: AbortSignal;
}

const MAX_OUTPUT = 64 * 1024 * 1024;

// Config that stops git from launching anything else: a pager, an external diff driver.
const LOCKDOWN = ["--no-pager", "-c", "core.pager=cat", "-c", "diff.external="];
const NO_EXTERNAL_DIFF: Partial<Record<GitSubcommand, string[]>> = {
  diff: ["--no-ext-diff", "--no-textconv"],
  log: ["--no-ext-diff", "--no-textconv"],
  show: ["--no-ext-diff", "--no-textconv"],
  blame: ["--no-textconv"],
};

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // These would redirect git to another repo or program.
  for (const key of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|EXTERNAL_DIFF|PAGER|CONFIG.*|ALTERNATE_OBJECT_DIRECTORIES|OBJECT_DIRECTORY)$/.test(key)) {
      delete env[key];
    }
  }
  env.GIT_PAGER = "cat";
  env.GIT_LITERAL_PATHSPECS = "1";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

/** Git ran but said no (for example "not a git repository"); anything else is a failure to run git at all. */
class GitExitError extends UnexpectedError {}

function spawnGit(cwd: string, argv: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((done, fail) => {
    // execFile runs git directly with an argument list: no shell ever sees these strings.
    execFile(
      "git",
      argv,
      { cwd, env: cleanEnv(), maxBuffer: MAX_OUTPUT, encoding: "utf8", signal },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          const subcommand = argv.find((a) => (ALLOWED as readonly string[]).includes(a)) ?? "";
          const Failure = typeof error.code === "number" ? GitExitError : UnexpectedError;
          fail(Object.assign(new Failure(`git ${subcommand} failed: ${detail}`), { cause: error }));
        } else done(stdout);
      },
    );
  });
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}

/** Lexical check, then again on the real path so a symlink inside the root cannot lead outside it. */
function insideRoot(root: string, path: string): boolean {
  const full = resolve(root, path);
  if (!within(root, full)) return false;
  try {
    return within(realpathSync(root), realpathSync(full));
  } catch {
    return true; // does not exist (for example a deleted file in history): nothing to follow
  }
}

/** Runs one read-only git command inside `root`, after checking every argument. */
export async function runGit(root: string, subcommand: GitSubcommand, options: GitOptions = {}): Promise<string> {
  if (!(ALLOWED as readonly string[]).includes(subcommand)) {
    throw new UsageError(`git ${subcommand} is not allowed: learn only runs ${ALLOWED.join(", ")}`);
  }
  const { args = [], refs = [], paths = [], signal } = options;
  for (const ref of refs) {
    if (ref.startsWith("-")) throw new UsageError(`"${ref}" is not a valid git revision`);
  }
  for (const path of paths) {
    if (!insideRoot(root, path)) throw new UsageError(`"${path}" is outside the project root`);
  }
  const argv = [...LOCKDOWN, subcommand, ...(NO_EXTERNAL_DIFF[subcommand] ?? []), ...args, ...refs];
  if (paths.length > 0) argv.push("--", ...paths);
  return spawnGit(root, argv, signal);
}

/** Finds the repository containing `cwd` using git's own root detection, or undefined outside one. */
export async function findRepo(cwd: string): Promise<GitRepo | undefined> {
  let root: string;
  try {
    root = (await spawnGit(cwd, [...LOCKDOWN, "rev-parse", "--show-toplevel"])).trim();
  } catch (error) {
    if (error instanceof GitExitError) return undefined;
    throw error;
  }
  const shallow = (await runGit(root, "rev-parse", { args: ["--is-shallow-repository"] })).trim() === "true";
  const hasCommits = await runGit(root, "rev-parse", { args: ["--verify", "-q", "HEAD"] }).then(
    () => true,
    () => false,
  );
  return { root, shallow, hasCommits };
}
