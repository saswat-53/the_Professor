import { describe, expect, it } from "vitest";
import { owlBanner } from "../src/cli/owl.js";

describe("owlBanner", () => {
  it("is plain text with no escape sequences when colour is off", () => {
    const banner = owlBanner({ color: false });
    expect(banner).not.toContain("\u001b");
    expect(banner).toContain("Professor");
    expect(banner.endsWith("\n")).toBe(true);
  });

  it("colours the owl and dims the words when colour is on", () => {
    const banner = owlBanner({ color: true });
    expect(banner).toContain("\u001b[33m");
    expect(banner).toContain("\u001b[2mProfessor\u001b[0m");
  });

  it("says the same thing with or without colour", () => {
    // eslint-disable-next-line no-control-regex
    const stripped = owlBanner({ color: true }).replace(/\u001b\[[0-9;]*m/g, "");
    expect(stripped).toBe(owlBanner({ color: false }));
  });
});
