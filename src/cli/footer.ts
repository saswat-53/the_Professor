import type { SessionStats } from "../core/index.js";
import { shortCount } from "./usage-line.js";

export interface FooterInput {
  stats: SessionStats;
  /** The project's name (its root directory's name); the frontend knows it, a Session does not. */
  project: string;
  /** Columns available, read from the terminal before each render. */
  width: number;
}

/**
 * The one line printed above each chat prompt: `project · file:range · model · level · tokens`.
 * Pure: it is given the data and the width and returns text, so it is tested without a terminal.
 */
export function renderFooter({ stats, project }: FooterInput): string {
  const tokens = (n: number, estimated: boolean) => `${estimated ? "~" : ""}${shortCount(n)}`;
  const total = stats.total;
  const estimated = total.source === "estimated";
  const used = `${tokens(total.inputTokens, estimated)} in/${tokens(total.outputTokens, estimated)} out`;
  // Fill needs a real window (a local endpoint) and a last request to measure; a hosted endpoint shows none, since there is no known window.
  const fill =
    stats.contextWindow !== undefined && stats.last
      ? `last ${tokens(stats.last.inputTokens, stats.last.source === "estimated")}/${shortCount(stats.contextWindow)} (${Math.round((stats.last.inputTokens / stats.contextWindow) * 100)}%)`
      : undefined;
  return [project, stats.reference, stats.model, stats.level, used, fill].filter((field) => field !== undefined).join(" · ");
}
