// Repro 1, no learn code at all: does a Node process whose stdout reader has stalled still run its SIGINT handler?
import { spawn } from "node:child_process";
const t0 = Date.now();
const log = (...a) => console.log(String(Date.now() - t0).padStart(6), ...a);
log(`node ${process.version} on ${process.platform}`);
const child = spawn("node", [new URL("./pump.mjs", import.meta.url).pathname], { stdio: ["ignore", "pipe", "pipe"] });
// stdout is deliberately never read.
let ticks = 0;
let sentAt = 0;
child.stderr.on("data", (d) => {
  for (const line of String(d).split("\n").filter(Boolean)) {
    log(line);
    if (line.includes("tick")) ticks++;
  }
});
child.on("exit", (code, sig) => {
  log(`child exited: code=${code} signal=${sig}; ${sentAt ? `${Date.now() - sentAt} ms after SIGINT` : "before SIGINT"}`);
  log(code === 130 ? "RESULT: handler ran and the process exited" : "RESULT: other exit");
  process.exit(0);
});
const waitFor = async (ok, ms) => { const end = Date.now() + ms; while (Date.now() < end && !ok()) await new Promise((r) => setTimeout(r, 50)); return ok(); };
if (!(await waitFor(() => child.stderr.readableLength >= 0 && ticks >= 2, 10000))) {
  log("no ticks: the child's event loop is blocked (or it never stalled)");
}
sentAt = Date.now();
log("sending SIGINT");
child.kill("SIGINT");
setTimeout(() => { log("RESULT: HUNG, no exit 4 s after SIGINT; sending SIGKILL"); child.kill("SIGKILL"); }, 4000);
