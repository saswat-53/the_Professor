import type { SessionStats } from "../core/index.js";
import { createEscapeStripper } from "./escape-stripper.js";
import { shortCount } from "./usage-line.js";

export interface FooterInput {
  stats: SessionStats;
  /** The project's name (its root directory's name); the frontend knows it, a Session does not. */
  project: string;
  /** Columns available, read from the terminal before each render. */
  width: number;
}

const SEPARATOR = " · ";
/** Below this many columns only the model (and the fill) is shown. */
const NARROW = 40;
/** A file path shortened to fewer columns than this says too little to be worth showing; it is dropped instead. */
const MIN_REFERENCE = 12;
const ELLIPSIS = "…";
/** Shown where a name is empty once cleaned, so a field is never blank. */
const PLACEHOLDER = "(unnamed)";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** The characters as a person sees them: a letter with its accents, or an emoji sequence, is one. */
const graphemes = (text: string): string[] => Array.from(segmenter.segment(text), (part) => part.segment);

/** Code point ranges that a terminal draws two columns wide: Hangul Jamo, CJK, kana, Hangul, fullwidth forms. */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x3fffd],
];

/** Columns one character takes: 0 for a combining mark on its own, 2 for a wide character or an emoji, else 1. */
function columnsOf(grapheme: string): number {
  const first = grapheme.codePointAt(0)!;
  if (/^\p{M}+$/u.test(grapheme)) return 0;
  if (/\p{Emoji_Presentation}/u.test(String.fromCodePoint(first)) || WIDE.some(([low, high]) => first >= low && first <= high)) return 2;
  return 1;
}

/** How many columns `text` takes on a terminal, which is not how many characters or UTF-16 units it has. */
const widthOf = (text: string): number => graphemes(text).reduce((sum, g) => sum + columnsOf(g), 0);

/**
 * `text` with escape sequences, control characters and text-hiding characters removed (the same stripper the model's
 * text goes through), and every run of whitespace, newlines included, made one space, so it is one visible line.
 */
const clean = (text: string): string => createEscapeStripper()(text).replace(/\s+/g, " ").trim();
const named = (text: string): string => clean(text) || PLACEHOLDER;

const join = (fields: (string | undefined)[]): string => fields.filter((field) => field !== undefined && field !== "").join(SEPARATOR);

/** The first characters of `text` that fit in `budget` columns, never splitting one. */
function head(text: string, budget: number): string {
  let used = 0;
  let out = "";
  for (const g of graphemes(text)) {
    used += columnsOf(g);
    if (used > budget) break;
    out += g;
  }
  return out;
}

/** The last characters of `text` that fit in `budget` columns, never splitting one. */
function tail(text: string, budget: number): string {
  let used = 0;
  let out = "";
  for (const g of graphemes(text).reverse()) {
    used += columnsOf(g);
    if (used > budget) break;
    out = g + out;
  }
  return out;
}

/** `text` cut from the right to fit `budget` columns, ending in an ellipsis. */
const cutRight = (text: string, budget: number): string => (widthOf(text) <= budget ? text : budget < 1 ? "" : `${head(text, budget - 1)}${ELLIPSIS}`);

/**
 * A file path and range shortened from the left to fit `budget` columns, keeping the end (the file name and the lines):
 * whole leading directories first (`…/auth.ts:40-60`), then single characters. Undefined when too little would be left to be worth showing.
 */
function fitReference(reference: string, budget: number): string | undefined {
  if (widthOf(reference) <= budget) return reference;
  if (budget < MIN_REFERENCE) return undefined;
  const parts = reference.split("/");
  for (let i = 1; i < parts.length; i++) {
    const candidate = `${ELLIPSIS}/${parts.slice(i).join("/")}`;
    if (widthOf(candidate) <= budget) return candidate;
  }
  return `${ELLIPSIS}${tail(reference, budget - 1)}`;
}

/**
 * The one line printed above each chat prompt: `project · file:range · model · level · tokens`, plus the last request's
 * context fill on a local endpoint. When the line does not fit, fields go in a fixed order: the project, then the level,
 * then the file path (shortened from the left first), then the tokens; the model and the fill stay, and a model name that
 * still does not fit is cut from the right. Below `NARROW` columns only the model and the fill are shown.
 * Pure: it is given the data and the width and returns text, so it is tested without a terminal.
 */
export function renderFooter({ stats, project: rawProject, width }: FooterInput): string {
  if (width < 1) return "";
  // Names come from directories, files and settings, which anyone can make hostile: clean them here, so no caller has to remember to.
  const project = named(rawProject);
  const mark = (estimated: boolean) => (estimated ? "~" : "");
  const count = (n: number, estimated: boolean) => `${mark(estimated)}${shortCount(n)}`;
  const total = stats.total;
  const used = `${count(total.inputTokens, total.source === "estimated")} in/${count(total.outputTokens, total.source === "estimated")} out`;
  // Fill needs a real window (a local endpoint) and a last request to measure; a hosted endpoint shows none, since there is no known window.
  const fill =
    stats.contextWindow !== undefined && stats.last
      ? `last ${count(stats.last.inputTokens, stats.last.source === "estimated")}/${shortCount(stats.contextWindow)} (${Math.round((stats.last.inputTokens / stats.contextWindow) * 100)}%)`
      : undefined;
  const reference = stats.reference === undefined ? undefined : named(stats.reference);
  const model = stats.model === undefined ? "" : named(stats.model);
  const { level } = stats;

  const fits = (fields: (string | undefined)[]): string | undefined => {
    const line = join(fields);
    return widthOf(line) <= width ? line : undefined;
  };
  const shortened = (): string | undefined => {
    if (reference === undefined) return undefined;
    const fitted = fitReference(reference, width - widthOf(join([model, used, fill])) - widthOf(SEPARATOR));
    return fitted === undefined ? undefined : fits([fitted, model, used, fill]);
  };

  const wide =
    width < NARROW
      ? undefined
      : (fits([project, reference, model, level, used, fill]) ??
        fits([reference, model, level, used, fill]) ??
        fits([reference, model, used, fill]) ??
        shortened() ??
        fits([model, used, fill]));
  if (wide !== undefined) return wide;
  const minimal = fits([model, fill]);
  if (minimal !== undefined) return minimal;
  // Not even the model and the fill fit: cut the model to leave room for the fill, or drop the fill when there is no room for both.
  const room = width - (fill === undefined ? 0 : widthOf(SEPARATOR) + widthOf(fill));
  return room >= 4 && fill !== undefined ? join([cutRight(model, room), fill]) : cutRight(model, width);
}
