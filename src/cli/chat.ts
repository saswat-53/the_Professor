import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { CancelledError, QUIZ_LENGTH, focusLabel, followUp, formatContextReport, generateQuiz, gradeAnswer, hasOverride, reportForError } from "../core/index.js";
import type { Attached, ExplainEvent, LanguageModel, LearnError, ModelRequest, Session } from "../core/index.js";
import { BLOCK_CLOSE, BLOCK_OPEN, chatHelpText, findChatCommand, unknownCommandMessage } from "./chat-commands.js";
import type { ChatCommandName } from "./chat-commands.js";
import type { Mood } from "./mascot/animator.js";
import { MOUSE_OFF, MOUSE_ON, filterMouse } from "./mouse.js";
import type { Scrollback } from "./scrollback.js";

export { BLOCK_CLOSE, BLOCK_OPEN } from "./chat-commands.js";

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
  /** Printed once before the help line; the caller leaves it out when nobody is watching a terminal. */
  banner?: string;
  /** What to print above each main prompt (the footer, with a rule on a colour terminal), built fresh every time so it shows the latest numbers and the terminal's current width. Absent: nothing is printed. */
  header?: () => string;
  /** The main prompt. Default `learn> `. */
  prompt?: string;
  /** `/clear`: the Session has just been emptied; clear the screen and start the display afresh. */
  onClear?: () => void;
  /** Scrolling back through the chat while the animated owl pins the top of the screen (the terminal cannot, since it drops lines that leave a pinned region). Absent: nothing to scroll. */
  scrollback?: Scrollback;
  /** With a scrollback: also take the mouse wheel and trackpad scrolling from the terminal. Default true; it costs plain click-and-drag text selection (most terminals select with Option or Shift held). */
  mouse?: boolean;
  /** The animated owl. The chat only says what it is doing; how that is drawn is the owl's business. */
  mascot?: { mood(mood: Mood): void };
}

/**
 * The interactive loop: read a question, stream the answer, repeat. Resolves to the exit code.
 * Only readline lives here; the Session and the model call are core's.
 */
export async function runChat(opts: ChatOptions): Promise<number> {
  const mainPrompt = opts.prompt ?? "learn> ";
  // The wheel arrives as escape sequences mixed in with the keys; they are taken out before readline can type them into the line.
  const mouse = opts.scrollback && opts.mouse !== false ? filterMouse(opts.input as Parameters<typeof filterMouse>[0], (turn) => onWheel(turn)) : undefined;
  const rl = createInterface({ input: mouse?.input ?? opts.input, output: opts.output, terminal: true, prompt: opts.prompt ?? "learn> " });
  let current: AbortController | undefined;
  const mood = (m: Mood) => opts.mascot?.mood(m);
  /** Everything the chat prints goes through here, so the scrollback has it. */
  const emit = (text: string) => {
    opts.scrollback?.record(text);
    opts.output.write(text);
  };
  // A quiz that could not start leaves the owl startled; the loop must not wipe that with "idle".
  let quizFailed = false;
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
    // What the reader typed is part of the conversation they may scroll back to.
    opts.scrollback?.record(`${rl.getPrompt()}${line}\n`);
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

  // Scrolling back: PageUp and PageDown (fn+up and fn+down on a Mac) go through the history; any other key returns to the live view and is then
  // typed as usual. Readline would otherwise type the raw escape sequence of a key it does not know into the line, so those keys are taken
  // before it sees them (`_ttyWrite` is how readline handles a key; wrapping it is the one place to do that).
  const sb = opts.scrollback;
  /** Lines a notch of the wheel moves. */
  const WHEEL_LINES = 3;
  /** A move through the history. Not while an answer streams: each new piece of text would snap the view back. */
  const moveHistory = (move: () => void) => {
    if (!sb || current) return;
    const was = sb.active;
    move();
    // Coming back to the live view leaves the prompt line to be redrawn.
    if (was && !sb.active) rl.prompt(true);
  };
  const onWheel = (turn: "up" | "down") => moveHistory(() => (turn === "up" ? sb!.up(WHEEL_LINES) : sb!.down(WHEEL_LINES)));
  if (sb) {
    type TtyWrite = (s: string | undefined, key: { name?: string } | undefined) => void;
    const inner = rl as unknown as { _ttyWrite: TtyWrite };
    const original = inner._ttyWrite.bind(rl);
    inner._ttyWrite = (s, key) => {
      const name = key?.name;
      if (name === "pageup" || name === "pagedown") {
        moveHistory(() => (name === "pageup" ? sb.up() : sb.down()));
        return;
      }
      // While a history page is showing, the arrow keys move a line at a time; at the live view they keep recalling earlier questions.
      if (sb.active && (name === "up" || name === "down")) {
        moveHistory(() => (name === "up" ? sb.up(1) : sb.down(1)));
        return;
      }
      if (sb.active) {
        sb.end();
        rl.prompt(true);
        // Escape and End only mean "back"; anything else is also typed.
        if (name === "escape" || name === "end") return;
      }
      original(s, key);
    };
    // A new size re-flows the page, so go back to the live view rather than show a stale one.
    const onResize = () => {
      if (!sb.active) return;
      sb.end();
      rl.prompt(true);
    };
    opts.output.on("resize", onResize);
    rl.on("close", () => opts.output.off("resize", onResize));
    if (mouse) {
      opts.output.write(MOUSE_ON);
      // Handed back whichever way the chat ends, or the shell would be left printing a report for every mouse move.
      rl.on("close", () => {
        opts.output.write(MOUSE_OFF);
        mouse.close();
      });
    }
  }
  opts.takeSignals(interrupt);

  /** A message whose first line is `first`: that line, or a pasted block when it is `<<<`. Undefined when input ends inside the block. */
  const readMessage = async (first: string, prompt: string): Promise<string | undefined> => {
    if (first.trim() !== BLOCK_OPEN) return first.trim();
    const block: string[] = [];
    rl.setPrompt("... ");
    for (;;) {
      rl.prompt();
      const line = await next();
      if (line === undefined) return undefined;
      if (line.trim() === BLOCK_CLOSE) break;
      block.push(line);
    }
    rl.setPrompt(prompt);
    return block.join("\n").trim();
  };

  /** Writes a model reply's events to the terminal, the way every streamed answer is shown. */
  let lastChar = "\n";
  const show = async (events: AsyncIterable<ExplainEvent>) => {
    const strip = opts.stripper();
    for await (const event of events) {
      if (event.type === "context-report") {
        opts.report("info", formatContextReport(event.report));
      } else if (event.type === "text-delta") {
        mood("speaking");
        const text = strip(event.text);
        emit(text);
        lastChar = text.at(-1) ?? lastChar;
      } else if (event.type === "error") {
        if (lastChar !== "\n") emit("\n");
        lastChar = "\n";
        if (event.error instanceof CancelledError) {
          mood("idle");
          opts.report("info", "cancelled");
        } else {
          mood("startled");
          opts.report("error", opts.describe(event.error));
        }
      } else if (event.type === "done") {
        mood("idle");
        emit("\n");
        lastChar = "\n";
      }
    }
  };

  /** After a request ends: lines typed ahead meanwhile are dropped, so a paste cannot become several answers. */
  const settle = () => {
    current = undefined;
    // Lines that were already queued in the same read as the question are typed-ahead too, and so is a half-typed line.
    discarded += lines.splice(0).length;
    // Clearing the line makes readline redraw it, prompt included; with the prompt empty it redraws nothing, so no stray `❯ ` is left where the footer starts.
    const prompt = rl.getPrompt();
    rl.setPrompt("");
    rl.write(null, { ctrl: true, name: "u" });
    rl.setPrompt(prompt);
    if (discarded > 0) opts.report("info", `discarded ${discarded} line${discarded === 1 ? "" : "s"} typed while the answer was streaming; type again to ask`);
    discarded = 0;
  };

  /** `/quiz`: one request for the questions, then each one in turn. Nothing is added to the Session and nothing is kept. */
  const quiz = async () => {
    current = new AbortController();
    mood("thinking");
    let questions: string[];
    try {
      questions = await generateQuiz({ session: opts.session, model: opts.model, signal: current.signal, onRequest: opts.onRequest });
    } catch (err) {
      if (err instanceof CancelledError) {
        mood("idle");
        opts.report("info", "cancelled");
      } else {
        mood("startled");
        quizFailed = true;
        opts.report("error", opts.describe(err));
      }
      settle();
      return;
    }
    settle();
    emit(`${QUIZ_LENGTH} questions. Answer in your own words; /skip passes, /quit stops.\n`);
    for (const [i, question] of questions.entries()) {
      if (closed || endedBy !== undefined) return;
      emit(`\nQuestion ${i + 1} of ${questions.length}: ${opts.stripper()(question)}\n`);
      let answer = "";
      mood("quiz");
      while (answer === "") {
        rl.setPrompt("answer> ");
        rl.prompt();
        const line = await next();
        if (line === undefined) return;
        const text = await readMessage(line, "answer> ");
        if (text === undefined) return;
        answer = text;
      }
      if (answer === "/quit") {
        emit("quiz stopped\n");
        return;
      }
      if (answer === "/skip") {
        emit("skipped\n");
        continue;
      }
      current = new AbortController();
      const { signal } = current;
      mood("thinking");
      await show(gradeAnswer({ session: opts.session, question, answer, model: opts.model, signal, onRequest: opts.onRequest }));
      settle();
      // Ctrl-C while a grade streams stops the quiz, as /quit does.
      if (signal.aborted) {
        emit("quiz stopped\n");
        return;
      }
      if (endedBy !== undefined) return;
    }
    emit("\nThat was the quiz. Nothing was scored or stored.\n");
  };

  /** What each command does. Typed by the table's names, so a table entry with no handler, or a handler for a command not in the table, does not compile. */
  type Outcome = "next" | "end";
  const handlers = {
    "/quiz": async (): Promise<Outcome> => {
      quizFailed = false;
      await quiz();
      if (!quizFailed) mood("idle");
      return endedBy !== undefined ? "end" : "next";
    },
    "/save": async (args: string): Promise<Outcome> => {
      try {
        mood("saving");
        opts.report("info", `saved to ${await opts.save(args === "" ? undefined : args)}`);
      } catch (err) {
        mood("startled");
        opts.report("error", opts.describe(err));
      }
      return "next";
    },
    "/glossary": async (args: string): Promise<Outcome> => {
      try {
        const split = /^([^:]+):([\s\S]+)$/.exec(args);
        if (!split || split[1]!.trim() === "" || split[2]!.trim() === "") opts.report("info", "usage: /glossary term: meaning");
        else {
          mood("saving");
          opts.report("info", `added to ${await opts.glossary(split[1]!, split[2]!)}`);
        }
      } catch (err) {
        mood("startled");
        opts.report("error", opts.describe(err));
      }
      return "next";
    },
    "/clear": async (): Promise<Outcome> => {
      opts.session.clear();
      opts.onClear?.();
      mood("idle");
      return "next";
    },
    "/help": async (): Promise<Outcome> => {
      emit(`${chatHelpText()}\n`);
      return "next";
    },
    "/exit": async (): Promise<Outcome> => "end",
  } satisfies Record<ChatCommandName, (args: string) => Promise<Outcome>>;

  if (opts.banner) emit(`\n${opts.banner}\n`);
  emit(`${chatHelpText()}\n`);
  while (!closed) {
    rl.setPrompt(mainPrompt);
    const header = opts.header?.();
    if (header) emit(`${header}\n`);
    rl.prompt();
    const first = await next();
    if (first === undefined) break;
    const message = await readMessage(first, mainPrompt);
    if (message === undefined) return endedBy ?? 0; // closed inside a block: the half-pasted text is dropped
    let question = message;
    if (question === "") continue;
    // A command is `/word`, optionally followed by words. The table says what it is; one that takes no words, typed with some, is an ordinary question.
    const typed = /^(\/[a-z]+)(?:\s+([\s\S]*))?$/.exec(question);
    if (typed) {
      const command = findChatCommand(typed[1]!);
      const args = typed[2]?.trim() ?? "";
      if (command && (command.takesArgs || args === "")) {
        if ((await handlers[command.name](args)) === "end") break;
        continue;
      }
      if (!command && args === "") {
        opts.report("info", unknownCommandMessage(typed[1]!));
        continue;
      }
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
      // The footer follows the latest thing asked about: the last file the message attached (nothing changes when it attached none).
      const focus = attached.reports.map(focusLabel).filter((label): label is string => label !== undefined).at(-1);
      if (focus !== undefined) opts.session.focus(focus);
    } catch (err) {
      const refused = reportForError(err);
      if (refused) opts.report("info", formatContextReport(refused));
      mood("startled");
      opts.report("error", `${opts.describe(err)}; your message was not sent`);
      continue;
    }
    current = new AbortController();
    mood("thinking");
    await show(followUp({ session: opts.session, question, model: opts.model, signal: current.signal, files: attachedFiles, sensitive, onRequest: opts.onRequest }));
    settle();
    if (endedBy !== undefined) break;
  }
  rl.close();
  return endedBy ?? 0;
}
