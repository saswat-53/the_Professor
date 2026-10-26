/**
 * The owl as data. A Pose says what each part is doing; composePose turns it into a grid of coloured
 * pixels. Frames of every animation are just Poses, so an animation is edited by changing words, not pixels.
 */
export type Rgb = readonly [number, number, number];
/** Rows of pixels, `undefined` where the canvas is transparent. Indexed `[y][x]`. */
export type Pixels = (Rgb | undefined)[][];

export type Eyes = "open" | "half" | "closed" | "left" | "right" | "up" | "wide" | "curious";
export type Beak = "closed" | "open";
export type Arm = "down" | "wave" | "wave2" | "quill" | "quill2";

export interface Pose {
  eyes: Eyes;
  beak: Beak;
  /** Body shift in pixels (one pixel is half a text row): -1 up, 1 down. The bob and the hop. */
  dy: -1 | 0 | 1;
  /** The mortarboard slides sideways by a pixel: a tilt. */
  hat: -1 | 0 | 1;
  arm: Arm;
  /** 0..1, how much lighter the body is: the slow breathing glow. */
  glow: number;
}

export const REST: Pose = { eyes: "open", beak: "closed", dy: 0, hat: 0, arm: "down", glow: 0 };

/** One text row holds two pixel rows (a half block), so 14 pixel rows are 7 text rows. */
export const CANVAS_WIDTH = 16;
export const CANVAS_HEIGHT = 14;

/** 14 wide, 12 tall; the canvas has room around it for the bob, the tilt and the raised wing. */
export const SPRITE = [
  "..hhhhhhhhhh..",
  "hhhhhhhhhhhhhh",
  "..bbbbbbbbbb..",
  ".bbbbbbbbbbbb.",
  ".bwwwbbbbwwwb.",
  ".bwkwbbbbwkwb.",
  ".bwwwbbbbwwwb.",
  ".bbbbbyybbbbb.",
  "bdbllllllllbdb",
  ".dblldlldllbd.",
  "..bbllllllbb..",
  "...yyy....yyy.",
];

const PALETTE: Record<string, Rgb> = {
  b: [217, 119, 87],
  d: [168, 90, 63],
  l: [240, 201, 168],
  w: [255, 244, 224],
  k: [43, 29, 22],
  y: [242, 181, 60],
  h: [59, 59, 79],
  q: [245, 230, 200],
};

/** Eye rows 3..6 for the left eye and the right eye (3 pixels wide each). `b` is the lid, `d` a brow or closed line. */
const OPEN: [string[], string[]] = [
  ["bbb", "www", "wkw", "www"],
  ["bbb", "www", "wkw", "www"],
];
const EYES: Record<Eyes, [string[], string[]]> = {
  open: OPEN,
  half: [
    ["bbb", "bbb", "wkw", "www"],
    ["bbb", "bbb", "wkw", "www"],
  ],
  closed: [
    ["bbb", "bbb", "bbb", "ddd"],
    ["bbb", "bbb", "bbb", "ddd"],
  ],
  left: [
    ["bbb", "www", "kww", "www"],
    ["bbb", "www", "kww", "www"],
  ],
  right: [
    ["bbb", "www", "wwk", "www"],
    ["bbb", "www", "wwk", "www"],
  ],
  up: [
    ["bbb", "wkw", "www", "www"],
    ["bbb", "wkw", "www", "www"],
  ],
  wide: [
    ["www", "wkw", "wkw", "www"],
    ["www", "wkw", "wkw", "www"],
  ],
  curious: [["ddd", "www", "wkw", "www"], OPEN[1]],
};

/** [x, y, colour] patches over the right wing (the one that waves and writes). */
const ARMS: Record<Arm, [number, number, string][]> = {
  down: [],
  wave: [[12, 8, "b"], [12, 9, "b"], [13, 5, "d"], [13, 6, "d"], [13, 7, "d"]],
  wave2: [[12, 8, "b"], [12, 9, "b"], [13, 4, "d"], [13, 5, "d"], [13, 6, "d"]],
  quill: [[12, 8, "b"], [12, 9, "b"], [13, 6, "d"], [13, 7, "d"], [13, 4, "q"], [13, 5, "q"]],
  quill2: [[12, 8, "b"], [12, 9, "b"], [13, 7, "d"], [13, 8, "d"], [13, 5, "q"], [13, 6, "q"]],
};

const lighten = ([r, g, b]: Rgb, amount: number): Rgb => [r, g, b].map((c) => Math.round(c + (255 - c) * amount)) as unknown as Rgb;

export function composePose(pose: Pose): Pixels {
  const sprite = SPRITE.map((row) => [...row]);
  const put = (x: number, y: number, ch: string) => {
    const row = sprite[y];
    if (row && x >= 0 && x < row.length) row[x] = ch;
  };
  const [left, right] = EYES[pose.eyes];
  left.forEach((line, i) => [...line].forEach((ch, j) => put(2 + j, 3 + i, ch)));
  right.forEach((line, i) => [...line].forEach((ch, j) => put(9 + j, 3 + i, ch)));
  if (pose.beak === "open") {
    put(6, 8, "y");
    put(7, 8, "y");
  }
  for (const [x, y, ch] of ARMS[pose.arm]) put(x, y, ch);

  const body = lighten(PALETTE.b!, pose.glow * 0.18);
  const pixels: Pixels = Array.from({ length: CANVAS_HEIGHT }, () => Array<Rgb | undefined>(CANVAS_WIDTH).fill(undefined));
  sprite.forEach((row, y) => {
    const py = 1 + pose.dy + y;
    const dx = 1 + (y < 2 ? pose.hat : 0); // only the two hat rows slide
    row.forEach((ch, x) => {
      const color = ch === "b" ? body : PALETTE[ch];
      const px = x + dx;
      if (color && py >= 0 && py < CANVAS_HEIGHT && px >= 0 && px < CANVAS_WIDTH) pixels[py]![px] = color;
    });
  });
  return pixels;
}
