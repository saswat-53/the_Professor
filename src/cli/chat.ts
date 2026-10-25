import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { CancelledError, followUp, formatContextReport, hasOverride, reportForError } from "../core/index.js";
import type { Attached, LanguageModel, LearnError, ModelRequest, Session } from "../core/index.js";

/** A line that opens a pasted block, and the line that closes it. Code can contain `"""` or a trailing backslash, so neither is used. */
export const BLOCK_OPEN = "<<<";
export const BLOCK_CLOSE = ">>>";

export const CHAT_HELP = `Type a question and press Enter. To paste code or several lines, type ${BLOCK_OPEN} on a line of its own, paste, then type ${BLOCK_CLOSE} on a line of its own. /save [name] writes this Session as a note, /glossary term: meaning adds a glossary entry. /exit (or /quit), Ctrl-D or Ctrl-C at the prompt ends the chat; Ctrl-C while an answer is streaming cancels just that answer.`;

export interface ChatOptions {
  input: Readable;
  output: Writable;
  session: Session;
  model: LanguageModel;
  /** Cleans the model's text for the terminal; called once per answer, so its state never spans answers. */
  stripper: () => (text: string) => string;
  /** Shows an error or note on the status stream. */
  report: (kind: "error" | "info", text: string) => void;
  describe: (err: unknown) => string;
  /** Attaches the files a question mentions with `@path`. Throws a LearnError when one cannot be attached; the question is then not sent. */
  attach: (question: string) => Promise<Attached>;
  /** Called with each follow-up request just before it is sent (`--show-prompt`). */
  onRequest?: (request: ModelRequest) => void;
  /** Hands over the process's signal handling for as long as the chat runs. The handler gets the exit code the signal stands for (130 or 143). */
  takeSignals: (handler: (code: number) => void) => void;
  /** `/save`: writes the Session as a note and returns where. Throws a LearnError when it cannot; the chat goes on. */
  save: (name: string | undefined) => Promise<string>;
  /** `/glossary`: appends an entry to the glossary file and returns where. */
  glossary: (term: string, definition: string) => Promise<string>;
}

/**
 * The interactive loop: read a question, stream the answer, repeat. Resolves to the exit code.
 * Only readline lives here; the Session and the model call are core's.
 */
export async function runChat(opts: ChatOptions): Promise<number> {
  const rl = createInterface({ input: opts.input, output: opts.output, terminal: true, prompt: "learn> " });
  let current: AbortController | undefined;
  // Lines are queued as they arrive, so none is lost between one answer finishing and the next prompt.
  const lines: string[] = [];
  let closed = false;
  let waiting: (() => void) | undefined;
  const wake = () => waiting?.();
  // Lines that arrive while an answer streams are discarded, not queued: a pasted block would otherwise become several questions.
  let discarded = 0;
  rl.on("line", (line) => {
    if (current) {
      discarded += 1;
      return;
    }
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
    const command = /^\/(save|glossary)(?:\s+([\s\S]*))?$/.exec(question);
    if (command) {
      const args = command[2]?.trim() ?? "";
      try {
        if (command[1] === "save") {
          opts.report("info", `saved to ${await opts.save(args === "" ? undefined : args)}`);
        } else {
          const split = /^([^:]+):([\s\S]+)$/.exec(args);
          if (!split || split[1]!.trim() === "" || split[2]!.trim() === "") opts.report("info", "usage: /glossary term: meaning");
          else opts.report("info", `added to ${await opts.glossary(split[1]!, split[2]!)}`);
        }
      } catch (err) {
        opts.report("error", opts.describe(err));
      }
      continue;
    }
    if (/^\/[a-z]+$/.test(question)) {
      if (question === "/exit" || question === "/quit") break;
      opts.report("info", `${question} is not a command (commands: /save, /glossary, /exit)`);
      continue;
    }
    let attachedFiles: string[] = [];
    let sensitive = false;
    try {
      const attached = await opts.attach(question);
      for (const report of attached.reports) opts.report("info", formatContextReport(report));
      for (const note of attached.notes) opts.report("info", note);
      question = attached.content;
      attachedFiles = attached.files;
      sensitive = attached.reports.some(hasOverride);
    } catch (err) {
      const refused = reportForError(err);
      if (refused) opts.report("info", formatContextReport(refused));
      opts.report("error", `${opts.describe(err)}; your message was not sent`);
      continue;
    }
    current = new AbortController();
    const strip = opts.stripper();
    for await (const event of followUp({ session: opts.session, question, model: opts.model, signal: current.signal, files: attachedFiles, sensitive, onRequest: opts.onRequest })) {
      if (event.type === "context-report") {
        opts.report("info", formatContextReport(event.report));
      } else if (event.type === "text-delta") {
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
    // Lines that were already queued in the same read as the question are typed-ahead too, and so is a half-typed line.
    discarded += lines.splice(0).length;
    rl.write(null, { ctrl: true, name: "u" });
    if (discarded > 0) opts.report("info", `discarded ${discarded} line${discarded === 1 ? "" : "s"} typed while the answer was streaming; type again to ask`);
    discarded = 0;
    if (endedBy !== undefined) break;
  }
  rl.close();
  return endedBy ?? 0;
}
