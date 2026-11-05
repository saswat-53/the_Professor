import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";

const ESC = 0x1b;
const BRACKET = 0x5b; // [
const LESS = 0x3c; // <
const M_UPPER = 0x4d;
const M_LOWER = 0x6d;

/** Asks the terminal to report the mouse: button presses and the wheel (1000), in the encoding that has no limit on the screen's size (1006). */
export const MOUSE_ON = "\u001b[?1000h\u001b[?1006h";
export const MOUSE_OFF = "\u001b[?1006l\u001b[?1000l";

export type WheelTurn = "up" | "down";

/** The wheel turn a button code stands for, or undefined for anything else (a click, a release, a sideways wheel). Bit 6 marks the wheel; bit 0 says which way. */
function wheelOf(button: number): WheelTurn | undefined {
  if (!(button & 64) || button & 2) return undefined;
  return button & 1 ? "down" : "up";
}

/**
 * Takes mouse reports out of terminal input. They arrive as escape sequences mixed in with the keys: `ESC [ < button ; column ; row M` (or `m` for a
 * release) in the encoding asked for, and `ESC [ M` followed by three bytes in the older one a terminal falls back on. Readline would type them into
 * the line as text, so they must go before it sees them. Works on bytes, since the older encoding's position bytes are not valid text.
 *
 * Returns the input without the reports, the wheel turns found, and a `carry` to give back with the next piece: a report can be cut in two by the
 * way the input arrives. A lone Escape (the key) is not held back.
 */
export function splitMouse(chunk: Buffer, carry: Buffer): { text: Buffer; wheel: WheelTurn[]; carry: Buffer } {
  const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
  const kept: number[] = [];
  const wheel: WheelTurn[] = [];
  let i = 0;
  while (i < data.length) {
    if (data[i] !== ESC || data[i + 1] !== BRACKET) {
      // `ESC` as the very last byte could be the start of a report, but is far more often the key; it is passed on.
      kept.push(data[i]!);
      i += 1;
      continue;
    }
    const kind = data[i + 2];
    if (kind === undefined) {
      // `ESC [` and nothing yet: pass it on; every real key sequence arrives whole.
      kept.push(data[i]!);
      i += 1;
    } else if (kind === M_UPPER) {
      // The older encoding: three bytes follow (button + 32, column + 32, row + 32).
      if (i + 6 > data.length) return { text: Buffer.from(kept), wheel, carry: data.subarray(i) };
      const turn = wheelOf(data[i + 3]! - 32);
      if (turn) wheel.push(turn);
      i += 6;
    } else if (kind === LESS) {
      let j = i + 3;
      while (j < data.length && ((data[j]! >= 0x30 && data[j]! <= 0x39) || data[j] === 0x3b)) j += 1;
      if (j >= data.length) return { text: Buffer.from(kept), wheel, carry: data.subarray(i) };
      if (data[j] === M_UPPER || data[j] === M_LOWER) {
        const button = Number.parseInt(data.subarray(i + 3, j).toString("latin1").split(";")[0] ?? "", 10);
        const turn = data[j] === M_UPPER && Number.isFinite(button) ? wheelOf(button) : undefined;
        if (turn) wheel.push(turn);
        i = j + 1;
      } else {
        // Not a mouse report after all: pass the introducer on and carry on from the next byte.
        kept.push(data[i]!);
        i += 1;
      }
    } else {
      kept.push(data[i]!);
      i += 1;
    }
  }
  return { text: Buffer.from(kept), wheel, carry: Buffer.alloc(0) };
}

type TerminalInput = Readable & { setRawMode?: (mode: boolean) => unknown; isRaw?: boolean };

/**
 * Puts a filter between the terminal's input and readline: everything passes except mouse reports, whose wheel turns go to `onWheel`. The result
 * stands in for the terminal where readline wants one (it asks it for raw mode, so that is passed through).
 */
export function filterMouse(source: TerminalInput, onWheel: (turn: WheelTurn) => void): { input: Readable; close(): void } {
  const proxy = new PassThrough();
  Object.defineProperty(proxy, "isTTY", { value: true });
  Object.defineProperty(proxy, "isRaw", { get: () => source.isRaw ?? false });
  Object.defineProperty(proxy, "setRawMode", { value: (mode: boolean) => (source.setRawMode?.(mode), proxy) });
  let carry: Buffer = Buffer.alloc(0);
  const onData = (chunk: Buffer | string) => {
    const split = splitMouse(typeof chunk === "string" ? Buffer.from(chunk) : chunk, carry);
    carry = split.carry;
    if (split.text.length > 0) proxy.write(split.text);
    for (const turn of split.wheel) onWheel(turn);
  };
  source.on("data", onData);
  return {
    input: proxy,
    close() {
      source.off("data", onData);
      source.pause();
      proxy.end();
    },
  };
}
