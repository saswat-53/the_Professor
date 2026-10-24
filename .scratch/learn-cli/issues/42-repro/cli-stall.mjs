// Repro 2, the real CLI: the scenario of the stall test in test/cli-cancel.test.ts, with a log of every stage.
// usage: node cli-stall.mjs <path to dist/cli.js> <file to explain> <root>
import { createServer } from "node:http";
import { spawn } from "node:child_process";
const [bin, file, root] = process.argv.slice(2);
const t0 = Date.now();
const log = (...a) => console.log(String(Date.now() - t0).padStart(6), ...a);
log(`node ${process.version} on ${process.platform}`);
const chunk = (c) => ({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content: c }, finish_reason: null }] });
let accepted = 0;
let child;
const server = createServer((req, res) => {
  req.resume();
  log("server: request received");
  res.on("close", () => log("server: connection closed"));
  res.writeHead(200, { "content-type": "text/event-stream" });
  const filler = "x".repeat(64 * 1024);
  for (let i = 0; i < 128; i++) res.write(`data: ${JSON.stringify(chunk(filler))}\n\n`, () => { if (++accepted === 128) log("server: all 8 MB accepted by the CLI"); });
});
server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  child = spawn("node", [bin, file, "--root", root], { env: { ...process.env, LEARN_BASE_URL: `http://127.0.0.1:${port}/v1`, LEARN_MODEL: "m" } });
  let read = 0, stopped = false;
  child.stderr.on("data", (d) => log("cli stderr:", String(d).trim().slice(0, 100).replace(/\n/g, " | ")));
  child.stdout.on("data", (d) => {
    read += d.length;
    if (read >= 1048576 && !stopped) { stopped = true; child.stdout.pause(); log(`reader: stopped reading after ${read} bytes`); go(); }
  });
  child.on("exit", (code, sig) => { log(`cli exited: code=${code} signal=${sig}`); finish(); });
  setTimeout(() => { if (!stopped) { log(`RESULT: reader never reached 1 MB (read ${read} bytes): the stall was never established`); child.kill("SIGKILL"); finish(); } }, 15000);
});
let done = false;
const finish = () => { if (done) return; done = true; server.closeAllConnections(); server.close(); setTimeout(() => process.exit(0), 100); };
async function go() {
  await new Promise((r) => setTimeout(r, 1500));
  log(`state before SIGINT: accepted=${accepted}/128 exited=${child.exitCode !== null}`);
  log("sending first SIGINT");
  child.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 2000));
  if (child.exitCode !== null || child.signalCode) return log("RESULT: exited after the first SIGINT");
  log("still alive 2 s after the first SIGINT; sending the second");
  child.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 2000));
  if (child.exitCode !== null || child.signalCode) return log("RESULT: exited after the second SIGINT");
  log("RESULT: HUNG, alive 2 s after the second SIGINT; sending SIGKILL");
  child.kill("SIGKILL");
}
