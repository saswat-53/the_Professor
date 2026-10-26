import { createAnimator } from "./animator.js";
import type { Mood } from "./animator.js";
import { composePose } from "./pose.js";
import type { Pose } from "./pose.js";
import { renderPixels } from "./render.js";
import type { ColorDepth } from "./render.js";

/** The owl takes the top of the screen: 7 text rows of owl and a spacer. Everything the chat prints scrolls below it. */
export const HEADER_ROWS = 8;
const MIN_ROWS = 20;
const MIN_COLUMNS = 50;
const WORDS_COLUMN = 18;

const WORDS: Record<number, string> = { 1: "Professor", 2: "ask me about this code", 3: "/exit to leave" };
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

export type OwlStyle = "animated" | "static" | "off";

/**
 * Pure choice of how the owl appears. Animation needs a person at a colour terminal that is big enough for
 * the header plus room to chat, and `LEARN_OWL=static|off` opts out (the scroll region keeps lines that
 * scroll off the top out of the terminal's own scrollback, which some people won't want).
 */
export function chooseOwlStyle({ color, rows, columns, env }: { color: boolean; rows: number | undefined; columns: number | undefined; env: Record<string, string | undefined> }): OwlStyle {
  if (env.LEARN_OWL === "off") return "off";
  if (env.LEARN_OWL === "static" || !color) return "static";
  if ((rows ?? 0) < MIN_ROWS || (columns ?? 0) < MIN_COLUMNS) return "static";
  return "animated";
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
}

const ESC = "\u001b";
const SAVE = `${ESC}7`;
const RESTORE = `${ESC}8`;
const goTo = (row: number, column = 1) => `${ESC}[${row};${column}H`;
const setRegion = (top: number, bottom: number) => `${ESC}[${top};${bottom}r`;
const RESET_REGION = `${ESC}[r`;

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

  const draw = (pose: Pose, mood: Mood) => {
    const owl = renderPixels(composePose(pose), depth);
    let text = SAVE;
    owl.forEach((line, i) => {
      const words = i === CAPTION_ROW ? CAPTION[mood] : (WORDS[i] ?? "");
      text += `${goTo(i + 1)}${line}${words ? `${goTo(i + 1, WORDS_COLUMN)}${ESC}[2m${words}${ESC}[0m` : ""}${ESC}[K`;
    });
    output.write(`${text}${RESTORE}`);
  };

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
