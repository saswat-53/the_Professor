import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Vitest global setup: builds the CLI once before any test file starts. The CLI tests run the
 * built `dist/cli.js`, and the build cleans `dist/`, so building from inside each file would let
 * parallel files delete the binary out from under one another.
 */
export default function build() {
  execFileSync("npm", ["run", "build"], { cwd: join(import.meta.dirname, "../.."), stdio: "ignore" });
}
