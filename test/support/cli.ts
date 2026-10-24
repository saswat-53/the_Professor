import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const emptyHome = mkdtempSync(join(tmpdir(), "learn-home-"));
const BIN = join(import.meta.dirname, "../../dist/cli.js");

/** Runs the built CLI as a black box; LEARN_BASE_URL and LEARN_MODEL from the outer environment never leak in. Runs from the temp directory by default, so the temp files tests create are inside the project root. */
export function run(args: string[], env: Record<string, string> = {}, cwd: string = tmpdir(), onChild?: (child: ChildProcess) => void) {
  return new Promise<{ stdoutChunks: string[]; stdout: string; stderr: string; code: number | null }>((resolve) => {
    const base = { ...process.env };
    for (const name of Object.keys(base)) if (name.startsWith("LEARN_")) delete base[name];
    delete base.XDG_CONFIG_HOME;
    // An empty home, so the developer's real config file never leaks into a test.
    base.HOME = emptyHome;
    delete base.USERPROFILE;
    const child = spawn("node", [BIN, ...args], { env: { ...base, ...env }, cwd });
    const stdoutChunks: string[] = [];
    let stderr = "";
    child.stdout.on("data", (d) => stdoutChunks.push(String(d)));
    child.stderr.on("data", (d) => (stderr += d));
    onChild?.(child);
    child.on("close", (code) => resolve({ stdoutChunks, stdout: stdoutChunks.join(""), stderr, code }));
  });
}
