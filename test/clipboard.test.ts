import { describe, expect, it } from "vitest";
import { clipboardCommands, readClipboard } from "../src/core/clipboard.js";
import { UnexpectedError, UsageError } from "../src/core/errors.js";
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

// The wording below is what each tool prints, taken from its source (wl-clipboard's wl-paste.c and
// misc.c; xclip's xcprint.c, plus the "target STRING not available" of older releases such as 0.13).
describe("readClipboard when a Linux tool fails", () => {
  const read = async (tool: "xclip" | "wl-paste", stderr: string, failWith = 1) => {
    const clip = await fakeClipboard("", { tools: [tool], failWith, stderr });
    const env = tool === "wl-paste" ? { PATH: clip.env.PATH, WAYLAND_DISPLAY: "wayland-0" } : { PATH: clip.env.PATH };
    const err = await readClipboard({ platform: "linux", env, maxBytes: 1000 }).catch((e) => e);
    return { err, calls: await clip.calls() };
  };

  it.each([
    ["xclip", "xclip: Error: Wayfire cannot convert clipboard selection to target 'UTF8_STRING'\n"],
    ["xclip", "xclip: Error: There is no owner for the clipboard selection\n"],
    ["xclip", "Error: target STRING not available\n"],
    ["wl-paste", 'Clipboard content is not available as requested type "text"\nUse "wl-paste --list-types" to view available types.\n'],
    ["wl-paste", "Nothing is copied\n"],
  ] as const)("%s saying %j means the clipboard has no text", async (tool, stderr) => {
    const { err } = await read(tool, stderr);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("the clipboard has no text");
  });

  it.each([
    ["xclip", "xclip: Error: Can't open display: (null)\n"],
    ["wl-paste", "Failed to connect to a Wayland server: No such file or directory\n"],
  ] as const)("%s saying %j names the cause, and the other tool is not tried", async (tool, stderr) => {
    const { err, calls } = await read(tool, stderr);
    expect(err.message).toContain("no display available; are you on a graphical session?");
    expect(err.message).toContain(tool);
    expect(calls).toHaveLength(1);
  });

  it("reports any other failure with the tool's name and exit status", async () => {
    const { err } = await read("xclip", "something unexpected\n", 3);
    expect(err).toBeInstanceOf(UnexpectedError);
    expect(err.message).toBe("could not read the clipboard: xclip exited with status 3");
  });

  it("does not repeat the tool's own output in the message", async () => {
    const { err } = await read("xclip", "SECRET-LOOKING-OUTPUT\n", 2);
    expect(err.message).not.toContain("SECRET-LOOKING-OUTPUT");
  });
});
