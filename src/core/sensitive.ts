import { homedir } from "node:os";
import { basename, dirname, relative, sep } from "node:path";
import { BlockedFileError } from "./errors.js";
import { findRepo, runGit } from "./git.js";
import { readTextFile } from "./read-file.js";
import { locateFile } from "./root.js";

interface Rule {
  name: string;
  /** Gets the whole path with `/` separators and its last segment, so a rule can name a directory. */
  test: (path: string, base: string) => boolean;
}

const named = (name: string): Rule => ({ name, test: (_p, b) => b.toLowerCase() === name });
const ext = (name: string, pattern: RegExp): Rule => ({ name, test: (_p, b) => pattern.test(b) });
const inDir = (name: string): Rule => ({ name, test: (p) => `/${p}`.toLowerCase().endsWith(`/${name}`) });

const DENYLIST: Rule[] = [
  named(".env"),
  { name: ".env.*", test: (_p, b) => b.toLowerCase().startsWith(".env.") },
  ext("*.pem", /\.pem$/i),
  ext("*.key", /\.key$/i),
  ext("*.p12", /\.(p12|pfx)$/i),
  ext("*.crt", /\.(crt|cer|der)$/i),
  ext("*.jks", /\.(jks|keystore)$/i),
  ext("*.tfstate", /\.tfstate(\.backup)?$/i),
  ext("*.tfvars", /\.tfvars(\.json)?$/i),
  { name: "ssh key", test: (_p, b) => /^id_(rsa|dsa|ecdsa|ed25519)$/i.test(b) },
  named(".netrc"),
  named(".npmrc"),
  named(".pgpass"),
  named(".git-credentials"),
  named(".pypirc"),
  named(".htpasswd"),
  named(".envrc"),
  named(".vault-token"),
  ext("*.kdbx", /\.kdbx$/i),
  inDir(".aws/credentials"),
  inDir(".docker/config.json"),
  inDir(".kube/config"),
  inDir(".git/config"),
  // Last, so the specific rules above name themselves first.
  { name: "secret", test: (_p, b) => /(^|[._-])(secrets?|credentials|private[._-]?key)([._-]|$)/i.test(b) },
];

/** The name of the first denylist rule that matches the path, if any. */
export function denylistRule(file: string): string | undefined {
  const path = file.split(sep).join("/");
  const base = basename(file);
  const rule = DENYLIST.find((r) => r.test(path, base));
  // An SSH key is reported by its exact name; the public `.pub` halves are fine.
  return rule?.name === "ssh key" ? base : rule?.name;
}

/** True for localhost, 127.0.0.1 and ::1 only; the check is on the parsed host, so `localhost.evil.example` is not exempt. */
export function isLocalHost(baseUrl: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * `--no-index` makes git apply ignore rules even to files already tracked: a file committed and
 * only later gitignored is still a file its owner decided not to share. A file added with
 * `git add -f` against a matching pattern is refused too. If git cannot run, this throws and the
 * read is refused (fail closed); the denylist, checked first, does not need git.
 *
 * `-v` makes git say which pattern in which file matched, as `source:line:pattern<TAB>path`, so a
 * refusal in a cloned repo (or from a global ignore file) can name where it came from. A pattern
 * starting with `!` is a negation that un-ignored the file, not a match.
 * Returns that description, or undefined when the file is not ignored.
 */
async function ignoredBy(real: string): Promise<string | undefined> {
  const repo = await findRepo(dirname(real));
  if (!repo) return undefined;
  const out = await runGit(repo.root, "check-ignore", { args: ["--no-index", "-v"], paths: [relative(repo.root, real)] });
  const match = /^(.*):(\d+):(.*)\t/.exec(out.split("\n")[0] ?? "");
  if (!match || match[3]!.startsWith("!")) return undefined;
  const source = match[1]!.startsWith(homedir()) ? `~${match[1]!.slice(homedir().length)}` : match[1]!;
  return `ignored by ${source}:${match[2]}, pattern "${match[3]}"`;
}

export interface FileReaderOptions {
  root: string;
  cwd: string;
  /** `--allow-sensitive`: skip the refusal for this run. */
  allowSensitive?: boolean;
  /** Where the content will be sent; a localhost endpoint sends nothing off the machine, so the refusal is skipped. */
  baseUrl?: string;
  /** Replaces the raw text reader (tests). */
  readText?: (path: string) => Promise<string>;
}

export interface FileReader {
  read(path: string): Promise<{ text: string; name: string }>;
}

/**
 * The only way core reads user files. Locating (symlinks, project root) and the sensitive-file
 * check both happen here, before any byte is read, so no feature can read around them.
 */
export function createFileReader(options: FileReaderOptions): FileReader {
  const readText = options.readText ?? readTextFile;
  const exempt = options.allowSensitive === true || (options.baseUrl !== undefined && isLocalHost(options.baseUrl));
  return {
    async read(path) {
      const { real, name } = await locateFile(options.root, options.cwd, path);
      if (!exempt) {
        // Both names are checked: a harmless-looking link to `.env` and a `.env` link to a harmless file are each caught.
        const rule = denylistRule(real) ?? denylistRule(path);
        if (rule) throw new BlockedFileError(name, rule);
        const source = await ignoredBy(real);
        if (source) throw new BlockedFileError(name, "gitignore", source);
      }
      return { text: await readText(real), name };
    },
  };
}
