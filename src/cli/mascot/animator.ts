import { REST } from "./pose.js";
import type { Pose } from "./pose.js";

/** What the chat is doing; each mood has its own clip. */
export type Mood = "idle" | "thinking" | "speaking" | "quiz" | "saving" | "startled" | "goodbye";

/** One picture and how long to show it. `Infinity` holds it until the mood changes. */
export interface Frame {
  pose: Pose;
  ms: number;
}

interface Clip {
  frames: Frame[];
  /** Loops when absent; `"hold"` stays on the last frame; a mood plays after the clip ends. */
  then?: Mood | "hold";
}

const pose = (overrides: Partial<Pose>): Pose => ({ ...REST, ...overrides });
const frame = (overrides: Partial<Pose>, ms: number): Frame => ({ pose: pose(overrides), ms });

const BREATH = [0, 0.5, 1, 0.5];

/** Breathing, then a blink after 2 to 5 seconds. The gap is random, which is what makes it look alive. */
function idleClip(random: () => number): Clip {
  const gap = 2000 + random() * 3000;
  const frames: Frame[] = [];
  for (let t = 0, i = 0; t < gap; t += 500, i++) frames.push(frame({ glow: BREATH[i % 4]!, dy: i % 4 === 2 ? 1 : 0 }, 500));
  frames.push(frame({ eyes: "half" }, 50), frame({ eyes: "closed" }, 90), frame({ eyes: "half" }, 50));
  return { frames };
}

function clipFor(mood: Mood, random: () => number): Clip {
  switch (mood) {
    case "idle":
      return idleClip(random);
    case "thinking": // looking around, hat tipping with the head
      return {
        frames: [frame({ eyes: "left", hat: -1 }, 380), frame({ eyes: "up" }, 280), frame({ eyes: "right", hat: 1 }, 380), frame({ eyes: "up" }, 280)],
      };
    case "speaking": // the beak opens and closes at an uneven pace, like talking
      return {
        frames: [frame({ beak: "open" }, 140), frame({}, 90), frame({ beak: "open", eyes: "wide" }, 160), frame({}, 80), frame({ beak: "open" }, 120), frame({}, 110)],
      };
    case "quiz": // head tilted, one brow up
      return {
        frames: [frame({ eyes: "curious" }, 600), frame({ eyes: "curious", hat: 1 }, 500), frame({}, 350), frame({ eyes: "curious", hat: -1 }, 500)],
      };
    case "saving": { // the quill dips a few times, then a happy squint
      const dips = Array.from({ length: 6 }, (_, i) => frame({ arm: i % 2 === 0 ? "quill" : "quill2" }, 150));
      return { frames: [...dips, frame({ eyes: "closed" }, 350)], then: "idle" };
    }
    case "startled": // puffs up and hops, then settles
      return { frames: [frame({ eyes: "wide", beak: "open", dy: -1 }, 350), frame({ eyes: "wide", beak: "open" }, 200), frame({ eyes: "half" }, 120)], then: "idle" };
    case "goodbye": // a wave, then a sleepy close that stays
      return {
        frames: [frame({ arm: "wave" }, 160), frame({ arm: "wave2" }, 160), frame({ arm: "wave" }, 160), frame({ arm: "wave2" }, 160), frame({ eyes: "half" }, 150), frame({ eyes: "closed" }, Infinity)],
        then: "hold",
      };
  }
}

export interface Animator {
  /** Asks for a mood. The change happens at the next `next()` and goes through a blink. Returns false when nothing changes. */
  setMood(mood: Mood): boolean;
  /** The frame to show now; call again after its `ms`. */
  next(): Frame;
  readonly mood: Mood;
  /** True once a mood that holds (goodbye) has reached its last frame. */
  readonly done: boolean;
}

/**
 * The state machine behind the owl, pure so it is tested without a terminal or a clock. Each mood is a
 * clip. Changing mood never cuts: the old pose's eyes close in two steps, the new pose appears under the
 * closed lids, and they open again. A blink hides the change, as it would on a real face.
 * The latest request wins when several arrive before the next frame.
 */
export function createAnimator({ random = Math.random }: { random?: () => number } = {}): Animator {
  let mood: Mood = "idle";
  let clip = clipFor("idle", random);
  let index = -1;
  let pending: Mood | undefined;
  let bridge: Frame[] = [];
  let last: Pose = REST;
  let done = false;

  const show = (f: Frame): Frame => {
    last = f.pose;
    return f;
  };

  const startTransition = (target: Mood) => {
    mood = target;
    clip = clipFor(target, random);
    index = -1;
    done = false;
    const first = clip.frames[0]!.pose;
    bridge = [
      { pose: { ...last, eyes: "half" }, ms: 50 },
      { pose: { ...last, eyes: "closed" }, ms: 70 },
      { pose: { ...first, eyes: "closed" }, ms: 60 },
      { pose: { ...first, eyes: "half" }, ms: 50 },
    ];
  };

  return {
    get mood() {
      return mood;
    },
    get done() {
      return done;
    },
    setMood(next) {
      if (next === (pending ?? mood)) return false;
      pending = next;
      return true;
    },
    next() {
      for (;;) {
        if (pending !== undefined) {
          const target = pending;
          pending = undefined;
          if (target !== mood || done) startTransition(target);
        }
        if (bridge.length > 0) return show(bridge.shift()!);
        index++;
        if (index >= clip.frames.length) {
          if (clip.then === "hold") {
            index = clip.frames.length - 1;
            done = true;
          } else if (clip.then) {
            pending = clip.then;
            continue;
          } else {
            clip = clipFor(mood, random);
            index = 0;
          }
        }
        const f = clip.frames[index]!;
        if (f.ms === Infinity) done = true;
        return show(f);
      }
    },
  };
}
