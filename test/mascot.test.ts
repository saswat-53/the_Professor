import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnimator } from "../src/cli/mascot/animator.js";
import type { Mood } from "../src/cli/mascot/animator.js";
import { chooseOwlStyle, HEADER_ROWS, startMascot } from "../src/cli/mascot/mascot.js";
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
  it("animates for a person on a colour terminal that is big enough", () => {
    expect(chooseOwlStyle(big)).toBe("animated");
  });
  it("falls back to the still owl without colour or without room", () => {
    expect(chooseOwlStyle({ ...big, color: false })).toBe("static");
    expect(chooseOwlStyle({ ...big, rows: 12 })).toBe("static");
    expect(chooseOwlStyle({ ...big, columns: 40 })).toBe("static");
    expect(chooseOwlStyle({ ...big, rows: undefined })).toBe("static");
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
