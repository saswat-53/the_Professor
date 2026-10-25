import { describe, expect, it } from "vitest";
import { clipboardCommands, readClipboard } from "../src/core/clipboard.js";
import { fakeClipboard } from "./support/fake-clipboard.js";

const tools = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv) => clipboardCommands(platform, env).map((c) => c.tool);

describe("clipboardCommands", () => {
  it("uses pbpaste on macOS", () => expect(clipboardCommands("darwin", {})).toMatchObject([{ tool: "pbpaste", args: [] }]));
  it("prefers wl-paste on Linux under Wayland, then xclip (which works through XWayland)", () => {
    expect(tools("linux", { WAYLAND_DISPLAY: "wayland-0" })).toEqual(["wl-paste", "xclip"]);
    expect(clipboardCommands("linux", { WAYLAND_DISPLAY: "w" })[0]).toMatchObject({ args: ["--no-newline", "--type", "text"] });
  });
  it("prefers xclip on Linux otherwise, then wl-paste", () => {
    expect(tools("linux", {})).toEqual(["xclip", "wl-paste"]);
    expect(clipboardCommands("linux", {})[0]).toMatchObject({ args: ["-selection", "clipboard", "-out"] });
  });
  it("treats an empty WAYLAND_DISPLAY as unset", () => expect(tools("linux", { WAYLAND_DISPLAY: "" })[0]).toBe("xclip"));
  it("is a usage error on a platform with no supported tool", () => expect(() => clipboardCommands("win32", {})).toThrow(/--clip is not supported on win32.*pipe/s));
});

describe("readClipboard on Linux", () => {
  const wayland = (path: string) => ({ PATH: path, WAYLAND_DISPLAY: "wayland-0" });
  it("falls back to xclip when wl-paste is not installed", async () => {
    const clip = await fakeClipboard("hello\n", { tools: ["xclip"] });
    const text = await readClipboard({ platform: "linux", env: wayland(clip.env.PATH), maxBytes: 1000 });
    expect(text).toBe("hello\n");
    expect(await clip.calls()).toEqual(["xclip [-selection] [clipboard] [-out]"]);
  });
  it("names both tools and how to install them when neither is installed", async () => {
    const clip = await fakeClipboard("x", { tools: [] });
    const err = await readClipboard({ platform: "linux", env: wayland(clip.env.PATH), maxBytes: 1000 }).catch((e) => e);
    expect(err.message).toMatch(/wl-paste.*xclip|xclip.*wl-paste/s);
    expect(err.message).toContain("wl-clipboard");
    expect(err.message).toContain("cat file | learn");
  });
  it("does not fall back when the first tool exists but fails", async () => {
    const clip = await fakeClipboard("x", { tools: ["wl-paste", "xclip"], failWith: 1 });
    await expect(readClipboard({ platform: "linux", env: wayland(clip.env.PATH), maxBytes: 1000 })).rejects.toThrow(/could not read the clipboard/);
    expect(await clip.calls()).toHaveLength(1);
  });
});
