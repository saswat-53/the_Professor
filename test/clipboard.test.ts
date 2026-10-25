import { describe, expect, it } from "vitest";
import { clipboardCommand } from "../src/core/clipboard.js";

describe("clipboardCommand", () => {
  it("uses pbpaste on macOS", () => expect(clipboardCommand("darwin", {})).toMatchObject({ tool: "pbpaste", args: [] }));
  it("uses wl-paste on Linux under Wayland, asking for the text type and no added newline", () =>
    expect(clipboardCommand("linux", { WAYLAND_DISPLAY: "wayland-0" })).toMatchObject({ tool: "wl-paste", args: ["--no-newline", "--type", "text"] }));
  it("uses xclip on Linux otherwise", () =>
    expect(clipboardCommand("linux", {})).toMatchObject({ tool: "xclip", args: ["-selection", "clipboard", "-out"] }));
  it("treats an empty WAYLAND_DISPLAY as unset", () => expect(clipboardCommand("linux", { WAYLAND_DISPLAY: "" })).toMatchObject({ tool: "xclip" }));
  it("names how to install the tool, and piped input as the alternative", () => {
    expect(clipboardCommand("linux", {}).install).toContain("xclip");
    expect(clipboardCommand("linux", { WAYLAND_DISPLAY: "w" }).install).toContain("wl-clipboard");
  });
  it("is a usage error on a platform with no supported tool", () => expect(() => clipboardCommand("win32", {})).toThrow(/--clip is not supported on win32.*pipe/s));
});
