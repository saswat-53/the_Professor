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

