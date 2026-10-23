import type { BlockFinder, LineSpan } from "./context.js";

/** File extensions (lower case, no dot) written with braces that this finder understands. */
export const BRACE_EXTENSIONS: ReadonlySet<string> = new Set(
  "ts tsx js jsx mjs cjs java kt c h cc cpp hpp cs go rs php swift".split(" "),
);

const JS_FAMILY = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);

/** A statement that opens a braced body but is not a function, method or class. */
// `select(x) {` is a method; `select x {` and `when (x) {` are statements. Only reserved words can be
// told apart by name alone, so the soft ones must be followed by a space.
const CONTROL =
  /^(?:else\s+)?(?:(?:if|for|foreach|while|switch|catch|do|try|finally|else|synchronized)\b|(?:using|lock|with|when|match|loop|select)(?=\s|$))/;
/** Languages where `=> {` opens a function. In Rust it is a match arm. */
const ARROW_FUNCTIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "cs", "php"]);
/** Words that introduce a type or function declaration. The lookbehind rejects `x.record`. */
const DECLARATION =
  /(?<![.\w])(?:class|interface|struct|enum|trait|impl|namespace|object|record|function|fn|func|fun|init|constructor|union|extension|protocol|actor)\b/;
/** A header that is the start of a value or expression, not a declaration. */
const EXPRESSION_TAIL = /(?:[=,(:[]|\breturn)$/;
/** `)` plus whatever may follow a parameter list: a return type, `throws X`, `const`, `-> T`. */
const AFTER_PARAMS = /\)\s*(?:(?::|->)[^()]*|\b(?:throws|const|override|final|noexcept|where)\b[^()]*)?$/;

/** Decides whether the text before a `{` introduces a function, method or class body. */
function isBlockHeader(header: string, inGoControl: boolean, ext: string): boolean {
  const h = header.replace(/\s+/g, " ").trim();
  if (!h || inGoControl || CONTROL.test(h) || EXPRESSION_TAIL.test(h)) return false;
  return DECLARATION.test(h) || (ARROW_FUNCTIONS.has(ext) && /=>$/.test(h)) || AFTER_PARAMS.test(h);
}

const DIRECTIVE = /^(?:#|package\b|import\b|use\b|using\b[^(]*$)/;
/** Languages that end a statement at the newline, so a header cannot carry over it. */
const NEWLINE_TERMINATED = new Set(["go", "kt"]);

/** Whether a newline ends the pending header: a directive line, or a complete statement in Go and Kotlin. */
function endsStatement(header: string, ext: string): boolean {
  const h = header.trim();
  if (!h) return false;
  return DIRECTIVE.test(h) || (NEWLINE_TERMINATED.has(ext) && !/[,(+\-*/&|=:.<>]$/.test(h));
}

interface Open {
  /** Line of the first code token of the header; the span starts here. */
  line: number;
  isBlock: boolean;
  /** Paren depth outside this `{`, restored when it closes. */
  parens: number;
}

/**
 * Finds every braced function, method or class body by scanning the text once. Strings, comments,
 * template literals, char literals and (in JS/TS) regex literals are skipped so their braces are
 * not counted. Returns every block's span; null when the braces do not balance, because a wrong
 * block is worse than the fallback window.
 */
function findBlocks(lines: readonly string[], ext: string): LineSpan[] | null {
  const text = lines.join("\n");
  const blocks: LineSpan[] = [];
  const stack: Open[] = [];
  let header = "";
  let headerLine = 0;
  let line = 1;
  let parens = 0;
  let goControl: boolean = false;
  let lastSignificant = "";

  const addCode = (ch: string) => {
    if (!header && /\s/.test(ch)) return;
    if (!header) headerLine = line;
    header += ch;
  };
  const reset = () => {
    header = "";
    goControl = false;
  };
  const skipTo = (end: number, from: number) => {
    const stop = end === -1 ? text.length : end;
    for (let k = from; k < stop; k++) if (text[k] === "\n") line++;
    return stop;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === "\n") {
      line++;
      if (parens === 0 && endsStatement(header, ext)) {
        const keep: boolean = goControl;
        reset();
        goControl = keep;
      } else addCode(" ");
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = (end === -1 ? text.length : end) - 1;
      continue;
    }
    if (ext === "php" && ch === "<" && text.startsWith("<?php", i)) {
      i += 4; // the open tag is not code
      continue;
    }
    if (ch === "#" && ext === "php") {
      const end = text.indexOf("\n", i);
      i = (end === -1 ? text.length : end) - 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = skipTo(end === -1 ? -1 : end + 2, i) - 1;
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "'") {
      let end = -1;
      const raw = ext === "rs" && ch === '"' ? /(?<![\w])r(#*)$/.exec(header) : null;
      if (raw) {
        end = text.indexOf(`"${raw[1]}`, i + 1);
        end = end === -1 ? -1 : end + 1 + raw[1]!.length;
      } else if (ch === '"' && text.startsWith('"""', i)) {
        const close = text.indexOf('"""', i + 3);
        end = close === -1 ? -1 : close + 3;
      } else if (ch === "`") {
        end = endOfBacktick(text, i, ext === "go");
      } else if (ch === "'" && ext === "rs") {
        // A char literal is one character or an escape; anything else is a lifetime.
        const m = /^'(?:\\[^']*|[^'\\])'/.exec(text.slice(i, i + 12));
        end = m ? i + m[0].length : i + 1;
      } else {
        const m = (ch === '"' ? /^"(?:[^"\\\n]|\\.)*"/ : /^'(?:[^'\\\n]|\\.)*'/).exec(text.slice(i));
        end = m ? i + m[0].length : i + 1;
      }
      i = skipTo(end, i) - 1;
      addCode('""');
      lastSignificant = '"';
      continue;
    }
    if (ch === "/" && JS_FAMILY.has(ext) && (lastSignificant === "" || "(,=:[!&|?{};".includes(lastSignificant))) {
      const m = /^\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[a-z]*/.exec(text.slice(i));
      if (m) {
        i += m[0].length - 1;
        addCode('""');
        lastSignificant = '"';
        continue;
      }
    }

    if (ch === "{") {
      const control = goControl;
      stack.push({ line: headerLine || line, isBlock: isBlockHeader(header, control, ext), parens });
      parens = 0;
      reset();
    } else if (ch === "}") {
      const open = stack.pop();
      if (!open) return null;
      if (open.isBlock) blocks.push({ start: open.line, end: line });
      parens = open.parens;
      reset();
    } else if (ch === ";" && parens === 0) {
      // Go's `if x := f(); cond {` keeps its control keyword across the semicolon.
      const keep = ext === "go" && CONTROL.test(header.trim());
      reset();
      goControl = keep;
    } else {
      if (ch === "(") parens++;
      else if (ch === ")") parens = Math.max(0, parens - 1);
      addCode(ch);
    }
    if (!/\s/.test(ch)) lastSignificant = ch;
  }
  return stack.length ? null : blocks;
}

/** End index (exclusive) of a backtick string starting at `start`, honouring `${ }` in JS-like templates. */
function endOfBacktick(text: string, start: number, raw: boolean): number {
  let depth = 0;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (raw) {
      if (ch === "`") return i + 1;
    } else if (ch === "\\") i++;
    else if (depth === 0 && ch === "`") return i + 1;
    else if (ch === "$" && text[i + 1] === "{") {
      depth++;
      i++;
    } else if (depth > 0 && ch === "}") depth--;
  }
  return -1;
}

/** Finds the Enclosing block for brace-delimited languages; any other extension finds nothing. */
export const braceBlockFinder: BlockFinder = {
  name: "braces",
  find({ path, lines }, range) {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (!BRACE_EXTENSIONS.has(ext) || !path.includes(".")) return null;
    const blocks = findBlocks(lines, ext);
    let best: LineSpan | null = null;
    for (const b of blocks ?? []) {
      if (b.start > range.start || b.end < range.end) continue;
      if (!best || b.end - b.start < best.end - best.start) best = b;
    }
    return best;
  },
};
