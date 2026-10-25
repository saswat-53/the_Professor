import { spawn } from "node:child_process";
import { ContextTooLongError, UnexpectedError, UsageError } from "./errors.js";

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
    const text = await runTool(command, env, options.maxBytes);
    if (text === undefined) continue; // not installed: try the next one
    if (text.trim() === "") throw new UsageError("the clipboard has no text; copy some code first (an image or a file is not text)");
    return text;
  }
  const names = commands.map((c) => c.tool);
  throw new UsageError(
    `${names.length === 1 ? `${names[0]} was not found` : `neither ${names.join(" nor ")} was found`}, and --clip needs ${names.length === 1 ? "it" : "one of them"}: ${commands.map((c) => c.install).join("; or ")}. Or pipe the text in instead (for example \`cat file | learn\`)`,
  );
}

/** What one tool prints, or undefined if it is not installed. Any other failure is thrown. */
function runTool({ tool, args }: ClipboardCommand, env: NodeJS.ProcessEnv, maxBytes: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { env, stdio: ["ignore", "pipe", "ignore"], timeout: TIMEOUT_MS });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        failure ??= new ContextTooLongError(`the clipboard is over ${maxBytes.toLocaleString("en-US")} bytes; copy a smaller piece`);
        child.kill();
      } else chunks.push(chunk);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") resolve(undefined);
      else reject(new UnexpectedError(`could not read the clipboard: ${tool} could not be started (${err.code ?? "unknown error"})`));
    });
    child.on("close", (code, signal) => {
      if (failure) reject(failure);
      else if (code !== 0) reject(new UnexpectedError(`could not read the clipboard: ${tool} ${signal ? `was stopped by ${signal}` : `exited with status ${code}`}`));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
