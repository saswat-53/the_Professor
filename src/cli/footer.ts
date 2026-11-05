import type { SessionStats } from "../core/index.js";
import { createEscapeStripper } from "./escape-stripper.js";
import { shortCount } from "./usage-line.js";

export interface FooterInput {
  stats: SessionStats;
  /** The project's name (its root directory's name); the frontend knows it, a Session does not. */
  project: string;
  /** Columns available, read from the terminal before each render. */
  width: number;
  /** Dim the line and colour the fill; the caller decides from `outputMode`, so colour is decided in one place. Default: off. */
  color?: boolean;
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

/** One piece of the footer. The fill carries its percentage so it can be coloured by it. */
interface Field {
  text: string;
  percent?: number;
}

const joinFields = (fields: Field[]): string => fields.map((field) => field.text).join(SEPARATOR);

/** ANSI SGR: dim for the line, yellow and red for a fill that is getting full. */
const sgr = (code: string, text: string): string => `\u001b[${code}m${text}\u001b[0m`;
const fillCode = (percent: number): string => (percent > 90 ? "31" : percent > 70 ? "33" : "2");

/** The chosen fields as text: plain, or dim with the fill in its own colour. */
function paintFooter(fields: Field[], color: boolean): string {
  if (!color) return joinFields(fields);
  const last = fields.at(-1);
  if (last?.percent === undefined) return sgr("2", joinFields(fields));
  const before = fields.slice(0, -1);
  return `${before.length > 0 ? sgr("2", `${joinFields(before)}${SEPARATOR}`) : ""}${sgr(fillCode(last.percent), last.text)}`;
}

/**
 * The one line printed above each chat prompt: `project · file:range · model · level · tokens`, plus the last request's
 * context fill on a local endpoint. When the line does not fit, fields go in a fixed order: the project, then the level,
 * then the file path (shortened from the left first), then the tokens; the model and the fill stay, and a model name that
 * still does not fit is cut from the right. Below `NARROW` columns only the model and the fill are shown.
 * Pure: it is given the data and the width and returns text, so it is tested without a terminal.
 */
export function renderFooter({ stats, project: rawProject, width, color = false }: FooterInput): string {
  if (width < 1) return "";
  // Names come from directories, files and settings, which anyone can make hostile: clean them here, so no caller has to remember to.
  const project = named(rawProject);
  const mark = (estimated: boolean) => (estimated ? "~" : "");
  const count = (n: number, estimated: boolean) => `${mark(estimated)}${shortCount(n)}`;
  const total = stats.total;
  const used = `${count(total.inputTokens, total.source === "estimated")} in/${count(total.outputTokens, total.source === "estimated")} out`;
  // Fill needs a real window (a local endpoint) and a last request to measure; a hosted endpoint shows none, since there is no known window.
  const fill: Field | undefined =
    stats.contextWindow !== undefined && stats.last
      ? (() => {
          const percent = Math.round((stats.last.inputTokens / stats.contextWindow) * 100);
          return { text: `last ${count(stats.last.inputTokens, stats.last.source === "estimated")}/${shortCount(stats.contextWindow)} (${percent}%)`, percent };
        })()
      : undefined;
  const reference = stats.reference === undefined ? undefined : named(stats.reference);
  const model = stats.model === undefined ? "" : named(stats.model);
  const { level } = stats;
  const text = (value: string | undefined): Field | undefined => (value === undefined ? undefined : { text: value });

  /** The fields that make a line, if that line fits. Fitting is by plain text; colour is added afterwards and never changes what fits. */
  const fits = (fields: (Field | undefined)[]): Field[] | undefined => {
    const chosen = fields.filter((field): field is Field => field !== undefined && field.text !== "");
    return widthOf(joinFields(chosen)) <= width ? chosen : undefined;
  };
  const shortened = (): Field[] | undefined => {
    if (reference === undefined) return undefined;
    const fitted = fitReference(reference, width - widthOf(joinFields([text(model), text(used), fill].filter((f): f is Field => f !== undefined))) - widthOf(SEPARATOR));
    return fitted === undefined ? undefined : fits([text(fitted), text(model), text(used), fill]);
  };

  const wide =
    width < NARROW
      ? undefined
      : (fits([text(project), text(reference), text(model), text(level), text(used), fill]) ??
        fits([text(reference), text(model), text(level), text(used), fill]) ??
        fits([text(reference), text(model), text(used), fill]) ??
        shortened() ??
        fits([text(model), text(used), fill]));
  const chosen =
    wide ??
    fits([text(model), fill]) ??
    // Not even the model and the fill fit: cut the model to leave room for the fill, or drop the fill when there is no room for both.
    (() => {
      const room = width - (fill === undefined ? 0 : widthOf(SEPARATOR) + widthOf(fill.text));
      return room >= 4 && fill !== undefined ? [{ text: cutRight(model, room) }, fill] : [{ text: cutRight(model, width) }];
    })();
  return paintFooter(chosen, color);
}
