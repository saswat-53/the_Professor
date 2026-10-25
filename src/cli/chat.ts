import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { CancelledError, followUp } from "../core/index.js";
import type { LanguageModel, LearnError, Session } from "../core/index.js";

/** A line that opens a pasted block, and the line that closes it. Code can contain `"""` or a trailing backslash, so neither is used. */
export const BLOCK_OPEN = "<<<";
export const BLOCK_CLOSE = ">>>";

export const CHAT_HELP = `Type a question and press Enter. To paste code or several lines, type ${BLOCK_OPEN} on a line of its own, paste, then type ${BLOCK_CLOSE} on a line of its own. /exit (or /quit), Ctrl-D or Ctrl-C at the prompt ends the chat; Ctrl-C while an answer is streaming cancels just that answer.`;

export interface ChatOptions {
  input: Readable;
  output: Writable;
  session: Session;
  model: LanguageModel;
  /** Cleans the model's text for the terminal; called once per answer, so its state never spans answers. */
  stripper: () => (text: string) => string;
  /** Shows an error or note on the status stream. */
  report: (kind: "error" | "info", text: string) => void;
  describe: (err: LearnError) => string;
  /** Hands over the process's signal handling for as long as the chat runs. The handler gets the exit code the signal stands for (130 or 143). */
  takeSignals: (handler: (code: number) => void) => void;
}

/**
 * The interactive loop: read a question, stream the answer, repeat. Resolves to the exit code.
 * Only readline lives here; the Session and the model call are core's.
 */
export async function runChat(opts: ChatOptions): Promise<number> {
  const rl = createInterface({ input: opts.input, output: opts.output, terminal: true, prompt: "learn> " });
  // Lines are queued as they arrive, so none is lost between one answer finishing and the next prompt.
  const lines: string[] = [];
  let closed = false;
  let waiting: (() => void) | undefined;
  const wake = () => waiting?.();
  rl.on("line", (line) => {
    lines.push(line);
    wake();
  });
  rl.on("close", () => {
    closed = true;
    wake();
  });
  const next = async (): Promise<string | undefined> => {
    while (lines.length === 0 && !closed) await new Promise<void>((resolve) => (waiting = resolve));
    return lines.shift();
  };

  let current: AbortController | undefined;
  let endedBy: number | undefined;
  // Ctrl-C at the keyboard reaches readline (raw mode), a SIGINT sent from outside reaches the process; both mean the same thing.
  const interrupt = (code: number) => {
    if (code === 143) endedBy = 143;
    if (current) current.abort();
    if (!current || code === 143) rl.close();
  };
  rl.on("SIGINT", () => interrupt(130));
  opts.takeSignals(interrupt);

  opts.output.write(`${CHAT_HELP}\n`);
  let lastChar = "\n";
  while (!closed) {
    rl.setPrompt("learn> ");
    rl.prompt();
    const first = await next();
    if (first === undefined) break;
    let question = first.trim();
    if (question === BLOCK_OPEN) {
      const block: string[] = [];
      rl.setPrompt("... ");
      for (;;) {
        rl.prompt();
        const line = await next();
        if (line === undefined) return endedBy ?? 0; // closed inside a block: the half-pasted text is dropped
        if (line.trim() === BLOCK_CLOSE) break;
        block.push(line);
      }
      question = block.join("\n").trim();
    }
    if (question === "") continue;
    if (/^\/[a-z]+$/.test(question)) {
      if (question === "/exit" || question === "/quit") break;
      opts.report("info", `${question} is not a command yet (commands: /exit)`);
      continue;
    }
    current = new AbortController();
    const strip = opts.stripper();
    for await (const event of followUp({ session: opts.session, question, model: opts.model, signal: current.signal })) {
      if (event.type === "text-delta") {
        const text = strip(event.text);
        opts.output.write(text);
        lastChar = text.at(-1) ?? lastChar;
      } else if (event.type === "error") {
        if (lastChar !== "\n") opts.output.write("\n");
        lastChar = "\n";
        if (event.error instanceof CancelledError) opts.report("info", "cancelled");
        else opts.report("error", opts.describe(event.error));
      } else if (event.type === "done") {
        opts.output.write("\n");
        lastChar = "\n";
      }
    }
    current = undefined;
    if (endedBy !== undefined) break;
  }
  rl.close();
  return endedBy ?? 0;
}
