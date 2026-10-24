// The child of stall.mjs: writes to stdout until the pipe pushes back, then keeps its event loop visibly alive.
process.on("SIGINT", () => {
  console.error("child: SIGINT handler ran");
  process.exit(130);
});
const chunk = "x".repeat(64 * 1024);
let writes = 0;
while (process.stdout.write(chunk)) writes++;
console.error(`child: write() returned false after ${writes + 1} writes (${((writes + 1) * 64) / 1024} MB queued or sent)`);
let ticks = 0;
setInterval(() => console.error(`child: tick ${++ticks}`), 200);
