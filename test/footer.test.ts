import { describe, expect, it } from "vitest";
import type { SessionStats } from "../src/core/index.js";
import { renderFooter, renderPromptHeader } from "../src/cli/footer.js";

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

describe("renderFooter with hostile or wide text", () => {
  const at = (stats: SessionStats, width: number, project = "Professor") => renderFooter({ stats, project, width });
  const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;

  it("removes terminal escape sequences from the project, the file and the model", () => {
    const line = renderFooter({
      stats: { ...hosted, reference: "src/\u001b]0;pwned\u0007auth.ts:40-60", model: "gpt-\u001b[31mx" },
      project: "Pro\u001b[2Jfessor",
      width: 120,
    });
    expect(line).toBe("Professor · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
  });

  it("keeps the footer on one line: newlines, tabs and carriage returns become single spaces or vanish", () => {
    const line = renderFooter({ stats: hosted, project: "my\nproject\tname\r", width: 120 });
    expect(line).toBe("my project name · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
    expect(line).not.toMatch(CONTROL);
  });

  it("removes characters that hide or reorder text: bidi overrides and zero-width characters", () => {
    expect(renderFooter({ stats: hosted, project: "Pro\u202efessor\u200b", width: 120 })).toBe("Professor · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
  });

  it("puts a placeholder where a name is empty once cleaned, so a field is never blank", () => {
    const line = renderFooter({ stats: { ...hosted, model: "\u001b[31m" }, project: "\u200b\u202e", width: 120 });
    expect(line).toBe("(unnamed) · src/auth.ts:40-60 · (unnamed) · beginner · 3.1k in/420 out");
  });

  it("leaves out a file that is absent, but not one that is present and empty", () => {
    expect(at({ ...hosted, reference: undefined }, 120)).toBe("Professor · gpt-x · beginner · 3.1k in/420 out");
    expect(at({ ...hosted, reference: "\u001b[0m" }, 120)).toBe("Professor · (unnamed) · gpt-x · beginner · 3.1k in/420 out");
  });

  it("measures wide characters by the columns they take, not by how many there are", () => {
    // プロジェクト is 6 characters and 12 columns, so the full line is 69 columns, not 63.
    expect(at(hosted, 69, "プロジェクト")).toBe("プロジェクト · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
    expect(at(hosted, 68, "プロジェクト")).toBe("src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
  });

  it("measures a letter with a combining accent as one column", () => {
    // "Café" written as e + U+0301 is 5 code units but 4 columns: the full line is 61 columns.
    expect(at(hosted, 61, "Cafe\u0301")).toBe("Cafe\u0301 · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
    expect(at(hosted, 60, "Cafe\u0301")).toBe("src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
  });

  it("cuts wide text on a character boundary, never inside one, and stays within the width", () => {
    // 9 characters, 18 columns: 4 of them (8 columns) and the ellipsis fit in 10.
    expect(at({ ...hosted, model: "モデルモデルモデル" }, 10)).toBe("モデルモ…");
    // Emoji are two UTF-16 units each: cutting at 5 columns must not leave half of one.
    expect(at({ ...hosted, model: "😀😀😀😀😀" }, 6)).toBe("😀😀…");
  });

  it("shortens a file path from the left on a character boundary too", () => {
    // At 40 columns the path gets 14: the ellipsis, then the end of it that fits in 13 (ー and ル take 2 each, ".ts:40-60" takes 9).
    const line = at({ ...hosted, reference: "src/認証モジュール.ts:40-60", model: "gpt-x" }, 40);
    expect(line).toBe("…ール.ts:40-60 · gpt-x · 3.1k in/420 out");
  });

  it("is never wider than the terminal at any width, whatever the text is made of", () => {
    // A deliberately different way to count columns, enough for the characters used here: combining accents 0, kana, kanji and emoji 2, the rest 1.
    const columns = (text: string) => [...text].reduce((sum, ch) => sum + (/[\u0300-\u036f]/.test(ch) ? 0 : /[\u3040-\u30ff\u4e00-\u9fff\u{1f600}-\u{1f64f}]/u.test(ch) ? 2 : 1), 0);
    const odd: SessionStats = { ...hosted, contextWindow: 4096, reference: "src/認証モジュール.ts:40-60", model: "モデル😀Cafe\u0301-5" };
    for (let width = 1; width <= 120; width++) {
      const line = renderFooter({ stats: odd, project: "プロジェクト\u001b[31m\n", width });
      expect(columns(line), `width ${width}: ${line}`).toBeLessThanOrEqual(width);
      expect(line).not.toMatch(CONTROL);
    }
  });
});

describe("renderFooter colour", () => {
  const DIM = "\u001b[2m";
  const YELLOW = "\u001b[33m";
  const RED = "\u001b[31m";
  const RESET = "\u001b[0m";
  const ANSI = /\u001b\[[0-9;]*m/g;
  const coloured = (stats: SessionStats, width = 120, project = "Professor") => renderFooter({ stats, project, width, color: true });
  /** A local endpoint with a 1000-token window, so the last request's input tokens are the percentage. */
  const filled = (lastInput: number): SessionStats => ({ ...hosted, contextWindow: 1000, last: { inputTokens: lastInput, outputTokens: 10, source: "reported" } });

  it("adds no escape sequence at all when colour is off, which is the default", () => {
    expect(renderFooter({ stats: filled(950), project: "Professor", width: 120 })).not.toContain("\u001b");
    expect(renderFooter({ stats: filled(950), project: "Professor", width: 120, color: false })).not.toContain("\u001b");
  });

  it("dims the whole line", () => {
    expect(coloured(hosted)).toBe(`${DIM}Professor · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out${RESET}`);
  });

  it("gives the fill its own colour on top: dim to 70%, yellow above 70%, red above 90%", () => {
    const before = `${DIM}Professor · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out · ${RESET}`;
    expect(coloured(filled(700))).toBe(`${before}${DIM}last 700/1k (70%)${RESET}`);
    expect(coloured(filled(710))).toBe(`${before}${YELLOW}last 710/1k (71%)${RESET}`);
    expect(coloured(filled(900))).toBe(`${before}${YELLOW}last 900/1k (90%)${RESET}`);
    expect(coloured(filled(910))).toBe(`${before}${RED}last 910/1k (91%)${RESET}`);
  });

  it("never changes which fields fit: stripped of colour it is the same line at every width", () => {
    for (const stats of [hosted, filled(950)]) {
      for (let width = 1; width <= 120; width++) {
        expect(coloured(stats, width).replace(ANSI, ""), `width ${width}`).toBe(renderFooter({ stats, project: "Professor", width }));
      }
    }
  });

  it("colours only the real fill: a model named like one is just text", () => {
    const line = coloured({ ...hosted, model: "last 950/1k (95%)" });
    expect(line).toBe(`${DIM}Professor · src/auth.ts:40-60 · last 950/1k (95%) · beginner · 3.1k in/420 out${RESET}`);
    // Narrow, the model is the last field on the line, where a fill would be: still just text, so dim.
    expect(coloured({ ...hosted, model: "last 950/1k (95%)" }, 39)).toBe(`${DIM}last 950/1k (95%)${RESET}`);
  });

  it("adds only its own escape sequences: a hostile name still cannot bring one in", () => {
    const line = coloured({ ...hosted, model: "gpt-\u001b[31mx\u001b]0;pwned\u0007" }, 120, "Pro\u001b[2Jfessor");
    expect(line.replace(ANSI, "")).not.toContain("\u001b");
    expect(line).not.toContain("pwned");
  });
});

describe("renderPromptHeader", () => {
  const DIM = "\u001b[2m";
  const RESET = "\u001b[0m";
  const input = { stats: hosted, project: "Professor", width: 66 };

  it("is just the footer line when colour is off: no rule, no escape sequence", () => {
    expect(renderPromptHeader({ ...input, color: false })).toBe("Professor · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
    expect(renderPromptHeader(input)).toBe("Professor · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out");
  });

  it("is a dim rule as wide as the terminal, then the coloured footer, when colour is on", () => {
    expect(renderPromptHeader({ ...input, width: 20, color: true })).toBe(`${DIM}${"─".repeat(20)}${RESET}\n${renderFooter({ ...input, width: 20, color: true })}`);
    expect(renderPromptHeader({ ...input, color: true }).split("\n")).toEqual([`${DIM}${"─".repeat(66)}${RESET}`, `${DIM}Professor · src/auth.ts:40-60 · gpt-x · beginner · 3.1k in/420 out${RESET}`]);
  });
});

