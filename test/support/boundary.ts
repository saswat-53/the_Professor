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
  "writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|symlink|link|chmod|truncate|truncateSync|createWriteStream|writeSync|writev";

// Files exempt from the file-write rule only. Reserved for the notes writer
// from ticket 36 (/save): empty until then, at most one entry, matched by
// path relative to src/core.
export const WRITE_ALLOWLIST: string[] = [];

export interface Violation {
  rule: string;
  line: number;
  text: string;
}

// Blank out comments but keep newlines so line numbers stay true.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, (_, pre) => pre);
}

export function findViolations(path: string, source: string): Violation[] {
  const src = stripComments(source);
  const lines = src.split("\n");
  const found: Violation[] = [];
  const add = (rule: string, index: number) => {
    const line = src.slice(0, index).split("\n").length;
    found.push({ rule, line, text: lines[line - 1]!.trim() });
  };

  for (const m of src.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g)) {
    const spec = m[1]!;
    if (/^(\.\.?\/)*\.\.\/cli(\/|$)/.test(spec) || /^\.\/cli(\/|$)/.test(spec)) add(RULE.cli, m.index);
    if (TERMINAL_LIBS.test(spec)) add(RULE.terminal, m.index);
  }
  for (const m of src.matchAll(/\bprocess\s*(?:\.|\[\s*["'])\s*(?:stdout|stderr|stdin|argv)\b|\}\s*=\s*process\b/g))
    add(RULE.stdio, m.index);

  if (!WRITE_ALLOWLIST.includes(path)) {
    const writes = [
      new RegExp(`\\b(?:${WRITE_NAMES})\\s*\\(`, "g"),
      // named imports from fs, including the bare `write`, which is only a file write there
      new RegExp(`\\b(?:${WRITE_NAMES}|write)\\b[^;]*\\bfrom\\s*["'](?:node:)?fs`, "g"),
    ];
    for (const re of writes) for (const m of src.matchAll(re)) add(RULE.write, m.index);
  }
  return found;
}
