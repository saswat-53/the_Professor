// ADR 0002: core never imports cli, never touches the terminal, never writes files.
export const RULE = {
  cli: "core imports from cli",
  stdio: "core touches stdout, stderr, stdin or argv",
  terminal: "core imports a terminal library",
  write: "core uses a file-write API",
} as const;

const TERMINAL_LIBS =
  /^(node:)?(readline(\/promises)?|tty)$|^(ink|chalk|picocolors|kleur|colorette|ansis|ora|yargs|enquirer|blessed|commander|prompts|inquirer|@clack\/prompts|ansi-[\w-]+)(\/|$)/;
const WRITE_NAMES =
  "writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|symlink|link|chmod|truncate|truncateSync|createWriteStream|write|writeSync|writev";
const FS_MODULE = /^(node:)?fs(\/promises)?$/;

// Files exempt from the file-write rule only. Reserved for the notes writer
// from ticket 36 (/save): empty until then, at most one entry, matched by
// path relative to src/core.
export const WRITE_ALLOWLIST: string[] = [];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function specifiers(src: string): string[] {
  const re = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g;
  return [...src.matchAll(re)].map((m) => m[1]!);
}

export function findViolations(path: string, source: string): string[] {
  const src = stripComments(source);
  const specs = specifiers(src);
  const found: string[] = [];
  if (specs.some((s) => /^(\.\.?\/)*\.\.\/cli(\/|$)/.test(s) || /^\.\/cli(\/|$)/.test(s))) found.push(RULE.cli);
  if (/\bprocess\s*(\.|\[\s*["'])\s*(stdout|stderr|stdin|argv)\b/.test(src) || /\}\s*=\s*process\b/.test(src))
    found.push(RULE.stdio);
  if (specs.some((s) => TERMINAL_LIBS.test(s))) found.push(RULE.terminal);
  const writes =
    new RegExp(`\\b(${WRITE_NAMES})\\s*\\(`).test(src) ||
    new RegExp(`\\b(${WRITE_NAMES})\\b[^;]*\\bfrom\\s*["'](node:)?fs`).test(src) ||
    (specs.some((s) => FS_MODULE.test(s)) && new RegExp(`\\b(${WRITE_NAMES})\\b`).test(src));
  if (writes && !WRITE_ALLOWLIST.includes(path)) found.push(RULE.write);
  return found;
}
