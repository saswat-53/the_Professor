import { basename, dirname, relative } from "node:path";
import { BlockedFileError } from "./errors.js";
import { findRepo, runGit } from "./git.js";
import { readTextFile } from "./read-file.js";
import { locateFile } from "./root.js";

interface Rule {
  name: string;
  test: (file: string) => boolean;
}

const DENYLIST: Rule[] = [
  { name: ".env", test: (f) => f.toLowerCase() === ".env" },
  { name: ".env.*", test: (f) => f.toLowerCase().startsWith(".env.") },
  { name: "*.pem", test: (f) => /\.pem$/i.test(f) },
  { name: "*.key", test: (f) => /\.key$/i.test(f) },
  { name: "*.p12", test: (f) => /\.(p12|pfx)$/i.test(f) },
  { name: "*.crt", test: (f) => /\.(crt|cer|der)$/i.test(f) },
  { name: "*.jks", test: (f) => /\.(jks|keystore)$/i.test(f) },
  { name: "secret", test: (f) => /(^|[._-])(secrets?|credentials|private[._-]?key)([._-]|$)/i.test(f) },
  { name: ".netrc", test: (f) => f.toLowerCase() === ".netrc" },
  { name: ".npmrc", test: (f) => f.toLowerCase() === ".npmrc" },
  { name: ".pgpass", test: (f) => f.toLowerCase() === ".pgpass" },
];

/** The name of the first denylist rule that matches the file's own name, if any. */
export function denylistRule(file: string): string | undefined {
  const name = basename(file);
  // SSH private keys: report the exact name (the public `.pub` halves are fine).
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/i.test(name)) return name;
  return DENYLIST.find((rule) => rule.test(name))?.name;
}

/** True for localhost, 127.0.0.1 and ::1 only; the check is on the parsed host, so `localhost.evil.example` is not exempt. */
export function isLocalHost(baseUrl: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

async function isGitIgnored(real: string): Promise<boolean> {
  const repo = await findRepo(dirname(real));
  if (!repo) return false;
  return (await runGit(repo.root, "check-ignore", { paths: [relative(repo.root, real)] })).trim() !== "";
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
        const rule = denylistRule(real) ?? denylistRule(path) ?? ((await isGitIgnored(real)) ? "gitignore" : undefined);
        if (rule) {
          throw new BlockedFileError(
            `${name}: blocked because it may hold secrets (rule: ${rule}); pass --allow-sensitive to send it anyway`,
          );
        }
      }
      return { text: await readText(real), name };
    },
  };
}
