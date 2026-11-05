import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "./support/cli.js";

const BIN = join(import.meta.dirname, "../dist/cli.js");
const HELPER = join(import.meta.dirname, "support/pty-script.py");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

let server: Server;
let baseUrl: string;
let file: string;
/** The Authorization header of every request the fake endpoint received, in order. */
let auths: Array<string | undefined>;
/** The JSON body of every request the fake endpoint received, in order. */
let bodies: Array<Record<string, unknown>>;
/** What the fake endpoint does with a request that carries stream_options: accept it, or answer 400 naming it. */
let rejectStreamOptions = false;
/** A fixed failure the fake endpoint answers every request with, instead of streaming. */
/** When set, the fake endpoint ends its stream with a usage chunk reporting these token counts, as an endpoint asked for usage does. */
let reportedUsage: { prompt_tokens: number; completion_tokens: number } | undefined;
let streamMode: "normal" | "mid-stream-error" | "hold" = "normal";
let failWith: { status: number; message: string; headers?: Record<string, string> } | undefined;

const chunk = (delta: object, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      auths.push(req.headers.authorization);
      if (failWith) {
        res.writeHead(failWith.status, { "content-type": "application/json", ...failWith.headers });
        res.end(JSON.stringify({ error: { message: failWith.message } }));
        return;
      }
      if (rejectStreamOptions && body.stream_options !== undefined) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unrecognized request argument supplied: stream_options" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Numbered by request, so a chat test can wait for one particular answer.
      res.write(chunk({ content: `an explanation ${bodies.length}` }));
      // The response stays open, so a test can cancel it: for the whole test, or for one question, "hang".
      const asked = (body.messages as { content: string }[] | undefined)?.at(-1)?.content;
      if (streamMode === "hold" || asked === "hang") return;
      if (streamMode === "mid-stream-error") {
        res.end(`data: ${JSON.stringify({ error: { message: "Unrecognized request argument supplied: stream_options" } })}\n\n`);
        return;
      }
      res.write(chunk({}, "stop"));
      if (reportedUsage) {
        const { prompt_tokens, completion_tokens } = reportedUsage;
        res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens } })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  file = join(await mkdtemp(join(tmpdir(), "learn-usage-")), "sample.ts");
  await writeFile(file, "export const answer = 42;\n");
});

beforeEach(() => {
  bodies = [];
  auths = [];
  rejectStreamOptions = false;
  failWith = undefined;
  streamMode = "normal";
  reportedUsage = undefined;
});

afterAll(() => server.close());

describe("asking the endpoint for streamed usage", () => {
  it("sends stream_options.include_usage on the request, so the endpoint reports tokens", async () => {
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(0);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.stream_options).toEqual({ include_usage: true });
  });
});

describe("an endpoint that rejects stream_options", () => {
  it("is sent the request once more without it, and the answer streams", async () => {
    rejectStreamOptions = true;
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("an explanation");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.stream_options).toEqual({ include_usage: true });
    expect(bodies[1]!.stream_options).toBeUndefined();
  });
});

describe("the note about estimated usage", () => {
  const NOTE = /does not report token usage, so counts are estimated/g;

  it("is one stderr line naming the host only, never the path or the key", async () => {
    rejectStreamOptions = true;
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(0);
    expect(r.stderr.match(NOTE)).toHaveLength(1);
    const host = new URL(baseUrl).host;
    expect(r.stderr).toContain(`${host} does not report token usage`);
    expect(r.stderr).not.toContain(`${host}/v1`);
  });

  it("is not printed when the endpoint accepts the option", async () => {
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.stderr).not.toMatch(NOTE);
  });
});

describe("an endpoint that accepts stream_options but reports no usage", () => {
  it("gets one request, and the answer streams", async () => {
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("an explanation");
    expect(bodies).toHaveLength(1);
  });
});

describe("the retry is only for a rejected stream_options", () => {
  it("retries only once: when the request without stream_options is also answered 400, that is an ordinary provider error", async () => {
    // This endpoint blames stream_options for every request, whether it carries the option or not.
    failWith = { status: 400, message: "Unrecognized request argument supplied: stream_options" };
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/HTTP 400/);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.stream_options).toEqual({ include_usage: true });
    expect(bodies[1]!.stream_options).toBeUndefined();
  });

  it("does not retry an error that arrives after output has streamed", async () => {
    streamMode = "mid-stream-error";
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("an explanation");
    expect(bodies).toHaveLength(1);
  });

  it("does not retry a request that was cancelled", async () => {
    streamMode = "hold";
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" }, undefined, (child) => {
      // Wait for the answer to start (observable output), not a fixed delay, then interrupt.
      child.stdout!.once("data", () => child.kill("SIGINT"));
    });
    expect(r.code).toBe(130);
    expect(bodies).toHaveLength(1);
  });

  it.each([
    ["a 400 about another field", { status: 400, message: "Unrecognized request argument supplied: temperature" }, /HTTP 400/],
    ["a 401", { status: 401, message: "bad key, stream_options" }, /rejected the API key/],
    ["a 429", { status: 429, message: "slow down, stream_options", headers: { "retry-after": "7" } }, /too many requests/],
  ])("does not retry %s", async (_name, failure, message) => {
    failWith = failure;
    const r = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(message);
    expect(bodies).toHaveLength(1);
  });

  it("never prints the API key, whichever way the request goes, while sending it on every request", async () => {
    const key = "sk-canary-0123456789";
    const config = await mkdtemp(join(tmpdir(), "learn-usage-config-"));
    await mkdir(join(config, "learn"));
    await writeFile(join(config, "learn", "config.toml"), '[provider]\nkey_env = "MY_PROVIDER_KEY"\n');
    for (const reject of [false, true]) {
      bodies = [];
      auths = [];
      rejectStreamOptions = reject;
      const r = await run([file, "--show-prompt"], { XDG_CONFIG_HOME: config, LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m", MY_PROVIDER_KEY: key });
      expect(r.code).toBe(0);
      // The key really was in play: every request, the retry included, carried it.
      expect(auths).toEqual(Array(reject ? 2 : 1).fill(`Bearer ${key}`));
      expect(r.stdout + r.stderr).not.toContain(key);
    }
  });
});

describe.skipIf(!hasPython)("a chat on an endpoint that rejects stream_options", () => {
  it("asks without it from the next turn on, instead of being rejected every time", async () => {
    rejectStreamOptions = true;
    const home = await mkdtemp(join(tmpdir(), "learn-usage-home-"));
    const steps: [string, string][] = [
      ["\n> ", "and then?\r"],
      ["an explanation 3", "/exit\r"],
    ];
    const out = await new Promise<string>((resolve, reject) => {
      execFile("python3", ["-I", HELPER, JSON.stringify(steps), "node", BIN, file, "--chat"], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "", TERM: "dumb", NO_COLOR: "1", LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" }, cwd: tmpdir() }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    expect(out).toMatch(/\nexit 0\n$/);
    // One note for the whole chat, not one per turn.
    expect(out.match(/does not report token usage, so counts are estimated/g)).toHaveLength(1);
    // Request 1 is rejected, 2 is the retry, 3 is the follow-up: only the first carries the option.
    expect(bodies.map((b) => b.stream_options)).toEqual([{ include_usage: true }, undefined, undefined]);
  }, 30_000);
});

/** Runs one-shot `learn` on a terminal (a pty), as a person would; the output is everything the terminal showed, ending in `exit <code>`. */
async function onTerminal(args: string[], env: Record<string, string> = {}, steps: [string, string][] = [], cwd: string = tmpdir()): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "learn-usage-home-"));
  return await new Promise((resolve, reject) => {
    execFile("python3", ["-I", HELPER, JSON.stringify(steps), "node", BIN, ...args], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "", TERM: "dumb", NO_COLOR: "1", LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m", ...env }, cwd }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

describe.skipIf(!hasPython)("--usage on a terminal", () => {
  it.each([
    [{ prompt_tokens: 1234, completion_tokens: 340 }, "in 1.2k · out 340 · m"],
    [{ prompt_tokens: 999, completion_tokens: 1000 }, "in 999 · out 1k · m"],
    [{ prompt_tokens: 12_000, completion_tokens: 12_345 }, "in 12k · out 12.3k · m"],
  ])("prints one line of what the endpoint reported (%j)", async (usage, line) => {
    reportedUsage = usage;
    const out = await onTerminal([file, "--usage"]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(out.split("\n").filter((l) => l.includes(" · out "))).toEqual([expect.stringContaining(line)]);
  }, 30_000);

  it("marks the figures with ~ when the endpoint reported nothing", async () => {
    const out = await onTerminal([file, "--usage"]);
    expect(out).toMatch(/in ~\d[\d.]*k? · out ~\d[\d.]*k? · m/);
  }, 30_000);

  it("prints nothing about usage without the flag", async () => {
    reportedUsage = { prompt_tokens: 1234, completion_tokens: 340 };
    const out = await onTerminal([file]);
    expect(out).not.toContain(" · out ");
  }, 30_000);

  it("strips terminal escapes from the model name before showing it", async () => {
    const out = await onTerminal([file, "--usage"], { LEARN_MODEL: "m\u001b[31mred\u001b]0;pwned\u0007" });
    expect(out).toContain(" · out ");
    expect(out).not.toContain("\u001b");
  }, 30_000);
});

describe("--usage off a terminal", () => {
  it("prints nothing extra: plain output stays exactly what it was", async () => {
    reportedUsage = { prompt_tokens: 1234, completion_tokens: 340 };
    const plain = await run([file], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    const withFlag = await run([file, "--usage"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(withFlag.code).toBe(0);
    expect(withFlag.stdout).toBe(plain.stdout.replace(/an explanation 1/, "an explanation 2"));
    expect(withFlag.stderr).not.toContain(" · out ");
  });
});

describe("--usage with --chat", () => {
  it("is refused with exit 2, saying the footer already shows usage, before anything is sent", async () => {
    const r = await run([file, "--chat", "--usage"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("the footer already shows usage");
    expect(r.stdout).toBe("");
    expect(bodies).toEqual([]);
  });

  it("is listed in --help", async () => {
    const r = await run(["--help"]);
    expect(r.stdout + r.stderr).toContain("--usage");
  });
});

describe.skipIf(!hasPython)("the chat footer on a plain terminal", () => {
  it("is printed above the prompt, which is a plain > ", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const project = basename(await realpath(tmpdir()));
    // A wide terminal, so no field is dropped whatever the temporary path is called.
    const out = await onTerminal([file, "--chat"], { PTY_COLS: "200" }, [["\n> ", "/exit\r"]]);
    expect(out).toMatch(/\nexit 0\n$/);
    const footer = new RegExp(`^${project} · learn-usage-\\w+/sample\\.ts · m · intermediate · 1k in/200 out · last 1k/4\\.1k \\(24%\\)\\r?\\n> `, "m");
    expect(out).toMatch(footer);
    expect(out).not.toContain("learn> ");
    // Without colour there is no escape sequence and no rule.
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("─");
  }, 30_000);

  it("is rebuilt before every prompt, so it follows the numbers as the chat goes on", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const out = await onTerminal([file, "--chat"], { PTY_COLS: "200" }, [
      ["\n> ", "and then?\r"],
      ["\n> ", "/exit\r"],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    const footers = out.split("\n").filter((l) => l.includes(" · m · "));
    expect(footers).toHaveLength(2);
    expect(footers[0]).toContain("1k in/200 out");
    expect(footers[1]).toContain("2k in/400 out");
  }, 30_000);
});

describe.skipIf(!hasPython)("the chat footer on a colour terminal", () => {
  const DIM = "\u001b[2m";
  const RESET = "\u001b[0m";
  /** A colour terminal 100 columns wide: not dumb, NO_COLOR unset (set empty, which counts as unset), the owl off so its animation stays out of the way. */
  const colour = { TERM: "xterm-256color", NO_COLOR: "", LEARN_OWL: "off", PTY_COLS: "100" };
  /** On a terminal that is not "dumb", readline puts its own cursor-control codes (column 1, clear below) before the prompt text. */
  const READLINE = "(?:\\u001b\\[\\d*[GJK])*";

  it("prints a dim rule as wide as the terminal, then the footer, then a ❯ prompt", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const out = await onTerminal([file, "--chat"], colour, [["❯ ", "/exit\r"]]);
    expect(out).toMatch(/\nexit 0\n$/);
    const lines = out.split("\r\n");
    const rule = lines.findIndex((l) => l === `${DIM}${"─".repeat(100)}${RESET}`);
    expect(rule).toBeGreaterThan(-1);
    // The footer is the very next line, dim as a whole, and the prompt follows it.
    expect(lines[rule + 1]).toMatch(new RegExp(`^${DIM.replace("[", "\\[")}.* · m · intermediate · 1k in/200 out · ${RESET.replace("[", "\\[")}${DIM.replace("[", "\\[")}last 1k/4\\.1k \\(24%\\)${RESET.replace("[", "\\[")}$`));
    expect(lines[rule + 2]).toMatch(new RegExp(`^${READLINE}❯ `));
    expect(out).not.toMatch(new RegExp(`\\r\\n${READLINE}> `));
  }, 30_000);

  it.each([
    [3000, "\u001b[33m", "last 3k/4.1k (73%)"],
    [3800, "\u001b[31m", "last 3.8k/4.1k (93%)"],
  ])("colours a fill that is getting full: %i tokens of the window", async (tokens, code, fill) => {
    reportedUsage = { prompt_tokens: tokens, completion_tokens: 10 };
    const out = await onTerminal([file, "--chat"], colour, [["❯ ", "/exit\r"]]);
    expect(out).toContain(`${code}${fill}${RESET}`);
  }, 30_000);

  it.each([
    ["NO_COLOR set", { TERM: "xterm-256color", NO_COLOR: "1" }],
    ["TERM=dumb", { TERM: "dumb", NO_COLOR: "" }],
  ])("prints neither the rule nor ❯, and no escape sequence in the footer, with %s", async (_name, env) => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    // Wait on the footer, not the prompt: off "dumb" readline's own cursor codes sit in front of the prompt text.
    const out = await onTerminal([file, "--chat"], { ...colour, ...env }, [["1k in/200 out", "/exit\r"]]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(out).not.toContain("─");
    expect(out).not.toContain("❯");
    const lines = out.split("\r\n");
    const footer = lines.findIndex((l) => l.includes(" · m · "));
    expect(footer).toBeGreaterThan(-1);
    expect(lines[footer]).not.toContain("\u001b");
    // The prompt is the plain > on the next line (after readline's own cursor codes, if the terminal gets any).
    expect(lines[footer + 1]).toMatch(new RegExp(`^${READLINE}> `));
  }, 30_000);
});

describe.skipIf(!hasPython)("the chat footer follows what the chat is asked about", () => {
  /** The footer lines (one per prompt) a chat showed, given what the user typed between prompts. */
  async function footersAfter(questions: string[]): Promise<string[]> {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const steps: [string, string][] = [...questions.map((q): [string, string] => ["\n> ", `${q}\r`]), ["\n> ", "/exit\r"]];
    const out = await onTerminal([file, "--chat"], { PTY_COLS: "200" }, steps);
    expect(out).toMatch(/\nexit 0\n$/);
    return out.split("\n").filter((l) => l.includes(" · m · ")).map((l) => l.replace(/\r$/, ""));
  }
  /** The project-relative name of a file next to sample.ts, as a mention must write it from the working directory. */
  const mention = async (name: string, lines = "") => {
    const dir = dirname(file);
    await writeFile(join(dir, name), "export const one = 1;\nexport const two = 2;\n");
    return { path: `${basename(dir)}/${name}`, text: `@${basename(dir)}/${name}${lines}` };
  };

  it("moves to a file the question mentions with @, with its lines", async () => {
    const other = await mention("other.ts", ":1-2");
    const footers = await footersAfter([`what is in ${other.text}?`]);
    expect(footers).toHaveLength(2);
    expect(footers[0]).toContain(`${basename(dirname(file))}/sample.ts · m ·`);
    expect(footers[1]).toContain(`${other.path}:1-2 · m ·`);
  }, 40_000);

  it("takes the last file when a question mentions several", async () => {
    const first = await mention("first.ts");
    const last = await mention("last.ts");
    const footers = await footersAfter([`compare ${first.text} with ${last.text}`]);
    expect(footers[1]).toContain(`${last.path} · m ·`);
    expect(footers[1]).not.toContain("first.ts");
  }, 40_000);

  it("stays where it was when a mention cannot be attached, since nothing was sent", async () => {
    const footers = await footersAfter(["what is @nope-missing.ts?"]);
    expect(footers).toHaveLength(2);
    expect(footers[1]).toContain(`${basename(dirname(file))}/sample.ts · m ·`);
    // And the failed question counted for nothing: the totals are as they were.
    expect(footers[1]).toContain("1k in/200 out");
  }, 40_000);
});

describe.skipIf(!hasPython)("the chat footer after a cancelled answer", () => {
  it("is printed once, with the tokens the cancelled turn spent counted as an estimate", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const out = await onTerminal([file, "--chat"], { PTY_COLS: "200" }, [
      ["\n> ", "hang\r"],
      ["an explanation 2", "\u0003"],
      // The next prompt can only come after the cancel, and the footer is printed just above it. (Waiting on the "cancelled" message first would be a
      // race: the helper marks its place after everything read so far, so a prompt that arrived in the same read as the message would be skipped.)
      ["\n> ", "/exit\r"],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(out).toContain("cancelled");
    const footers = out.split("\n").filter((l) => l.includes(" · m · ")).map((l) => l.replace(/\r$/, ""));
    // One for the first prompt, one after the cancel: not two after it.
    expect(footers).toHaveLength(2);
    expect(footers[0]).toContain("1k in/200 out");
    // The cancelled turn spent something, and it was never reported: the totals are now estimates, and so is the last request.
    expect(footers[1]).toMatch(/ · ~[\d.]+k? in\/~[\d.]+k? out · last ~[\d.]+k?\/4\.1k \(\d+%\)$/);
  }, 40_000);
});

describe.skipIf(!hasPython)("the chat footer with hostile names and real paths", () => {
  /** Runs a chat from inside `cwd` on a wide, plain terminal and returns the footer line of the first prompt, with everything the terminal showed. */
  async function firstFooter(cwd: string, args: string[]): Promise<{ footer: string; out: string }> {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const out = await onTerminal([...args, "--chat"], { PTY_COLS: "200" }, [["\n> ", "/exit\r"]], cwd);
    expect(out).toMatch(/\nexit 0\n$/);
    const lines = out.split("\r\n");
    const footer = lines.find((l) => l.includes(" · m · intermediate · "));
    expect(footer, "a footer line").toBeDefined();
    return { footer: footer!, out };
  }
  /** A fresh, empty directory to build a project in, by its real path. */
  const parent = async () => await realpath(await mkdtemp(join(tmpdir(), "learn-hostile-")));

  it("cleans a project directory name made of escape sequences and a newline, and nothing else leaks it", async () => {
    const dir = join(await parent(), "proj\u001b[31mred\u001b]0;pwn\u0007\nnewline");
    await mkdir(dir);
    await writeFile(join(dir, "sample.ts"), "export const a = 1;\n");
    const { footer, out } = await firstFooter(dir, ["sample.ts"]);
    expect(footer).toBe("projred newline · sample.ts · m · intermediate · 1k in/200 out · last 1k/4.1k (24%)");
    // Not the footer alone: nothing anywhere on the terminal carries the name's escape sequences.
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
  }, 40_000);

  it("cleans a file name made of escape sequences", async () => {
    const dir = join(await parent(), "project");
    await mkdir(dir);
    const name = "a\u001b[31m\u001b]0;pwn\u0007b.ts";
    await writeFile(join(dir, name), "export const a = 1;\n");
    const { footer } = await firstFooter(dir, [name]);
    expect(footer).toBe("project · ab.ts · m · intermediate · 1k in/200 out · last 1k/4.1k (24%)");
  }, 40_000);

  it("never shows the --root value: the project is its directory's name, and the file is relative to it, whether --root was typed absolute or relative", async () => {
    const dir = join(await parent(), "project");
    const sub = join(dir, "sub");
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, "file.ts"), "export const a = 1;\n");
    for (const root of [dir, ".."]) {
      const { footer } = await firstFooter(sub, ["--root", root, "file.ts"]);
      expect(footer, root).toMatch(/^project · sub\/file\.ts · m · /);
      expect(footer, root).not.toContain(dirname(dir));
      expect(footer, root).not.toContain("..");
    }
  }, 60_000);

  it("never shows an absolute path: the project is its directory's name, the file is relative to it, whether it was reached through a symlink or not", async () => {
    const root = await parent();
    const dir = join(root, "project");
    await mkdir(dir);
    await writeFile(join(dir, "real.ts"), "export const a = 1;\n");
    await symlink("real.ts", join(dir, "link.ts"));
    for (const target of ["real.ts", "link.ts", join(dir, "real.ts")]) {
      const { footer } = await firstFooter(dir, [target]);
      // A symlink is shown as the file it points to (core resolves links to their real path), never as the link.
      expect(footer, target).toMatch(/^project · real\.ts · m · /);
      expect(footer, target).not.toContain(root);
      expect(footer, target).not.toContain(tmpdir());
      expect(footer, target).not.toContain(homedir());
    }
  }, 60_000);
});

describe.skipIf(!hasPython)("the chat footer when the terminal is resized", () => {
  it("is built for the width the terminal has when each prompt is printed, narrower or wider than before", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const out = await onTerminal([file, "--chat"], { PTY_COLS: "200" }, [
      ["\n> ", "resize:50"],
      // An empty wait fires at once, on the helper's next turn: the resize makes no output of its own to wait for.
      ["", "and then?\r"],
      ["\n> ", "resize:200"],
      ["", "and again?\r"],
      ["\n> ", "/exit\r"],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    const footers = out.split("\r\n").filter((l) => /\d+k? in\/\d+ out/.test(l) && !l.includes("--usage"));
    expect(footers).toHaveLength(3);
    // 200 columns: everything. 50 columns: no room for the project, the level or the path, so the model, the tokens and the fill. 200 again: everything.
    expect(footers[0]).toMatch(/^\S+ · learn-usage-\w+\/sample\.ts · m · intermediate · 1k in\/200 out · last 1k\/4\.1k \(24%\)$/);
    expect(footers[1]).toBe("m · 2k in/400 out · last 1k/4.1k (24%)");
    expect(footers[2]).toMatch(/^\S+ · learn-usage-\w+\/sample\.ts · m · intermediate · 3k in\/600 out · last 1k\/4\.1k \(24%\)$/);
  }, 40_000);
});

describe.skipIf(!hasPython)("the chat footer for a bare word", () => {
  /** A small git repository to run in, so the word search covers a few files and not a whole temporary directory. */
  async function repo(): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "learn-word-chat-")));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/util.ts"), ["import x from 'x';", "", "// debounce is defined below", "export function debounce(fn: () => void, ms: number) {", "  let t: any;", "  return () => {", "    clearTimeout(t);", "    t = setTimeout(fn, ms);", "  };", "}", ""].join("\n"));
    await writeFile(join(dir, "src/use.ts"), "import { debounce } from './util';\ndebounce(() => 1, 3);\n");
    return dir;
  }
  const footers = (out: string) => out.split("\r\n").filter((l) => /\d+k? in\/\d+ out/.test(l));

  it("shows the definition a word question resolved to, for @word in a follow-up", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const dir = await repo();
    const out = await onTerminal(["src/use.ts", "--chat"], { PTY_COLS: "200" }, [
      ["\n> ", "what does @debounce do?\r"],
      ["\n> ", "/exit\r"],
    ], dir);
    expect(out).toMatch(/\nexit 0\n$/);
    const lines = footers(out);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(" · src/use.ts · m · ");
    expect(lines[1]).toContain(" · src/util.ts:4-10 · m · ");
  }, 40_000);

  it("shows it from the start, when the first thing explained is the word", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const dir = await repo();
    const out = await onTerminal(["debounce", "--chat"], { PTY_COLS: "200" }, [["\n> ", "/exit\r"]], dir);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(footers(out)[0]).toContain(" · src/util.ts:4-10 · m · ");
  }, 40_000);
});

describe.skipIf(!hasPython)("the chat footer with the owl pinned to the top (LEARN_OWL=pinned)", () => {
  const DIM = "\u001b[2m";
  const RESET = "\u001b[0m";
  /** What it takes for the owl to animate: a colour terminal of at least 20 rows (the helper's are 24) and 50 columns, and LEARN_OWL=pinned. */
  const withOwl = { TERM: "xterm-256color", NO_COLOR: "", COLORTERM: "truecolor", LEARN_OWL: "pinned", PTY_COLS: "100" };

  it("is printed whole inside the scrolling area below the owl, with none of the owl's cursor moves inside it", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const out = await onTerminal([file, "--chat"], withOwl, [["❯ ", "/exit\r"]]);
    expect(out).toMatch(/\nexit 0\n$/);
    // The owl really was on: it claimed the rows below its 8-row header as the scrolling area (24 rows), and handed the terminal back at the end.
    const region = out.indexOf("\u001b[9;24r");
    expect(region, "the owl's scroll region").toBeGreaterThan(-1);
    // The rule, the footer and the prompt follow each other in the stream, with only the footer's own colour codes inside them.
    const escaped = (text: string) => text.replace(/[[\]().*+?^${}|\\]/g, "\\$&");
    const [dim, reset] = [escaped(DIM), escaped(RESET)];
    const header = new RegExp(`${dim}${"─".repeat(100)}${reset}\\r\\n${dim}[^\\u001b]* · m · intermediate · 1k in/200 out · ${reset}${dim}last 1k/4\\.1k \\(24%\\)${reset}\\r\\n`);
    const found = header.exec(out);
    expect(found, "the rule and the footer, uninterrupted").not.toBeNull();
    // It is drawn in the scrolling area, after the owl set it up, and the terminal is handed back after it.
    expect(found!.index).toBeGreaterThan(region);
    expect(out.lastIndexOf("\u001b[r")).toBeGreaterThan(found!.index);
  }, 40_000);

  it("scrolls back through the chat with PageUp and PageDown while the owl stays pinned, and returns on End", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const PAGE_UP = "\u001b[5~";
    const PAGE_DOWN = "\u001b[6~";
    const END = "\u001b[F";
    // Enough exchanges to push the first explanation off the 16-row scrolling area, then back two pages, one forward, and End.
    const asks: [string, string][] = ["one", "two", "three", "four", "five", "six"].map((q) => ["intermediate", `${q}\r`]);
    const out = await onTerminal([file, "--chat"], withOwl, [
      ...asks,
      ["intermediate", PAGE_UP],
      ["scrolled back", PAGE_UP],
      ["scrolled back", PAGE_DOWN],
      ["scrolled back", END],
      ["intermediate", "/exit\r"],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    const firstView = out.indexOf("scrolled back");
    expect(firstView, "the history page's status row").toBeGreaterThan(-1);
    // Two pages back reaches the very first explanation, which had long scrolled out of the area.
    expect(out.slice(firstView)).toContain("an explanation 1");
    // The keys were taken, not typed: the line the reader types into stays empty, so the exit command is the only thing ever submitted.
    expect(out).not.toContain("[5~");
    expect(out).not.toContain("[6~");
    // The owl was never drawn over the history page: its rows are 1-8 and the page starts at row 9.
    const afterView = out.slice(firstView);
    expect(afterView).not.toMatch(/\u001b\[[1-8];1H(?!\u001b)[^\u001b]*scrolled back/);
    // End brought the live view back: the footer is painted again after the last status row.
    expect(out.lastIndexOf("intermediate")).toBeGreaterThan(out.lastIndexOf("scrolled back"));
  }, 60_000);

  const WHEEL_UP = "\u001b[<64;10;10M";
  const WHEEL_DOWN = "\u001b[<65;10;10M";
  const asks = (): [string, string][] => ["one", "two", "three", "four", "five", "six"].map((q) => ["intermediate", `${q}\r`]);

  it("scrolls with the mouse wheel or trackpad, takes the mouse only while the chat runs, and never types the reports", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const out = await onTerminal([file, "--chat"], withOwl, [
      ...asks(),
      ["intermediate", WHEEL_UP.repeat(14)],
      ["scrolled back", WHEEL_DOWN.repeat(14)],
      ["intermediate", "/exit\r"],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    const firstView = out.indexOf("scrolled back");
    expect(firstView, "the history page's status row").toBeGreaterThan(-1);
    // Fourteen notches of three lines reach the first explanation.
    expect(out.slice(firstView)).toContain("an explanation 1");
    // Mouse reporting was asked for when the chat started and handed back at the end, after everything else.
    expect(out.indexOf("\u001b[?1000h")).toBeGreaterThan(-1);
    expect(out.lastIndexOf("\u001b[?1000l")).toBeGreaterThan(out.lastIndexOf("an explanation 7"));
    // The reports were taken, not typed into the line.
    expect(out).not.toContain("<64;");
    expect(out).not.toContain("<65;");
    // Wheeling back down returned to the live view.
    expect(out.lastIndexOf("intermediate")).toBeGreaterThan(out.lastIndexOf("scrolled back"));
  }, 60_000);

  it("moves one line at a time with the arrow keys while scrolled back, and an arrow key still recalls earlier questions at the live view", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const UP = "\u001b[A";
    const DOWN = "\u001b[B";
    const out = await onTerminal([file, "--chat"], withOwl, [
      ...asks(),
      ["intermediate", "\u001b[5~"],
      ["scrolled back", UP],
      ["scrolled back", UP],
      ["scrolled back", DOWN],
      ["scrolled back", "\u001b[F"],
      ["intermediate", "/exit\r"],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    // One page back, then up two lines (the status row says 14 + 1 + 1 below), then down one (15 below).
    const notes = [...out.matchAll(/scrolled back · (\d+) lines? below/g)].map((m) => Number(m[1]));
    expect(notes.slice(0, 4)).toEqual([14, 15, 16, 15]);
  }, 60_000);

  it("LEARN_MOUSE=off leaves the mouse alone, so the terminal's own selection works", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const out = await onTerminal([file, "--chat"], { ...withOwl, LEARN_MOUSE: "off" }, [["intermediate", "/exit\r"]]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(out).not.toContain("\u001b[?1000h");
  }, 40_000);
});

describe.skipIf(!hasPython)("the owl in the conversation (the default)", () => {
  const inline = { TERM: "xterm-256color", NO_COLOR: "", COLORTERM: "truecolor", LEARN_OWL: "", PTY_COLS: "100" };

  it("reserves nothing on the screen: no scroll region and no mouse capture, so the terminal scrolls and selects as usual", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const out = await onTerminal([file, "--chat"], inline, [["❯ ", "hello\r"], ["intermediate", "/exit\r"]]);
    expect(out).toMatch(/\nexit 0\n$/);
    // The owl was drawn at the top rows, with its words, and the chat ran as ordinary output below it.
    expect(out).toContain("\u001b[1;1H");
    expect(out).toContain("Professor");
    expect(out).not.toMatch(/\u001b\[\d*;?\d*r/);
    expect(out).not.toContain("\u001b[?1000h");
    expect(out).not.toMatch(/scrolled back/);
    // The footer and the answers are in the output as normal text.
    expect(out).toContain("an explanation 2");
    expect(out).toContain("intermediate");
  }, 40_000);

  it("/clear wipes the screen and its saved lines, and the owl is drawn again and animates", async () => {
    reportedUsage = { prompt_tokens: 1000, completion_tokens: 200 };
    const out = await onTerminal([file, "--chat"], inline, [["❯ ", "hello\r"], ["intermediate", "/clear\r"], ["Cleared", "/exit\r"]]);
    expect(out).toMatch(/\nexit 0\n$/);
    const wipe = out.indexOf("\u001b[3J\u001b[2J\u001b[H");
    expect(wipe, "the erase sequence").toBeGreaterThan(-1);
    // The owl is drawn at the top again after the wipe, with its words, and the fresh-chat note follows.
    const after = out.slice(wipe);
    expect(after).toContain("\u001b[1;1H");
    expect(after).toContain("Professor");
    expect(after).toContain("Cleared.");
    // Nothing is left to scroll back to: the footer printed before the wipe is not printed again after it.
    expect(after).not.toContain("an explanation 2");
  }, 40_000);
});
