import { describe, expect, it } from "vitest";
import { LEVELS, buildSystemPrompt, fenceCode } from "../src/core/prompt.js";

describe("teaching prompt snapshot", () => {
  it.each(LEVELS)("%s", (level) => expect(buildSystemPrompt(level)).toMatchSnapshot());
});

describe("fenceCode", () => {
  it("uses three backticks for plain code and adds a trailing newline if missing", () => {
    expect(fenceCode("x")).toBe("```\nx\n```");
  });
  it("uses a fence longer than any backtick run in the code", () => {
    expect(fenceCode("a ````` b\n")).toBe("``````\na ````` b\n``````");
  });
});
