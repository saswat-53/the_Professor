import { spawn } from "node:child_process";
import { join } from "node:path";

const BIN = join(import.meta.dirname, "../../dist/cli.js");

/** Runs the built CLI as a black box; LEARN_BASE_URL and LEARN_MODEL from the outer environment never leak in. */
export function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ stdoutChunks: string[]; stdout: string; stderr: string; code: number | null }>((resolve) => {
    const base = { ...process.env };
    delete base.LEARN_BASE_URL;
    delete base.LEARN_MODEL;
    const child = spawn("node", [BIN, ...args], { env: { ...base, ...env } });
    const stdoutChunks: string[] = [];
    let stderr = "";
    child.stdout.on("data", (d) => stdoutChunks.push(String(d)));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ stdoutChunks, stdout: stdoutChunks.join(""), stderr, code }));
  });
}
