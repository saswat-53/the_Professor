import type { SessionStats } from "../core/index.js";
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

/** How many columns `text` takes. */
const widthOf = (text: string): number => text.length;

const join = (fields: (string | undefined)[]): string => fields.filter((field) => field !== undefined && field !== "").join(SEPARATOR);

/** `text` cut from the right to fit `budget` columns, ending in an ellipsis. */
const cutRight = (text: string, budget: number): string => (widthOf(text) <= budget ? text : budget < 1 ? "" : `${text.slice(0, budget - 1)}${ELLIPSIS}`);

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
  return `${ELLIPSIS}${reference.slice(-(budget - 1))}`;
}

/**
 * The one line printed above each chat prompt: `project · file:range · model · level · tokens`, plus the last request's
 * context fill on a local endpoint. When the line does not fit, fields go in a fixed order: the project, then the level,
 * then the file path (shortened from the left first), then the tokens; the model and the fill stay, and a model name that
 * still does not fit is cut from the right. Below `NARROW` columns only the model and the fill are shown.
 * Pure: it is given the data and the width and returns text, so it is tested without a terminal.
 */
export function renderFooter({ stats, project, width }: FooterInput): string {
  if (width < 1) return "";
  const mark = (estimated: boolean) => (estimated ? "~" : "");
  const count = (n: number, estimated: boolean) => `${mark(estimated)}${shortCount(n)}`;
  const total = stats.total;
  const used = `${count(total.inputTokens, total.source === "estimated")} in/${count(total.outputTokens, total.source === "estimated")} out`;
  // Fill needs a real window (a local endpoint) and a last request to measure; a hosted endpoint shows none, since there is no known window.
  const fill =
    stats.contextWindow !== undefined && stats.last
      ? `last ${count(stats.last.inputTokens, stats.last.source === "estimated")}/${shortCount(stats.contextWindow)} (${Math.round((stats.last.inputTokens / stats.contextWindow) * 100)}%)`
      : undefined;
  const { reference, model = "", level } = stats;

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
