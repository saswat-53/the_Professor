import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnimator } from "../src/cli/mascot/animator.js";
import type { Mood } from "../src/cli/mascot/animator.js";
import { chooseOwlStyle, HEADER_ROWS, startInlineMascot, startMascot } from "../src/cli/mascot/mascot.js";
import type { MascotOutput } from "../src/cli/mascot/mascot.js";
import { CANVAS_HEIGHT, CANVAS_WIDTH, REST, SPRITE, composePose } from "../src/cli/mascot/pose.js";
import type { Eyes } from "../src/cli/mascot/pose.js";
import { colorDepth, renderPixels } from "../src/cli/mascot/render.js";

// eslint-disable-next-line no-control-regex
const stripSgr = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

describe("sprite and renderer", () => {
  it("has a sprite whose rows are all the same width", () => {
    expect(new Set(SPRITE.map((row) => row.length))).toEqual(new Set([14]));
  });

  it("renders every pose as 7 text rows of 16 columns", () => {
    const eyes: Eyes[] = ["open", "half", "closed", "left", "right", "up", "wide", "curious"];
    for (const e of eyes) {
      for (const arm of ["down", "wave", "wave2", "quill", "quill2"] as const) {
        for (const hat of [-1, 0, 1] as const) {
          for (const dy of [-1, 0, 1] as const) {
            const lines = renderPixels(composePose({ ...REST, eyes: e, arm, hat, dy, beak: "open", glow: 1 }), "truecolor");
            expect(lines).toHaveLength(CANVAS_HEIGHT / 2);
            for (const line of lines) expect([...stripSgr(line)]).toHaveLength(CANVAS_WIDTH);
          }
        }
      }
    }
  });

  it("closed eyes look different from open eyes", () => {
    const open = renderPixels(composePose(REST), "truecolor").join("\n");
    const closed = renderPixels(composePose({ ...REST, eyes: "closed" }), "truecolor").join("\n");
    expect(closed).not.toBe(open);
  });

  it("uses 24-bit codes on a truecolor terminal and the 256 palette otherwise", () => {
    expect(renderPixels(composePose(REST), "truecolor").join("")).toContain("38;2;");
    const small = renderPixels(composePose(REST), "256").join("");
    expect(small).toContain("38;5;");
    expect(small).not.toContain("38;2;");
  });

  it("chooses the colour depth from the environment", () => {
    expect(colorDepth({ COLORTERM: "truecolor" })).toBe("truecolor");
    expect(colorDepth({ COLORTERM: "24bit" })).toBe("truecolor");
    expect(colorDepth({})).toBe("256");
    expect(colorDepth({ COLORTERM: "truecolor", TERM_PROGRAM: "Apple_Terminal" })).toBe("256");
  });
});

/** Runs the animator for `count` frames and returns them. */
function frames(animator: ReturnType<typeof createAnimator>, count: number) {
  return Array.from({ length: count }, () => animator.next());
}

describe("animator", () => {
  it("breathes and blinks while idle, with a gap that depends on the random source", () => {
    const eyesOf = (random: number) => {
      const out = frames(createAnimator({ random: () => random }), 14).map((f) => f.pose.eyes);
      return out.indexOf("half");
    };
    expect(eyesOf(0)).toBeLessThan(eyesOf(0.99)); // a longer gap means a later blink
    expect(eyesOf(0)).toBeGreaterThan(0);
  });

  it("changes mood through a blink: lids close, the new pose appears, lids open", () => {
    const a = createAnimator({ random: () => 0 });
    a.next();
    expect(a.setMood("thinking")).toBe(true);
    const out = frames(a, 5);
    expect(out.slice(0, 4).map((f) => f.pose.eyes)).toEqual(["half", "closed", "closed", "half"]);
    expect(out[4]!.pose.eyes).toBe("left"); // thinking's first frame
    expect(a.mood).toBe("thinking");
  });

  it("the latest request wins when several arrive before the next frame", () => {
    const a = createAnimator({ random: () => 0 });
    a.next();
    a.setMood("thinking");
    a.setMood("speaking");
    frames(a, 5);
    expect(a.mood).toBe("speaking");
  });

  it("ignores a request for the mood it is already in", () => {
    const a = createAnimator();
    expect(a.setMood("idle")).toBe(false);
    a.setMood("quiz");
    expect(a.setMood("quiz")).toBe(false);
  });

  it("keeps the old pose's body under the closing lids (no jump before the blink)", () => {
    const a = createAnimator({ random: () => 0 });
    a.setMood("startled");
    const before = a.next(); // bridge starts from REST
    expect(before.pose.dy).toBe(REST.dy);
    expect(before.pose.hat).toBe(REST.hat);
  });

  it("plays one-shot moods and returns to idle by itself", () => {
    for (const mood of ["saving", "startled"] as const) {
      const a = createAnimator({ random: () => 0 });
      a.setMood(mood);
      frames(a, 30);
      expect(a.mood).toBe("idle");
    }
  });

  it("goodbye ends on closed eyes and holds", () => {
    const a = createAnimator();
    a.setMood("goodbye");
    let f = a.next();
    for (let i = 0; i < 20 && !a.done; i++) f = a.next();
    expect(a.done).toBe(true);
    expect(f.ms).toBe(Infinity);
    expect(f.pose.eyes).toBe("closed");
    expect(a.next().ms).toBe(Infinity);
  });

  it("every mood gives every frame a positive duration", () => {
    const moods: Mood[] = ["idle", "thinking", "speaking", "quiz", "saving", "startled", "goodbye"];
    for (const mood of moods) {
      const a = createAnimator({ random: () => 0.5 });
      a.setMood(mood);
      for (const f of frames(a, 25)) expect(f.ms).toBeGreaterThan(0);
    }
  });

  it("speaking opens and closes the beak", () => {
    const a = createAnimator();
    a.setMood("speaking");
    const beaks = new Set(frames(a, 12).map((f) => f.pose.beak));
    expect(beaks).toEqual(new Set(["open", "closed"]));
  });
});

describe("chooseOwlStyle", () => {
  const big = { color: true, rows: 40, columns: 100, env: {} };
  it("puts the owl in the conversation by default, for a person on a colour terminal that is big enough", () => {
    expect(chooseOwlStyle(big)).toBe("inline");
    expect(chooseOwlStyle({ ...big, env: { LEARN_OWL: "" } })).toBe("inline");
  });
  it("pins the owl to the top only when asked for with LEARN_OWL=pinned", () => {
    expect(chooseOwlStyle({ ...big, env: { LEARN_OWL: "pinned" } })).toBe("pinned");
  });
  it("falls back to the still owl without colour or without room, whichever was chosen", () => {
    for (const env of [{}, { LEARN_OWL: "pinned" }]) {
      expect(chooseOwlStyle({ ...big, env, color: false })).toBe("static");
      expect(chooseOwlStyle({ ...big, env, rows: 12 })).toBe("static");
      expect(chooseOwlStyle({ ...big, env, columns: 40 })).toBe("static");
      expect(chooseOwlStyle({ ...big, env, rows: undefined })).toBe("static");
    }
  });
  it("lets LEARN_OWL opt out", () => {
    expect(chooseOwlStyle({ ...big, env: { LEARN_OWL: "static" } })).toBe("static");
    expect(chooseOwlStyle({ ...big, env: { LEARN_OWL: "off" } })).toBe("off");
  });
});

function fakeOutput(rows = 30, columns = 100) {
  const writes: string[] = [];
  let onResize: (() => void) | undefined;
  const output: MascotOutput & { rows: number; columns: number } = {
    rows,
    columns,
    write: (text: string) => void writes.push(text),
    on: (_event, listener) => void (onResize = listener),
    off: () => void (onResize = undefined),
  };
  return { output, writes, resize: () => onResize?.(), listening: () => onResize !== undefined };
}

describe("mascot driver", () => {
  afterEach(() => vi.useRealTimers());

  it("scrolls the screen into history, keeps chat below the header, and draws inside save/restore", () => {
    vi.useFakeTimers();
    const { output, writes } = fakeOutput(30);
    startMascot({ output, depth: "truecolor", random: () => 0 });
    const all = writes.join("");
    expect(writes[0]).toBe("\n".repeat(30));
    expect(all).toContain(`\u001b[${HEADER_ROWS + 1};30r`);
    const draw = writes.find((w) => w.startsWith("\u001b7"))!;
    expect(draw.endsWith("\u001b8")).toBe(true);
    expect(draw).toContain("Professor");
  });

  it("advances frames on a single timer and redraws at once when the mood changes", async () => {
    vi.useFakeTimers();
    const { output, writes } = fakeOutput();
    const owl = startMascot({ output, depth: "256", random: () => 0 });
    const drawn = () => writes.filter((w) => w.startsWith("\u001b7")).length;
    const initial = drawn();
    await vi.advanceTimersByTimeAsync(1100);
    expect(drawn()).toBeGreaterThan(initial);
    expect(vi.getTimerCount()).toBe(1);
    const before = drawn();
    owl.mood("thinking");
    expect(drawn()).toBe(before + 1);
    expect(writes.at(-1)).toContain("thinking...");
    owl.mood("thinking");
    expect(drawn()).toBe(before + 1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("gives the terminal back on close, stops drawing, and is safe to close twice", async () => {
    vi.useFakeTimers();
    const { output, writes, listening } = fakeOutput();
    const owl = startMascot({ output, depth: "256" });
    await owl.close();
    expect(writes.at(-1)).toBe("\u001b7\u001b[r\u001b8");
    expect(listening()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const count = writes.length;
    owl.mood("speaking");
    await owl.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toHaveLength(count);
  });

  it("waves goodbye before closing when asked", async () => {
    vi.useFakeTimers();
    const { output, writes } = fakeOutput();
    const owl = startMascot({ output, depth: "256", random: () => 0 });
    const closing = owl.close({ farewell: true });
    await vi.advanceTimersByTimeAsync(3000);
    await closing;
    expect(writes.join("")).toContain("see you!");
    expect(writes.at(-1)).toBe("\u001b7\u001b[r\u001b8");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives the screen back when the terminal shrinks too far, and returns when it grows", async () => {
    vi.useFakeTimers();
    const fake = fakeOutput(30);
    const owl = startMascot({ output: fake.output, depth: "256", random: () => 0 });
    fake.output.rows = 10;
    fake.resize();
    expect(fake.writes.at(-1)).toBe("\u001b7\u001b[r\u001b8");
    expect(vi.getTimerCount()).toBe(0);
    fake.output.rows = 30;
    fake.resize();
    expect(vi.getTimerCount()).toBe(1);
    await owl.close();
  });
});

describe("inline mascot driver", () => {
  afterEach(() => vi.useRealTimers());
  const ESC = "\u001b";

  /** A stream the owl can watch: it records what was written, and its `write` can be replaced and put back. */
  const watched = () => {
    const seen: unknown[][] = [];
    const stream = { write: (...args: unknown[]) => (seen.push(args), true) };
    return { stream, seen, original: stream.write };
  };
  const setup = (rows = 30) => {
    vi.useFakeTimers();
    const fake = fakeOutput(rows);
    const out = watched();
    const err = watched();
    const owl = startInlineMascot({ output: fake.output, watch: [out.stream, err.stream], depth: "256", random: () => 0 });
    return { ...fake, owl, out, err };
  };
  const frames = (writes: string[]) => writes.filter((w) => w.startsWith(`${ESC}7`)).length;

  it("draws the owl at the top of a cleared screen, leaves the cursor below it, and sets no scroll region", () => {
    const { writes } = setup(30);
    expect(writes[0]).toBe("\n".repeat(30));
    const all = writes.join("");
    expect(all).toContain(`${ESC}[1;1H`);
    expect(all).toContain("Professor");
    // The cursor waits on the row below the owl and its spacer, where the chat starts.
    expect(writes.some((w) => w.endsWith(`${ESC}[${HEADER_ROWS + 1};1H`))).toBe(true);
    expect(all).not.toMatch(/\u001b\[\d*;?\d*r/);
  });

  it("does not claim a scroll hint: it scrolls with the terminal's own scrollback", () => {
    const { writes } = setup(30);
    expect(writes.join("")).not.toMatch(/scroll/i);
  });

  it("animates while there is room, and passes everything written to the watched streams through unchanged", async () => {
    const { writes, out, err } = setup(30);
    const before = frames(writes);
    await vi.advanceTimersByTimeAsync(1500);
    expect(frames(writes)).toBeGreaterThan(before);
    expect(out.stream.write("hello\n", "utf8")).toBe(true);
    expect(err.stream.write("warn\n")).toBe(true);
    expect(out.seen).toEqual([["hello\n", "utf8"]]);
    expect(err.seen).toEqual([["warn\n"]]);
  });

  it("stops animating, with one last still frame, before the text reaches the owl's rows scrolling away", async () => {
    const { writes, out } = setup(30);
    await vi.advanceTimersByTimeAsync(500);
    // Text down to the last rows of the screen: the owl is about to scroll off.
    for (let i = 0; i < 25; i++) out.stream.write("line\n");
    const settled = frames(writes);
    await vi.advanceTimersByTimeAsync(5000);
    expect(frames(writes)).toBe(settled);
    expect(vi.getTimerCount()).toBe(0);
    // The last thing drawn is a settled owl, drawn at the top rows.
    expect(writes.at(-1)!.startsWith(`${ESC}7`)).toBe(true);
    expect(writes.at(-1)).toContain(`${ESC}[1;1H`);
  });

  it("never draws once the screen has scrolled, since the owl's rows then hold something else", async () => {
    const { writes, out } = setup(30);
    out.stream.write("x\n".repeat(200));
    const count = writes.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toHaveLength(count);
  });

  it("does not count its own drawing as text when the output it draws on is one of the streams it watches", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const output = { rows: 30, columns: 100, write: (text: string) => (writes.push(text), true), on: () => undefined, off: () => undefined };
    const owl = startInlineMascot({ output: output as unknown as MascotOutput, watch: [output], depth: "256", random: () => 0 });
    const frames0 = frames(writes);
    // Far more animation than would fit if each frame counted as text: it must still be going.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(frames(writes)).toBeGreaterThan(frames0 + 10);
    expect(vi.getTimerCount()).toBe(1);
    await owl.close();
  });

  it("gives the streams their own write back once it stops, and on close", async () => {
    const { owl, out, err } = setup(30);
    expect(out.stream.write).not.toBe(out.original);
    for (let i = 0; i < 25; i++) out.stream.write("line\n");
    expect(out.stream.write).toBe(out.original);
    await owl.close();
    expect(err.stream.write).toBe(err.original);
  });

  it("stops when the terminal is resized, since the text re-flows and the owl's place is unknown", async () => {
    const fake = setup(30);
    fake.output.rows = 40;
    fake.resize();
    const count = fake.writes.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.writes.length).toBe(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waves goodbye on close while it is still on screen, and is safe to close twice", async () => {
    const { owl, writes, listening } = setup(30);
    const closing = owl.close({ farewell: true });
    await vi.advanceTimersByTimeAsync(3000);
    await closing;
    expect(writes.join("")).toContain("see you!");
    expect(listening()).toBe(false);
    await owl.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts after /clear: the screen and its scrollback are erased, the owl is drawn at the top again, and it animates once more", async () => {
    const { owl, writes, out } = setup(30);
    // Let it run out of room, as a long chat does.
    for (let i = 0; i < 25; i++) out.stream.write("line\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0);
    const before = writes.length;
    owl.restart!();
    const after = writes.slice(before).join("");
    // Erase the saved lines, then the screen, then home: nothing of the old chat is left above.
    expect(after.startsWith(`${ESC}[3J${ESC}[2J${ESC}[H`)).toBe(true);
    expect(after).toContain(`${ESC}[1;1H`);
    expect(after.endsWith(`${ESC}[${HEADER_ROWS + 1};1H`)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    const frames1 = frames(writes);
    await vi.advanceTimersByTimeAsync(1500);
    expect(frames(writes)).toBeGreaterThan(frames1);
    // The room is counted afresh: a few lines do not stop it, and many still do.
    out.stream.write("a\nb\nc\n");
    expect(vi.getTimerCount()).toBe(1);
    for (let i = 0; i < 25; i++) out.stream.write("line\n");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts cleanly while it is still animating, with one timer and no doubled watching", async () => {
    const { owl, out } = setup(30);
    owl.restart!();
    owl.restart!();
    expect(vi.getTimerCount()).toBe(1);
    out.stream.write("x\n");
    expect(out.seen).toEqual([["x\n"]]);
    await owl.close();
  });

  it("does not wave after it has stopped, and ignores mood changes", async () => {
    const { owl, writes, out } = setup(30);
    for (let i = 0; i < 25; i++) out.stream.write("line\n");
    const count = writes.length;
    owl.mood("thinking");
    await owl.close({ farewell: true });
    expect(writes).toHaveLength(count);
  });
});
