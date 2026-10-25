import { CancelledError } from "../core/index.js";

/** The slice of a terminal this needs, so it can be driven without one. */
export interface RawInput {
  setRawMode(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  setEncoding(encoding: "utf8"): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
}

const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
// Bracketed-paste markers and other escape sequences (arrow keys) are not part of a key.
const ESCAPES = /\u001b\[[0-9;]*[~A-Za-z]/g;

/**
 * One line typed on a terminal with nothing echoed back (raw mode, so the terminal prints nothing and the
 * characters never reach a readline history). Enter ends it; backspace edits it; Ctrl-C (or Ctrl-D on an
 * empty line) cancels. The terminal is put back as it was however it ends.
 */
export function readHidden(input: RawInput, prompt: string, write: (text: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let line = "";
    const finish = (done: () => void) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      write("\n");
      done();
    };
    function onData(chunk: string) {
      for (const char of chunk.replace(ESCAPES, "")) {
        if (char === "\r" || char === "\n") return finish(() => resolve(line));
        if (char === CTRL_C || (char === CTRL_D && line === "")) return finish(() => reject(new CancelledError()));
        if (char === "\u007f" || char === "\b") line = line.slice(0, -1);
        else if (char >= " ") line += char;
      }
    }
    // Raw mode comes before the prompt: a key pasted the instant the prompt shows must not be echoed by the terminal.
    input.setRawMode(true);
    write(prompt);
    input.setEncoding("utf8");
    input.resume();
    input.on("data", onData);
  });
}
