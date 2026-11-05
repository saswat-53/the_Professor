import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { filterMouse, splitMouse } from "../src/cli/mouse.js";

const ESC = "\u001b";
const buf = (text: string) => Buffer.from(text, "latin1");
const empty = Buffer.alloc(0);

describe("splitMouse", () => {
  it("takes a wheel report in the SGR encoding out of the input, and says which way it turned", () => {
    const r = splitMouse(buf(`${ESC}[<64;10;5M${ESC}[<65;10;5M`), empty);
    expect(r.wheel).toEqual(["up", "down"]);
    expect(r.text.length).toBe(0);
  });
  it("takes a wheel report in the older encoding (a button byte and two position bytes) out too, whatever the position bytes are", () => {
    const r = splitMouse(Buffer.from([0x1b, 0x5b, 0x4d, 96, 200, 130, 0x1b, 0x5b, 0x4d, 97, 40, 33]), empty);
    expect(r.wheel).toEqual(["up", "down"]);
    expect(r.text.length).toBe(0);
  });
  it("swallows clicks and releases without reporting a wheel turn, so they are never typed", () => {
    const r = splitMouse(buf(`${ESC}[<0;3;4M${ESC}[<0;3;4m${ESC}[<2;3;4M`), empty);
    expect(r.wheel).toEqual([]);
    expect(r.text.length).toBe(0);
  });
  it("leaves everything else alone: text, arrow keys, PageUp, and a lone Escape", () => {
    for (const keys of ["hello", `${ESC}[A`, `${ESC}[5~`, `${ESC}`, `${ESC}[1;5C`, "é漢"]) {
      const r = splitMouse(Buffer.from(keys), empty);
      expect(r.text.toString()).toBe(keys);
      expect(r.wheel).toEqual([]);
    }
  });
  it("keeps typed text on either side of a report", () => {
    const r = splitMouse(buf(`ab${ESC}[<64;1;1Mcd`), empty);
    expect(r.text.toString("latin1")).toBe("abcd");
    expect(r.wheel).toEqual(["up"]);
  });
  it("holds back a report cut in two by the way the input arrived, and finishes it with the next piece", () => {
    const first = splitMouse(buf(`x${ESC}[<64;1`), empty);
    expect(first.text.toString("latin1")).toBe("x");
    expect(first.wheel).toEqual([]);
    const second = splitMouse(buf("0;5Myz"), first.carry);
    expect(second.wheel).toEqual(["up"]);
    expect(second.text.toString("latin1")).toBe("yz");
    const legacy = splitMouse(Buffer.from([0x1b, 0x5b, 0x4d, 96]), empty);
    expect(legacy.wheel).toEqual([]);
    expect(splitMouse(Buffer.from([40, 33]), legacy.carry).wheel).toEqual(["up"]);
  });
});

describe("filterMouse", () => {
  /** A stand-in for a terminal's input: it records the raw mode it was put in. */
  function fakeTerminal() {
    const source = new PassThrough() as PassThrough & { setRawMode: (mode: boolean) => unknown; isRaw: boolean };
    source.isRaw = false;
    source.setRawMode = (mode) => ((source.isRaw = mode), source);
    return source;
  }
  it("passes keys on, reports wheel turns, and forwards raw mode so readline can use it", async () => {
    const source = fakeTerminal();
    const turns: string[] = [];
    const filtered = filterMouse(source, (d) => turns.push(d));
    const seen: string[] = [];
    filtered.input.on("data", (d: Buffer) => seen.push(d.toString()));
    source.write(`ab${ESC}[<64;1;1Mcd`);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.join("")).toBe("abcd");
    expect(turns).toEqual(["up"]);
    (filtered.input as unknown as { setRawMode: (m: boolean) => void }).setRawMode(true);
    expect(source.isRaw).toBe(true);
    expect((filtered.input as unknown as { isRaw: boolean }).isRaw).toBe(true);
    filtered.close();
    source.write(`${ESC}[<64;1;1M`);
    await new Promise((r) => setTimeout(r, 20));
    expect(turns).toEqual(["up"]);
  });
});
