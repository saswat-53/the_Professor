import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { BlockedFileError, ruleName } from "./errors.js";
import type { BlockReason } from "./errors.js";
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
  // Well-known credential file names, each one a convention in common tools; no broad wildcards.
  { name: "service-account*.json", test: (_p, b) => /^service[-_]?account.*\.json$/i.test(b) },
  named("token.txt"),
  named("id_token"),
  ext("*.token", /\.token$/i),
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

/** The parsed host of the endpoint (not a string match), or undefined when the URL does not parse. */
export function endpointHost(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
}

/** True for localhost, 127.0.0.1 and ::1 only; the check is on the parsed host, so `localhost.evil.example` is not exempt. */
export function isLocalHost(baseUrl: string): boolean {
  const host = endpointHost(baseUrl);
  return host !== undefined && ["localhost", "127.0.0.1", "[::1]"].includes(host);
}

/**
 * `--no-index` makes git apply ignore rules even to files already tracked: a file committed and
 * only later gitignored is still a file its owner decided not to share. A file added with
 * `git add -f` against a matching pattern is refused too. If git cannot run, this throws and the
 * read is refused (fail closed); the denylist, checked first, does not need git.
 *
 * `-v` makes git say which pattern in which file matched, as `source:line:pattern<TAB>path`, so a
 * refusal in a cloned repo (or from a global ignore file) can name where it came from.
 * Returns why it is ignored, or undefined when the file is not ignored.
 */
async function ignoredBy(real: string): Promise<BlockReason | undefined> {
  const repo = await findRepo(dirname(real));
  if (!repo) return undefined;
  const out = await runGit(repo.root, "check-ignore", { args: ["--no-index", "-v"], paths: [relative(repo.root, real)] });
  return interpretCheckIgnore(out);
}

/**
 * Fail closed: any output means "ignored" unless the first line is positively recognised as a
 * negated (`!`) pattern, which git reports with exit 0 although it un-ignores the file. The parse
 * only fills in the details; an unparseable line still refuses (with no details). Git prints one
 * line per path (the pattern it applied, even when several ignore files match), but if it ever
 * printed more, that is also refused rather than guessing which line wins. The line splits at the
 * first tab (the path after it may hold anything); before it, `source:line:` is the first
 * `:<digits>:` and the pattern is the rest, so a colon inside the pattern is harmless.
 */
export function interpretCheckIgnore(output: string): BlockReason | undefined {
  if (output === "") return undefined;
  const lines = output.split("\n").filter((l) => l !== "");
  if (lines.length !== 1) return { kind: "gitignore" };
  const line = lines[0] ?? "";
  const tab = line.indexOf("\t");
  const parts = /^(.*?):(\d+):(.*)$/.exec(tab === -1 ? line : line.slice(0, tab));
  const [, source, lineNumber, pattern] = parts ?? [];
  if (pattern?.startsWith("!")) return undefined;
  if (source === undefined) return { kind: "gitignore" };
  return { kind: "gitignore", source: tildeHome(source), line: Number(lineNumber), pattern };
}

/** Replaces the real home directory with `~`, so the full path (and the username in it) is never printed. */
function tildeHome(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
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

/** A Sensitive file that was read anyway, and why: for the Context report. */
export interface SensitiveBypass {
  file: string;
  rule: string;
  /** "flag": `--allow-sensitive` was passed. "local-endpoint": the endpoint is on this machine. */
  by: "flag" | "local-endpoint";
  /** Where the content goes: the endpoint's parsed host. */
  host?: string;
}

export interface FileReader {
  read(path: string): Promise<{ text: string; name: string }>;
  /** Every Sensitive file this reader has read despite its rule, once each. */
  readonly bypassed: readonly SensitiveBypass[];
}

/** Why the file counts as sensitive, if it does. Both names are checked: a link and its target can each be the one that matches. */
async function sensitiveReason(real: string, path: string, cwd: string): Promise<BlockReason | undefined> {
  const rule = denylistRule(real) ?? denylistRule(path);
  if (rule) return { kind: "denylist", name: rule };
  const link = join(await realpath(dirname(resolve(cwd, path))), basename(path));
  return (await ignoredBy(real)) ?? (link === real ? undefined : await ignoredBy(link));
}

/**
 * The only way core reads user files. Locating (symlinks, project root) and the sensitive-file
 * check both happen here, before any byte is read, so no feature can read around them. When the
 * check does not apply (the flag, or a local endpoint) it still runs, so the Context report can
 * say what was let through; there a failure to check (git cannot run) just means no note.
 */
export function createFileReader(options: FileReaderOptions): FileReader {
  const readText = options.readText ?? readTextFile;
  const by = options.allowSensitive === true ? "flag" : options.baseUrl !== undefined && isLocalHost(options.baseUrl) ? "local-endpoint" : undefined;
  const host = options.baseUrl === undefined ? undefined : endpointHost(options.baseUrl);
  const bypassed: SensitiveBypass[] = [];
  return {
    bypassed,
    async read(path) {
      const { real, name } = await locateFile(options.root, options.cwd, path);
      const reason = by ? await sensitiveReason(real, path, options.cwd).catch(() => undefined) : await sensitiveReason(real, path, options.cwd);
      if (reason) {
        if (!by) throw new BlockedFileError(name, reason);
        if (!bypassed.some((b) => b.file === name)) bypassed.push({ file: name, rule: ruleName(reason), by, ...(host !== undefined && { host }) });
      }
      return { text: await readText(real), name };
    },
  };
}
