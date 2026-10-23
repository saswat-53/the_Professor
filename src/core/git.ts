import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ContextTooLongError, UnexpectedError, UntrustedRepoError, UsageError } from "./errors.js";

/** The only git subcommands learn will ever run: all read-only. */
const ALLOWED = ["log", "diff", "blame", "show", "rev-parse", "check-ignore"] as const;
export type GitSubcommand = (typeof ALLOWED)[number];

/** Exit codes that are an answer, not a failure: check-ignore exits 1 when nothing is ignored. */
const ANSWER_EXIT: Partial<Record<GitSubcommand, number>> = { "check-ignore": 1 };

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
  /** Longest git may run before it is killed. Default 30 seconds. */
  timeoutMs?: number;
  /** Most output accepted; more is a ContextTooLongError, never silent truncation. Default 64 MB. */
  maxOutputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024;

// Config that stops git from launching anything a repo's own config names: a pager, an external
// diff driver, a filesystem monitor (core.fsmonitor runs a program on diff/status), hooks, and a
// global attributes file that could route files to textconv filters. `-c` beats repo config.
// Read-only matters too: `git diff` rewrites .git/index to refresh stale stat data, and neither
// GIT_OPTIONAL_LOCKS=0 nor --no-optional-locks stops it; diff.autoRefreshIndex=false does.
const LOCKDOWN = [
  "--no-pager",
  "--no-optional-locks",
  "-c", "core.pager=cat",
  "-c", "diff.external=",
  "-c", "diff.autoRefreshIndex=false",
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.attributesFile=/dev/null",
];
const NO_EXTERNAL_DIFF: Partial<Record<GitSubcommand, string[]>> = {
  diff: ["--no-ext-diff", "--no-textconv"],
  log: ["--no-ext-diff", "--no-textconv"],
  show: ["--no-ext-diff", "--no-textconv"],
  blame: ["--no-textconv"],
};

function cleanEnv(subcommand: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // These would redirect git to another repo or program.
  for (const key of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|EXTERNAL_DIFF|PAGER|CONFIG.*|ALTERNATE_OBJECT_DIRECTORIES|OBJECT_DIRECTORY)$/.test(key)) {
      delete env[key];
    }
  }
  env.GIT_PAGER = "cat";
  // check-ignore takes plain paths and rejects the pathspec magic this setting adds.
  if (subcommand !== "check-ignore") env.GIT_LITERAL_PATHSPECS = "1";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

/** Git ran but said no (for example "not a git repository"); anything else is a failure to run git at all. */
class GitExitError extends UnexpectedError {
  constructor(
    message: string,
    readonly gitStatus: number,
  ) {
    super(message);
  }
}

interface SpawnOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function spawnGit(cwd: string, subcommand: string, argv: string[], opts: SpawnOptions = {}): Promise<string> {
  return new Promise((done, fail) => {
    // execFile runs git directly with an argument list: no shell ever sees these strings.
    execFile(
      "git",
      argv,
      {
        cwd,
        env: cleanEnv(subcommand),
        maxBuffer: opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT,
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        encoding: "utf8",
        signal: opts.signal,
      },
      (error, stdout, stderr) => {
        if (!error) return done(stdout);
        const code = (error as { code?: unknown }).code;
        const detail = stderr.trim() || error.message;
        if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          const limit = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
          return fail(
            new ContextTooLongError(
              `git ${subcommand} output is larger than the ${limit}-byte limit (this is git's output, not a file): ` +
                "narrow the line range, the number of commits, or the paths",
            ),
          );
        }
        if ((error as { killed?: boolean }).killed && !opts.signal?.aborted) {
          return fail(new UnexpectedError(`git ${subcommand} timed out`, { cause: error }));
        }
        // Git refuses repos owned by someone else. That is a protection, so say so; never bypass it.
        if (/dubious ownership/i.test(stderr)) {
          return fail(
            new UntrustedRepoError(
              "git refuses this repository because it is owned by another user (dubious ownership). " +
                "If you trust it, mark it safe yourself with `git config --global --add safe.directory <path>`.",
            ),
          );
        }
        const message = `git ${subcommand} failed: ${detail}`;
        fail(typeof code === "number" ? new GitExitError(message, code) : new UnexpectedError(message, { cause: error }));
      },
    );
  });
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}

/** The real path of the nearest part of `path` that exists; a deleted file is judged by its directory. */
function realExisting(path: string): string {
  for (let p = path; ; p = dirname(p)) {
    try {
      return realpathSync(p);
    } catch {
      if (dirname(p) === p) return path;
    }
  }
}

/** Lexical check, then again on the real path so a symlink inside the root cannot lead outside it. */
function insideRoot(root: string, path: string): boolean {
  const full = resolve(root, path);
  return within(root, full) && within(realpathSync(root), realExisting(full));
}

/** Runs one read-only git command inside `root`, after checking every argument. */
export async function runGit(root: string, subcommand: GitSubcommand, options: GitOptions = {}): Promise<string> {
  if (!(ALLOWED as readonly string[]).includes(subcommand)) {
    throw new UsageError(`git ${subcommand} is not allowed: learn only runs ${ALLOWED.join(", ")}`);
  }
  const { args = [], refs = [], paths = [] } = options;
  for (const ref of refs) {
    if (ref.startsWith("-")) throw new UsageError(`"${ref}" is not a valid git revision`);
  }
  for (const path of paths) {
    if (!insideRoot(root, path)) throw new UsageError(`"${path}" is outside the project root`);
  }
  const argv = [...LOCKDOWN, subcommand, ...(NO_EXTERNAL_DIFF[subcommand] ?? []), ...args, ...refs];
  if (paths.length > 0) argv.push("--", ...paths);
  try {
    return await spawnGit(root, subcommand, argv, options);
  } catch (error) {
    if (error instanceof GitExitError && error.gitStatus === ANSWER_EXIT[subcommand]) return "";
    throw error;
  }
}

/** Finds the repository containing `cwd` using git's own root detection, or undefined outside one. */
export async function findRepo(cwd: string): Promise<GitRepo | undefined> {
  let root: string;
  try {
    root = (await spawnGit(cwd, "rev-parse", [...LOCKDOWN, "rev-parse", "--show-toplevel"])).trim();
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
