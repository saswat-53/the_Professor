import { createAnimator } from "./animator.js";
import type { Mood } from "./animator.js";
import { composePose } from "./pose.js";
import type { Pose } from "./pose.js";
import { createCursorTracker } from "../cursor-tracker.js";
import { renderPixels } from "./render.js";
import type { ColorDepth } from "./render.js";

/** The owl takes the top of the screen: 7 text rows of owl and a spacer. Everything the chat prints scrolls below it. */
export const HEADER_ROWS = 8;
const MIN_ROWS = 20;
const MIN_COLUMNS = 50;
const WORDS_COLUMN = 18;

const WORDS: Record<number, string> = { 1: "Professor", 2: "ask me about this code", 3: "/exit to leave" };
/** The pinned owl has no terminal scrollback behind it, so it says how to scroll; the one in the conversation scrolls with the terminal and has no need. */
const PINNED_WORDS: Record<number, string> = { ...WORDS, 4: "scroll: trackpad or PageUp" };
const CAPTION: Record<Mood, string> = {
  idle: "",
  thinking: "thinking...",
  speaking: "explaining",
  quiz: "your turn",
  saving: "writing that down",
  startled: "oh!",
  goodbye: "see you!",
};
const CAPTION_ROW = 5;

/** `inline`: in the conversation, scrolling away with it (the default). `pinned`: fixed to the top with the chat scrolling under it. */
export type OwlStyle = "inline" | "pinned" | "static" | "off";

/**
 * Pure choice of how the owl appears. An animated owl needs a person at a colour terminal that is big enough for the owl plus room to chat.
 * By default it sits at the top of the conversation and scrolls away with it, so the terminal's own scrolling and text selection keep working.
 * `LEARN_OWL=pinned` fixes it to the top instead (the chat then draws its own scrollback and takes the mouse); `static` is a still picture and
 * `off` removes it.
 */
export function chooseOwlStyle({ color, rows, columns, env }: { color: boolean; rows: number | undefined; columns: number | undefined; env: Record<string, string | undefined> }): OwlStyle {
  if (env.LEARN_OWL === "off") return "off";
  if (env.LEARN_OWL === "static" || !color) return "static";
  if ((rows ?? 0) < MIN_ROWS || (columns ?? 0) < MIN_COLUMNS) return "static";
  return env.LEARN_OWL === "pinned" ? "pinned" : "inline";
}

/** The part of a terminal stream the owl needs; a real `process.stdout` fits, and so does a fake in tests. */
export interface MascotOutput {
  write(text: string): unknown;
  rows?: number;
  columns?: number;
  on(event: "resize", listener: () => void): unknown;
  off(event: "resize", listener: () => void): unknown;
}

export interface Mascot {
  /** Switches the animation. Safe to call as often as you like; repeating the current mood does nothing. */
  mood(mood: Mood): void;
  /** Puts the terminal back. With `farewell` the owl waves first (about a second). Safe to call twice. */
  close(options?: { farewell?: boolean }): Promise<void>;
  /** `/clear`: wipes the screen and its scrollback and starts the owl afresh at the top, animating again. Only the owl drawn into the conversation has this; the pinned one never moved. */
  restart?(): void;
}

const ESC = "\u001b";
const SAVE = `${ESC}7`;
const RESTORE = `${ESC}8`;
const goTo = (row: number, column = 1) => `${ESC}[${row};${column}H`;
const setRegion = (top: number, bottom: number) => `${ESC}[${top};${bottom}r`;
const RESET_REGION = `${ESC}[r`;

/** One frame of the owl: its rows written at absolute positions from `firstRow`, with a caption, between a cursor save and restore. */
function bandText(pose: Pose, mood: Mood, depth: ColorDepth, words: Record<number, string>, firstRow = 1): string {
  const owl = renderPixels(composePose(pose), depth);
  let text = SAVE;
  owl.forEach((line, i) => {
    const caption = i === CAPTION_ROW ? CAPTION[mood] : (words[i] ?? "");
    text += `${goTo(firstRow + i)}${line}${caption ? `${goTo(firstRow + i, WORDS_COLUMN)}${ESC}[2m${caption}${ESC}[0m` : ""}${ESC}[K`;
  });
  return `${text}${RESTORE}`;
}

/**
 * Starts the animated owl in a header at the top of the terminal.
 *
 * How it stays out of the way: the terminal's scroll region (DECSTBM, `ESC[top;bottom r`) is set to
 * everything below the header, so the chat and streamed answers scroll in their own area and never
 * touch the owl. Each frame is drawn by saving the cursor (`ESC 7`), writing the header at absolute
 * positions, and restoring it (`ESC 8`), in one write so it cannot land in the middle of a line of text.
 * One timer drives it: each frame says how long it lasts, and the next is scheduled then.
 */
export function startMascot({ output, depth, random }: { output: MascotOutput; depth: ColorDepth; random?: () => number }): Mascot {
  const animator = createAnimator({ random });
  let rows = output.rows ?? 24;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let keepAlive = false;
  let closed = false;
  let enabled = true;

  const draw = (pose: Pose, mood: Mood) => output.write(bandText(pose, mood, depth, PINNED_WORDS));

  const tick = () => {
    timer = undefined;
    if (closed || !enabled) return;
    const { pose, ms } = animator.next();
    draw(pose, animator.mood);
    if (Number.isFinite(ms)) {
      timer = setTimeout(tick, ms);
      if (!keepAlive) timer.unref();
    }
  };

  // Setting or resetting the region sends the cursor home, so the cursor is saved and put back around it.
  const restoreTerminal = () => output.write(`${SAVE}${RESET_REGION}${RESTORE}`);

  const onResize = () => {
    rows = output.rows ?? rows;
    const fits = rows >= MIN_ROWS && (output.columns ?? MIN_COLUMNS) >= MIN_COLUMNS;
    if (fits && !enabled) {
      enabled = true;
      output.write(`${SAVE}${setRegion(HEADER_ROWS + 1, rows)}${RESTORE}`);
      tick();
    } else if (fits) {
      output.write(`${SAVE}${setRegion(HEADER_ROWS + 1, rows)}${RESTORE}`);
    } else if (enabled) {
      // Too small for an owl and a chat: give the screen back rather than squeeze both.
      enabled = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
      output.write(`${SAVE}${RESET_REGION}${RESTORE}`);
    }
  };

  // Newlines push what is on the screen into the terminal's scrollback before the header covers it.
  output.write("\n".repeat(rows));
  output.write(`${setRegion(HEADER_ROWS + 1, rows)}${goTo(HEADER_ROWS + 1)}`);
  output.on("resize", onResize);
  // If the process dies without closing, still hand back a normal terminal.
  const onExit = () => {
    if (!closed) restoreTerminal();
  };
  process.once("exit", onExit);
  tick();

  return {
    mood(mood) {
      if (closed || !enabled) return;
      // Cut the current frame short so the change is felt at once; the blink in the animator keeps it smooth.
      if (animator.setMood(mood)) {
        if (timer) clearTimeout(timer);
        tick();
      }
    },
    async close({ farewell = false } = {}) {
      if (closed) return;
      if (farewell && enabled) {
        keepAlive = true;
        animator.setMood("goodbye");
        if (timer) clearTimeout(timer);
        tick();
        const deadline = Date.now() + 2000;
        while (!animator.done && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      output.off("resize", onResize);
      process.off("exit", onExit);
      if (enabled) restoreTerminal();
    },
  };
}

/** A stream whose writes the inline owl watches to know where the cursor is. */
export interface WatchedStream {
  write: (...args: never[]) => unknown;
}

/** Rows kept between the cursor and the bottom of the screen before the owl stops: the cursor tracker can be a row or two out. */
const SAFETY_ROWS = 3;

/**
 * Starts the animated owl at the top of the conversation instead of pinning it: the screen is cleared (what was on it goes into the terminal's
 * scrollback), the owl is drawn at the top, and the chat flows below it in the ordinary way. Nothing is reserved, so the terminal's own scrolling,
 * selection and copying all work.
 *
 * The cost is that the owl scrolls away like everything else. While it is on screen it animates, drawn at the top rows by absolute position; the
 * streams in `watch` (where the chat writes) are watched to follow the cursor, and as soon as the text gets near the bottom of the screen, where
 * the next line would push the owl off, it draws one last still frame and stops for good (a drawing made after that would land on text). A resize
 * stops it too, since the text re-flows.
 */
export function startInlineMascot({ output, watch, depth, random }: { output: MascotOutput; watch: WatchedStream[]; depth: ColorDepth; random?: () => number }): Mascot {
  const animator = createAnimator({ random });
  let rows = output.rows ?? 24;
  let tracker = createCursorTracker({ rows, columns: output.columns ?? 80, startRow: HEADER_ROWS });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let keepAlive = false;
  let stopped = false;
  let closed = false;

  // The owl's own drawing must not be counted as chat text. The output is usually one of the watched streams, so its `write` is taken before
  // any watching starts, and everything the owl writes goes through that.
  const write = output.write.bind(output);
  const draw = (pose: Pose, mood: Mood) => write(bandText(pose, mood, depth, WORDS));

  const originals = watch.map((stream) => stream.write);
  const unwatch = () => watch.forEach((stream, i) => void (stream.write = originals[i]!));

  /** Ends the animation. `still`: draw one settled frame first, which is only safe while the owl's rows are still on screen. */
  const stop = (still: boolean) => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    unwatch();
    if (still && !tracker.scrolled) {
      animator.setMood("idle");
      draw(animator.next().pose, "idle");
    }
  };

  const tick = () => {
    timer = undefined;
    if (stopped || closed) return;
    const { pose, ms } = animator.next();
    draw(pose, animator.mood);
    if (Number.isFinite(ms)) {
      timer = setTimeout(tick, ms);
      if (!keepAlive) timer.unref();
    }
  };

  const watchStreams = () =>
    watch.forEach((stream, i) => {
      const original = originals[i]!;
      stream.write = ((chunk: unknown, ...rest: never[]) => {
        const result = (original as (...args: unknown[]) => unknown).call(stream, chunk, ...rest);
        tracker.feed(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
        if (tracker.scrolled || tracker.row >= rows - 1 - SAFETY_ROWS) stop(true);
        return result;
      }) as WatchedStream["write"];
    });

  /**
   * Puts the owl at the top and the cursor under it, with the room below counted afresh. Starting out, scrolling the screen up pushes what was on
   * it into the terminal's scrollback (it is the reader's); after `/clear` the saved lines are erased too, so nothing of the old chat is left.
   */
  const begin = (erase: boolean) => {
    rows = output.rows ?? 24;
    tracker = createCursorTracker({ rows, columns: output.columns ?? 80, startRow: HEADER_ROWS });
    stopped = false;
    watchStreams();
    write(erase ? `${ESC}[3J${ESC}[2J${ESC}[H` : "\n".repeat(rows));
    tick();
    write(`${ESC}[${HEADER_ROWS + 1};1H`);
  };

  const onResize = () => stop(false);
  output.on("resize", onResize);
  begin(false);

  return {
    restart() {
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      stop(false);
      begin(true);
    },
    mood(mood) {
      if (closed || stopped) return;
      if (animator.setMood(mood)) {
        if (timer) clearTimeout(timer);
        tick();
      }
    },
    async close({ farewell = false } = {}) {
      if (closed) return;
      if (farewell && !stopped) {
        keepAlive = true;
        animator.setMood("goodbye");
        if (timer) clearTimeout(timer);
        tick();
        const deadline = Date.now() + 2000;
        while (!animator.done && Date.now() < deadline && !stopped) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      output.off("resize", onResize);
      stopped = true;
      unwatch();
    },
  };
}
