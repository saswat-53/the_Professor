import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "./support/cli.js";

const BIN = join(import.meta.dirname, "../dist/cli.js");
const HELPER = join(import.meta.dirname, "support/pty-script.py");
const STDERR_PTY = join(import.meta.dirname, "support/stderr-pty.py");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

/** Text that tries to change the terminal's window title when it is shown raw: OSC 0, then BEL. Each place a name can come from gets its own title text, so a leak says where. */
const osc = (title: string) => `\u001b]0;${title}\u0007`;
const HOSTILE_FILE = `a\u001b[31m${osc("pwnNAME")}b.ts`;

let server: Server;
let baseUrl: string;
let project: string;
/** The JSON body of every request the fake endpoint received. */
let bodies: { messages: { role: string; content: string }[] }[] = [];
/** When set, the fake model's answers carry a title-changing sequence, as a hostile model's could. */
let hostileAnswer = false;

const chunk = (delta: object, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(chunk({ content: hostileAnswer ? `answer ${osc("pwnANSWER")} done` : "ok" }));
      res.write(chunk({}, "stop"));
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  // A small git repository with a hostile file name, a hostile name that defines the same word as a plain one, and a change to the hostile file.
  project = await realpath(await mkdtemp(join(tmpdir(), "learn-untrusted-")));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args], { cwd: project });
  git("init", "-q");
  await mkdir(join(project, "src"));
  await writeFile(join(project, HOSTILE_FILE), "export const a = 1;\n");
  await writeFile(join(project, "src/util.ts"), "export function wordy() { return 1; }\n");
  await writeFile(join(project, `src/other${osc("pwnWORD")}.ts`), "export function wordy() { return 2; }\n");
  await writeFile(join(project, "src/plain.ts"), `export const p = 1; // ${osc("pwnCONTENT")}\n`);
  git("add", "-A");
  git("commit", "-qm", `base ${osc("pwnMSG")}`);
  await writeFile(join(project, HOSTILE_FILE), "export const a = 2;\n");
});

afterAll(() => server.close());

beforeEach(() => {
  bodies = [];
  hostileAnswer = false;
});

/** Runs `learn` in the project on a terminal: stdout and stderr are both a pty. Returns everything the terminal showed. */
async function onTerminal(args: string[], env: Record<string, string> = {}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "learn-untrusted-home-"));
  return await new Promise((resolve, reject) => {
    execFile("python3", ["-I", HELPER, "[]", "node", BIN, ...args], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "", TERM: "dumb", NO_COLOR: "1", LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m", ...env }, cwd: project }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** After a run on a terminal nothing may have got through that could act on it: no escape byte, no BEL (this terminal is "dumb" with no colour, so the tool adds none of its own), and none of the text the sequences carried. */
const harmless = (out: string) => {
  expect(out).not.toContain("\u001b");
  expect(out).not.toContain("\u0007");
  expect(out).not.toContain("pwn");
};

describe.skipIf(!hasPython)("status text on a terminal is cleaned of escape sequences", () => {
  it("the Context report: a file's name", async () => {
    const out = await onTerminal([HOSTILE_FILE]);
    harmless(out);
    expect(out).toContain("ab.ts");
  }, 40_000);

  it("an error: a name typed for a file that does not exist", async () => {
    const out = await onTerminal([`nope${osc("pwnERR")}.ts`]);
    harmless(out);
    expect(out).toContain("nope.ts");
  }, 40_000);

  it("--diff: the names of the changed files", async () => {
    const out = await onTerminal(["--diff"]);
    harmless(out);
    expect(out).toContain("ab.ts");
  }, 40_000);

  it("--blame: the name of the file", async () => {
    const out = await onTerminal(["--blame", `${HOSTILE_FILE}:1-1`]);
    harmless(out);
    expect(out).toContain("ab.ts");
  }, 40_000);

  it("a bare word: the names of the other files that define it", async () => {
    const out = await onTerminal(["wordy"]);
    harmless(out);
    expect(out).toContain("src/other.ts");
  }, 40_000);
});

/** Runs `learn` in the project with stdout on a pipe and only stderr on a terminal, as in `learn file | less`. */
async function stderrOnTerminal(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  const home = await mkdtemp(join(tmpdir(), "learn-untrusted-home-"));
  return await new Promise((resolve, reject) => {
    execFile("python3", ["-I", STDERR_PTY, "node", BIN, ...args], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "", TERM: "dumb", NO_COLOR: "1", LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m", ...env }, cwd: project }, (err, stdout) => (err ? reject(err) : resolve(JSON.parse(stdout))));
  });
}

describe.skipIf(!hasPython)("which stream decides", () => {
  it("cleans stderr when only stderr is a terminal (the `| less` case), and leaves the piped stdout alone", async () => {
    const r = await stderrOnTerminal([HOSTILE_FILE]);
    expect(r.code).toBe(0);
    harmless(r.stderr);
    expect(r.stderr).toContain("ab.ts");
    expect(r.stdout).toBe("ok\n");
  }, 40_000);

  it("leaves the bytes exactly as they were when stderr is redirected, so a log keeps the truth", async () => {
    const r = await run([HOSTILE_FILE], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" }, project);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(HOSTILE_FILE);
  });
});

describe.skipIf(!hasPython)("colour and cleaning together", () => {
  it("keeps the tool's own colour on a status line while removing the hostile sequence from its text", async () => {
    const out = await onTerminal([HOSTILE_FILE], { TERM: "xterm-256color", NO_COLOR: "" });
    // The tool's dim colour is still there, and the title-changing sequence and its text are gone.
    expect(out).toContain("\u001b[2m");
    expect(out).not.toContain("\u001b]");
    expect(out).not.toContain("\u0007");
    expect(out).not.toContain("pwn");
    expect(out).toContain("ab.ts");
  }, 40_000);
});

describe.skipIf(!hasPython)("the request that --dry-run and --show-prompt print", () => {
  const VISIBLE_CONTENT = "␛]0;pwnCONTENT␇";

  it("shows a file's escape sequences as pictures on a terminal, and sends nothing in --dry-run", async () => {
    const out = await onTerminal(["src/plain.ts", "--dry-run"]);
    expect(out).toContain(VISIBLE_CONTENT);
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
    expect(bodies).toEqual([]);
  }, 40_000);

  it("shows it as pictures with --show-prompt too, and the model still receives the real bytes", async () => {
    const out = await onTerminal(["src/plain.ts", "--show-prompt"]);
    expect(out).toContain(VISIBLE_CONTENT);
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
    // What is shown is a picture of what is sent, not a changed request: the body the endpoint got holds the raw sequence.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.messages.at(-1)!.content).toContain(osc("pwnCONTENT"));
  }, 40_000);

  it("shows the file name, the diff and a commit message as pictures too", async () => {
    const out = await onTerminal(["--blame", `${HOSTILE_FILE}:1-1`, "--dry-run"]);
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
    expect(out).toContain("␛]0;pwnNAME␇");
    expect(out).toContain("␛]0;pwnMSG␇");
  }, 40_000);

  it("leaves the request exactly as it is when stderr is redirected, so a saved log is the real request", async () => {
    const r = await run(["src/plain.ts", "--dry-run"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" }, project);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(osc("pwnCONTENT"));
    expect(r.stderr).not.toContain("␛");
  });

  it("in a chat, shows an earlier answer from the model as pictures when it is printed again with the next request", async () => {
    hostileAnswer = true;
    const home = await mkdtemp(join(tmpdir(), "learn-untrusted-home-"));
    const steps: [string, string][] = [
      ["\n> ", "and then?\r"],
      ["\n> ", "/exit\r"],
    ];
    const out = await new Promise<string>((resolve, reject) => {
      execFile("python3", ["-I", HELPER, JSON.stringify(steps), "node", BIN, "src/plain.ts", "--chat", "--show-prompt"], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "", TERM: "dumb", NO_COLOR: "1", LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" }, cwd: project }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    expect(out).toMatch(/\nexit 0\n$/);
    // The answer reached stdout cleaned, as before; the second request printed it again among the earlier turns, now as pictures.
    expect(out).toContain("␛]0;pwnANSWER␇");
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
    expect(bodies).toHaveLength(2);
  }, 60_000);
});

