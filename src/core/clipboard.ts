import { spawn } from "node:child_process";
import { ContextTooLongError, UnexpectedError, UsageError } from "./errors.js";

/** The program that prints the clipboard as text, with the fixed arguments it is always started with. */
export interface ClipboardCommand {
  tool: string;
  args: string[];
  /** How to get the tool, for the message when it is missing. */
  install: string;
}

/**
 * Which program reads the clipboard on this platform. Chosen from the platform and the session type
 * alone, never from user input, and the arguments are constants: nothing the user or the clipboard
 * holds ever becomes part of a command.
 */
export function clipboardCommand(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ClipboardCommand {
  if (platform === "darwin") return { tool: "pbpaste", args: [], install: "pbpaste ships with macOS; check that it is on your PATH" };
  if (platform === "linux") {
    return env.WAYLAND_DISPLAY
      ? { tool: "wl-paste", args: ["--no-newline", "--type", "text"], install: "install wl-clipboard (for example `sudo apt install wl-clipboard`)" }
      : { tool: "xclip", args: ["-selection", "clipboard", "-out"], install: "install xclip (for example `sudo apt install xclip`)" };
  }
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
  const { tool, args, install } = clipboardCommand(options.platform ?? process.platform, env);
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn(tool, args, { env, stdio: ["ignore", "pipe", "ignore"], timeout: TIMEOUT_MS });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxBytes) {
        failure ??= new ContextTooLongError(`the clipboard is over ${options.maxBytes.toLocaleString("en-US")} bytes; copy a smaller piece`);
        child.kill();
      } else chunks.push(chunk);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "ENOENT"
          ? new UsageError(`${tool} was not found, and --clip needs it: ${install}, or pipe the text in instead (for example \`cat file | learn\`)`)
          : new UnexpectedError(`could not read the clipboard: ${tool} could not be started (${err.code ?? "unknown error"})`),
      );
    });
    child.on("close", (code, signal) => {
      if (failure) reject(failure);
      else if (code !== 0) reject(new UnexpectedError(`could not read the clipboard: ${tool} ${signal ? `was stopped by ${signal}` : `exited with status ${code}`}`));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
  if (text.trim() === "") throw new UsageError("the clipboard is empty; copy some code first");
  return text;
}
