import { describe, expect, it } from "vitest";
import type { SessionStats } from "../src/core/index.js";
import { renderFooter } from "../src/cli/footer.js";

/** A hosted endpoint after a first explanation and one follow-up: every field known, the endpoint reporting usage. */
const hosted: SessionStats = {
  model: "gpt-x",
  level: "beginner",
  reference: "src/auth.ts:40-60",
  last: { inputTokens: 1800, outputTokens: 120, source: "reported" },
  total: { inputTokens: 3100, outputTokens: 420, source: "reported" },
};

describe("renderFooter", () => {
  it("shows project, reference, model, level and session tokens on one line when there is room", () => {
    expect(renderFooter({ stats: hosted, project: "Professor", width: 120 })).toBe("Professor · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
  });

  it("adds the last request's context fill, labelled as such, on a local endpoint", () => {
    const local: SessionStats = { ...hosted, contextWindow: 4096 };
    expect(renderFooter({ stats: local, project: "Professor", width: 120 })).toBe("Professor · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out · last 1.8k/4.1k (44%)");
  });

  it("marks estimated figures with ~, in the tokens and in the fill", () => {
    const estimated: SessionStats = {
      ...hosted,
      contextWindow: 4096,
      last: { inputTokens: 1800, outputTokens: 120, source: "estimated" },
      total: { inputTokens: 3100, outputTokens: 420, source: "estimated" },
    };
    expect(renderFooter({ stats: estimated, project: "Professor", width: 120 })).toBe("Professor · src/auth.ts:40-60 · gpt-x · beginner · ~3.1k in/~420 out · last ~1.8k/4.1k (44%)");
  });

  it("shows no fill when there is no window to measure against, even if a last turn exists", () => {
    expect(renderFooter({ stats: hosted, project: "Professor", width: 120 })).not.toContain("last");
  });
});

describe("renderFooter on a narrow terminal", () => {
  const at = (stats: SessionStats, width: number) => renderFooter({ stats, project: "Professor", width });
  const local: SessionStats = { ...hosted, contextWindow: 4096 };

  it("drops the project first, then the level, as the line stops fitting (widths are exact: 66, 54 and 43 columns)", () => {
    expect(at(hosted, 66)).toBe("Professor · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
    expect(at(hosted, 65)).toBe("src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
    expect(at(hosted, 54)).toBe("src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
    expect(at(hosted, 53)).toBe("src/auth.ts:40-60 · gpt-x · 3.1k in/420 out");
    expect(at(hosted, 43)).toBe("src/auth.ts:40-60 · gpt-x · 3.1k in/420 out");
  });

  it("then shortens the file path from the left, keeping the end of it, before dropping it", () => {
    expect(at(hosted, 42)).toBe("…/auth.ts:40-60 · gpt-x · 3.1k in/420 out");
    expect(at(hosted, 40)).toBe("…auth.ts:40-60 · gpt-x · 3.1k in/420 out");
  });

  it("drops the file path rather than leave a stub of it: under 12 columns says too little", () => {
    // 40 columns, a 13-character model: the path would get 6 columns, so it goes and the tokens stay.
    expect(at({ ...hosted, model: "claude-sonnet" }, 40)).toBe("claude-sonnet · 3.1k in/420 out");
  });

  it("below about 40 columns keeps only the model, and the fill where there is one", () => {
    expect(at(hosted, 39)).toBe("gpt-x");
    expect(at(local, 39)).toBe("gpt-x · last 1.8k/4.1k (44%)");
  });

  it("drops the tokens before the fill when the file path is already gone", () => {
    expect(at(local, 45)).toBe("gpt-x · last 1.8k/4.1k (44%)");
  });

  it("cuts a model name that still does not fit from the right, with an ellipsis", () => {
    const long: SessionStats = { ...local, model: "claude-sonnet-5-5-20260101" };
    expect(at(long, 45)).toBe("claude-sonnet-5-5-202… · last 1.8k/4.1k (44%)");
    expect(at({ ...hosted, model: "claude-sonnet" }, 10)).toBe("claude-so…");
  });

  it("is never wider than the terminal, and always one line, at every width", () => {
    for (const stats of [hosted, local, { ...local, model: "claude-sonnet-5-5-20260101" }]) {
      for (let width = 1; width <= 120; width++) {
        const line = at(stats, width);
        expect(line.length, `width ${width}`).toBeLessThanOrEqual(width);
        expect(line, `width ${width}`).not.toContain("\n");
      }
    }
  });
});
