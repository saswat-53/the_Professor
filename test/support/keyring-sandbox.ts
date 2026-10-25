import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/** A stand-in for @napi-rs/keyring: same `Entry` shape, entries kept in the JSON file named by FAKE_KEYRING_FILE, or every call failing like a machine without a keyring. */
const FAKE_KEYRING = `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const file = () => process.env.FAKE_KEYRING_FILE;
const load = () => (existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {});
const check = () => {
  if (process.env.FAKE_KEYRING_BROKEN) throw new Error("The Secret Service is not running");
};
export class Entry {
  constructor(service, user) {
    this.id = service + "|" + user;
  }
  getPassword() {
    check();
    return load()[this.id] ?? null;
  }
  setPassword(password) {
    check();
    writeFileSync(file(), JSON.stringify({ ...load(), [this.id]: password }));
  }
}
`;

/**
 * The built CLI copied next to its own node_modules, so which keyring it can find is up to the test: the real
 * dependencies are linked in, and @napi-rs/keyring is a working fake, a broken fake, or simply not there (an install that skipped the optional dependency).
 * Nothing in the shipped code changes for this; module resolution does the work.
 */
export async function keyringSandbox(keyring: "working" | "broken" | "absent") {
  const dir = await mkdtemp(join(tmpdir(), "learn-keyring-"));
  await copyFile(join(ROOT, "dist/cli.js"), join(dir, "cli.js"));
  await mkdir(join(dir, "node_modules"));
  for (const name of await readdir(join(ROOT, "node_modules"))) {
    if (name !== "@napi-rs") await symlink(join(ROOT, "node_modules", name), join(dir, "node_modules", name));
  }
  if (keyring !== "absent") {
    const pkg = join(dir, "node_modules/@napi-rs/keyring");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "@napi-rs/keyring", type: "module", main: "index.js", exports: "./index.js" }));
    await writeFile(join(pkg, "index.js"), FAKE_KEYRING);
  }
  const bin = join(dir, "cli.js");
  const storeFile = join(dir, "keyring.json");
  const env: Record<string, string> = { FAKE_KEYRING_FILE: storeFile, ...(keyring === "broken" ? { FAKE_KEYRING_BROKEN: "1" } : {}) };
  const home = await mkdtemp(join(tmpdir(), "learn-home-"));
  /** Runs the sandboxed CLI with `input` on standard input; LEARN_* from the outer environment never leaks in. */
  const run = (args: string[], extraEnv: Record<string, string> = {}, input = "") =>
    new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
      const base = { ...process.env };
      for (const name of Object.keys(base)) if (name.startsWith("LEARN_")) delete base[name];
      delete base.XDG_CONFIG_HOME;
      const child = spawn("node", [bin, ...args], { env: { ...base, HOME: home, ...env, ...extraEnv }, cwd: dir });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.stdin.end(input);
      child.on("close", (code) => resolve({ stdout, stderr, code }));
    });
  const stored = async (): Promise<Record<string, string>> => JSON.parse(await readFile(storeFile, "utf8").catch(() => "{}"));
  return { dir, bin, home, env, run, stored };
}
