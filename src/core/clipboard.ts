import { spawn } from "node:child_process";
import { ContextTooLongError, type LearnError, UnexpectedError, UsageError } from "./errors.js";

/** The program that prints the clipboard as text, with the fixed arguments it is always started with. */
export interface ClipboardCommand {
  tool: string;
  args: string[];
  /** How to get the tool, for the message when it is missing. */
  install: string;
}

const PBPASTE: ClipboardCommand = { tool: "pbpaste", args: [], install: "pbpaste ships with macOS; check that it is on your PATH" };
const WL_PASTE: ClipboardCommand = { tool: "wl-paste", args: ["--no-newline", "--type", "text"], install: "install wl-clipboard (for example `sudo apt install wl-clipboard`)" };
const XCLIP: ClipboardCommand = { tool: "xclip", args: ["-selection", "clipboard", "-out"], install: "install xclip (for example `sudo apt install xclip`)" };

/**
 * The programs that can read the clipboard on this platform, best first. Chosen from the platform and
 * the session type alone, never from user input, and the arguments are constants: nothing the user
 * or the clipboard holds ever becomes part of a command. On Linux both tools are listed, because a
 * Wayland session may have only xclip (it works through XWayland) and the reverse can happen too.
 */
export function clipboardCommands(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ClipboardCommand[] {
  if (platform === "darwin") return [PBPASTE];
  if (platform === "linux") return env.WAYLAND_DISPLAY ? [WL_PASTE, XCLIP] : [XCLIP, WL_PASTE];
  throw new UsageError(`--clip is not supported on ${platform}; pipe the text in instead (for example \`cat file | learn\`)`);
}

/** Longest the clipboard tool may run before it is killed, so a hung tool cannot hang the run. */
const TIMEOUT_MS = 5_000;

export interface ReadClipboardOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Most bytes accepted; more is a ContextTooLongError, never silent truncation. */
  maxBytes: number;
}

/**
 * The clipboard as text. Starts the platform's tool directly (no shell) with its fixed arguments and
 * no standard input, and reads at most `maxBytes` of what it prints.
 */
export async function readClipboard(options: ReadClipboardOptions): Promise<string> {
  const env = options.env ?? process.env;
  const commands = clipboardCommands(options.platform ?? process.platform, env);
  for (const command of commands) {
    const result = await runTool(command, env, options.maxBytes);
    switch (result.kind) {
      case "not-installed":
        continue; // try the next tool
      case "failed":
        // Not "not installed", so the next tool would meet the same fault (no display) or the same content (no text): stop here.
        throw failureError(command.tool, result);
      case "ok":
        if (result.text.trim() === "") throw noText();
        return result.text;
    }
  }
  const names = commands.map((c) => c.tool);
  const missing = names.length === 1 ? `${names[0]} was not found` : `neither ${names.join(" nor ")} was found`;
  throw new UsageError(
    `${missing}, and --clip needs ${names.length === 1 ? "it" : "one of them"}: ${commands.map((c) => c.install).join("; or ")}. Or pipe the text in instead (for example \`cat file | learn\`)`,
  );
}

const noText = () => new UsageError("the clipboard has no text; copy some code first");

/** How one tool ended. A tool that cannot be started at all, or that prints too much or too slowly, is thrown instead. */
type ToolResult = { kind: "not-installed" } | { kind: "failed"; status: string; stderr: string } | { kind: "ok"; text: string };

/** What the tools say on standard error, matched loosely because wording differs between releases (xclip 0.13 and current, wl-paste). */
const NO_DISPLAY = /can't open display|failed to connect to a wayland server/i;
const NO_TEXT = /not available|cannot convert|no owner for|nothing is copied/i;

/** The error for a tool that ran and failed: its own message decides between "no display", "no text" and the general case, which names the tool and status and never repeats the output. */
function failureError(tool: string, { status, stderr }: { status: string; stderr: string }): LearnError {
  if (NO_DISPLAY.test(stderr)) return new UnexpectedError(`could not read the clipboard: ${tool} found no display available; are you on a graphical session?`);
  if (NO_TEXT.test(stderr)) return noText();
  return new UnexpectedError(`could not read the clipboard: ${tool} ${status}`);
}

/** Only this much of a tool's standard error is looked at: enough for its message, and a chatty tool cannot fill memory. */
const STDERR_MAX_BYTES = 4096;

function runTool({ tool, args }: ClipboardCommand, env: NodeJS.ProcessEnv, maxBytes: number): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    // Our own timer rather than spawn's `timeout` option: when the tool is not installed, some Node versions never
    // clear that option's timer, which would keep the process alive for its full length after the error was reported.
    const timer = setTimeout(() => {
      failure ??= new UnexpectedError(`could not read the clipboard: ${tool} did not answer within ${TIMEOUT_MS / 1000} seconds`);
      child.kill();
    }, TIMEOUT_MS);
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let failure: Error | undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        failure ??= new ContextTooLongError(`the clipboard is over ${maxBytes.toLocaleString("en-US")} bytes; copy a smaller piece`);
        child.kill();
      } else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_MAX_BYTES) stderr += chunk.toString("utf8");
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") resolve({ kind: "not-installed" });
      else reject(new UnexpectedError(`could not read the clipboard: ${tool} could not be started (${err.code ?? "unknown error"})`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) resolve({ kind: "failed", status: signal ? `was stopped by ${signal}` : `exited with status ${code}`, stderr });
      else resolve({ kind: "ok", text: Buffer.concat(chunks).toString("utf8") });
    });
  });
}
