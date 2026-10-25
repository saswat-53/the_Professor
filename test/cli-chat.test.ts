import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "./support/cli.js";

const BIN = join(import.meta.dirname, "../dist/cli.js");
const HELPER = join(import.meta.dirname, "support/pty-script.py");
const ENTER = "\r";
const hasPython = spawnSync("python3", ["--version"]).status === 0;

type Body = { messages: { role: string; content: string }[] };
let server: Server;
let baseUrl: string;
let bodies: Body[];
let release: () => void;
let released: Promise<void>;
let auths: (string | undefined)[];
let dir: string;
let file: string;

const chunk = (content: string) => ({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] });

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/release") {
      release();
      res.end("released");
      return;
    }
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw) as Body;
      bodies.push(body);
      auths.push(req.headers.authorization);
      const last = body.messages.at(-1)!.content;
      if (last === "badkey") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `bad key ${req.headers.authorization}` } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify(chunk(`ANSWER${bodies.length}`))}\n\n`);
      // A question of "hang" leaves the response open, so a test can cancel it.
      if (last === "hang") return;
      if (last === "slow") {
        // Held open until the test asks for the release, which it does after the paste has been typed.
        void released.then(() => {
          res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
          res.end("data: [DONE]\n\n");
        });
        return;
      }
      res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  dir = await mkdtemp(join(tmpdir(), "learn-chat-"));
  file = join(dir, "a.ts");
  await writeFile(file, "export const a = 1;\n");
});
afterAll(() => server.close());
beforeEach(() => {
  bodies = [];
  auths = [];
  released = new Promise((r) => (release = r));
});

/** Types `steps` into `learn <file> --chat` on a pseudo-terminal. */
async function chat(steps: [string, string][], extraEnv: Record<string, string> = {}, target = file): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "learn-chat-home-"));
  return await new Promise((resolve, reject) => {
    execFile("python3", ["-I", HELPER, JSON.stringify(steps), "node", BIN, target, "--chat"], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "", TERM: "dumb", NO_COLOR: "1", LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m", ...extraEnv }, cwd: dir }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

describe("learn --chat without a terminal", () => {
  it("refuses with exit 2 and a message, and sends no request", async () => {
    const r = await run([file, "--chat"], { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m" }, dir, undefined, "ignored\n");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("needs a terminal");
    expect(r.stdout).toBe("");
    expect(bodies).toEqual([]);
  });
});

describe.skipIf(!hasPython)("learn --chat on a terminal", () => {
  it("answers follow-ups that remember the earlier turns, and writes nothing to disk", async () => {
    const before = await readdir(dir);
    const out = await chat([
      ["learn> ", `why is it 1?${ENTER}`],
      ["ANSWER2", `and then?${ENTER}`],
      ["ANSWER3", `/exit${ENTER}`],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]!.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user"]);
    expect(bodies[2]!.messages[1]!.content).toContain("export const a = 1;");
    expect(bodies[2]!.messages[2]!.content).toBe("ANSWER1");
    expect(bodies[2]!.messages[3]!.content).toBe("why is it 1?");
    expect(bodies[2]!.messages[4]!.content).toBe("ANSWER2");
    expect(bodies[2]!.messages[5]!.content).toBe("and then?");
    expect(await readdir(dir)).toEqual(before);
  }, 30_000);

  it("takes pasted code between <<< and >>> as one message", async () => {
    const out = await chat([
      ["learn> ", `<<<${ENTER}`],
      ["...", `const b = 2;${ENTER}`],
      ["...", `const c = 3;${ENTER}`],
      ["...", `>>>${ENTER}`],
      ["ANSWER2", `/exit${ENTER}`],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(bodies[1]!.messages.at(-1)!.content).toBe("const b = 2;\nconst c = 3;");
  }, 30_000);

  it("attaches an @file to the question, shows it in a Context report, and remembers it", async () => {
    await writeFile(join(dir, "b.ts"), "export const bee = 'BEE_MARKER';\n");
    const out = await chat([
      ["learn> ", `what is @b.ts for? me@example.com${ENTER}`],
      ["ANSWER2", `and?${ENTER}`],
      ["ANSWER3", `/exit${ENTER}`],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(out).toContain("Context report");
    expect(out).toContain("b.ts");
    expect(bodies[1]!.messages.at(-1)!.content).toContain("what is @b.ts for? me@example.com");
    expect(bodies[1]!.messages.at(-1)!.content).toContain("BEE_MARKER");
    expect(bodies[2]!.messages.map((m) => m.content).join("\n")).toContain("BEE_MARKER");
  }, 30_000);

  it("shows an inline error for a missing file or one outside the project root, and does not send the message", async () => {
    const outside = join(tmpdir(), `learn-outside-${process.pid}.ts`);
    await writeFile(outside, "export const OUTSIDE_MARKER = 1;\n");
    const out = await chat([
      ["learn> ", `explain @nope.ts${ENTER}`],
      ["not sent", `read @../${outside.split("/").pop()}${ENTER}`],
      ["outside the project root", `/exit${ENTER}`],
    ]);
    expect(out).toContain("nope.ts: no such file");
    expect(out).toContain("your message was not sent");
    expect(out).not.toContain("OUTSIDE_MARKER");
    expect(bodies).toHaveLength(1);
  }, 30_000);

  it("refuses a Sensitive file on a hosted endpoint inline, and no request carries it", async () => {
    await writeFile(join(dir, ".env"), "TOKEN=SHHH_MARKER\n");
    const xdg = await mkdtemp(join(tmpdir(), "learn-xdg-"));
    await mkdir(join(xdg, "learn"));
    await writeFile(join(xdg, "learn", "config.toml"), '[provider]\nkey_env = "KEY_VAR"\n');
    // 127.1 is the local machine but not one of the spellings learn treats as local, so this is a hosted endpoint: the file check applies.
    const hosted = baseUrl.replace("127.0.0.1", "127.1");
    const out = await chat(
      [
        ["learn> ", `read @.env${ENTER}`],
        ["not sent", `and @.env:1${ENTER}`],
        ["not sent", `/exit${ENTER}`],
      ],
      { LEARN_BASE_URL: hosted, KEY_VAR: "sk-test", XDG_CONFIG_HOME: xdg },
    );
    expect(out).toContain("refused: .env");
    expect(out).toContain("your message was not sent");
    expect(out).not.toContain("SHHH_MARKER");
    // Only the first explanation of a.ts reached the server.
    expect(bodies).toHaveLength(1);
    expect(JSON.stringify(bodies)).not.toContain("SHHH_MARKER");
  }, 30_000);

  it("warns once that the root is the home directory, however many files are attached", async () => {
    const out = await chat(
      [
        ["learn> ", `@a.ts and @b.ts${ENTER}`],
        ["ANSWER2", `@a.ts:1${ENTER}`],
        ["ANSWER3", `/exit${ENTER}`],
      ],
      { HOME: dir },
    );
    expect(out.match(/the project root is your home directory/g)).toHaveLength(1);
  }, 30_000);

  it("Ctrl-C during a response cancels only that response; the chat goes on", async () => {
    const out = await chat([
      ["learn> ", `hang${ENTER}`],
      ["ANSWER2", "\u0003"],
      ["cancelled", `again${ENTER}`],
      ["ANSWER3", `/exit${ENTER}`],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(bodies).toHaveLength(3);
    // The cancelled turn is not part of the history.
    expect(bodies[2]!.messages.map((m) => m.content)).not.toContain("hang");
  }, 30_000);

  it("discards a multi-line paste made while an answer streams, with a note, and sends no extra requests", async () => {
    const releaseUrl = `${baseUrl.replace(/\/v1$/, "")}/release`;
    const out = await chat([
      ["learn> ", `slow${ENTER}`],
      ["ANSWER2", `PASTE-ONE-sk-live${ENTER}PASTE-TWO${ENTER}PASTE-THREE${ENTER}`],
      // The terminal has echoed the last pasted line, so every line has been read; only now does the answer finish.
      ["PASTE-THREE", `get:${releaseUrl}`],
      ["discarded 3 lines", `/exit${ENTER}`],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    // The explanation and "slow" only: none of the pasted lines became a question.
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies)).not.toContain("PASTE");
    // The note gives a count only. The terminal's own echo of what was typed is the one occurrence of each line; a note repeating it would make two.
    for (const text of ["PASTE-ONE-sk-live", "PASTE-TWO", "PASTE-THREE"]) expect(out.split(text)).toHaveLength(2);
  }, 30_000);

  /** A multi-line paste of about `length` characters starting with `c`: a terminal takes only about a thousand characters on one line. */
  const paste = (c: string, length: number) => `<<<${ENTER}${`${c.repeat(400)}${ENTER}`.repeat(Math.ceil(length / 400))}>>>${ENTER}`;

  it("derives a local endpoint's Session cap from --context-window, and refuses a message that cannot fit", async () => {
    // Window 800 tokens: 600 for the prompt = 2400 characters, less the system prompt (a little over 1,300), about 1,000. A 1,200-character question cannot fit; a short one can. (A pty holds only so much echoed text, so the pastes stay small.)
    const out = await chat([
      ["learn> ", paste("x", 1200)],
      ["too long to send", `short${ENTER}`],
      ["ANSWER2", `/exit${ENTER}`],
    ], { LEARN_CONTEXT_WINDOW: "800" });
    expect(out).toMatch(/\nexit 0\n$/);
    expect(out).toContain("--context-window");
    expect(bodies).toHaveLength(2);
  }, 30_000);

  it("drops the oldest turns to stay inside the cap, and says which", async () => {
    // Each question is 1200 characters. The cap is about 4,700, so the fourth question no longer fits beside turn 1 and turns 2 and 3.
    const q = (c: string) => paste(c, 1200);
    const out = await chat([
      ["learn> ", q("a")],
      ["ANSWER2", q("b")],
      ["ANSWER3", q("c")],
      ["ANSWER4", q("d")],
      ["ANSWER5", `/exit${ENTER}`],
    ], { LEARN_CONTEXT_WINDOW: "2000" });
    expect(out).toMatch(/\nexit 0\n$/);
    expect(out).toMatch(/dropped turns? 2/);
    const last = bodies.at(-1)!.messages;
    expect(last[1]!.content).toContain("export const a = 1;");
    expect(last.some((m) => m.content.startsWith("aaa"))).toBe(false);
    expect(last.at(-1)!.content.startsWith("dd")).toBe(true);
  }, 30_000);

  it("refuses up front, sending nothing, when the first Excerpt could never leave room to chat", async () => {
    const out = await chat([["exit", ""]], { LEARN_CONTEXT_WINDOW: "100" });
    expect(out).toMatch(/\nexit 3\n$/);
    expect(out).toContain("could not continue");
    expect(out).toContain("--context-window");
    expect(bodies).toHaveLength(0);
  }, 30_000);

  it("Ctrl-C at an idle prompt ends the chat", async () => {
    const out = await chat([["learn> ", "\u0003"]]);
    expect(out).toMatch(/\nexit 0\n$/);
  }, 30_000);
});

describe.skipIf(!hasPython)("learn --chat /save and /glossary", () => {
  /** Runs the steps with the notes directory set to a fresh folder in the config file. */
  async function withNotes(steps: [string, string][], notes?: string): Promise<{ out: string; notes: string }> {
    const xdg = await mkdtemp(join(tmpdir(), "learn-xdg-"));
    const notesDir = notes ?? join(await mkdtemp(join(tmpdir(), "learn-notes-")), "notes");
    await mkdir(join(xdg, "learn"));
    await writeFile(join(xdg, "learn", "config.toml"), `notes_dir = ${JSON.stringify(notesDir)}\n`);
    return { out: await chat(steps, { XDG_CONFIG_HOME: xdg }), notes: notesDir };
  }

  it("/save writes the Session to a new note in the notes directory, says where, and sends no request", async () => {
    const { out, notes } = await withNotes([
      ["learn> ", `why is it 1?${ENTER}`],
      ["ANSWER2", `/save${ENTER}`],
      ["saved", `/exit${ENTER}`],
    ]);
    expect(out).toMatch(/\nexit 0\n$/);
    expect(bodies).toHaveLength(2);
    const files = await readdir(notes);
    expect(files).toHaveLength(1);
    expect(out).toContain(files[0]!);
    const text = await readFile(join(notes, files[0]!), "utf8");
    expect(text.split("\n")[0]).toContain("contains code");
    for (const part of ["export const a = 1;", "ANSWER1", "why is it 1?", "ANSWER2"]) expect(text).toContain(part);
  }, 30_000);

  it("a second /save makes a second file, and a name such as ../../x stays inside the notes directory", async () => {
    const { notes } = await withNotes([
      ["learn> ", `/save${ENTER}`],
      ["saved", `/save ../../x${ENTER}`],
      ["saved", `/exit${ENTER}`],
    ]);
    expect(await readdir(notes)).toHaveLength(2);
    expect(await readdir(join(notes, ".."))).toEqual(["notes"]);
  }, 30_000);

  it("/glossary term: meaning appends to glossary.md; without a colon it explains and writes nothing", async () => {
    const { out, notes } = await withNotes([
      ["learn> ", `/glossary closure a function plus its captured variables${ENTER}`],
      ["usage", `/glossary closure: a function plus its captured variables${ENTER}`],
      ["glossary.md", `/exit${ENTER}`],
    ]);
    expect(out).toContain("/glossary term: meaning");
    expect(await readdir(notes)).toEqual(["glossary.md"]);
    expect(await readFile(join(notes, "glossary.md"), "utf8")).toContain("**closure**: a function plus its captured variables");
  }, 30_000);

  it("warns once, before the first write, when the notes directory is inside a git work tree", async () => {
    const repo = await mkdtemp(join(tmpdir(), "learn-notes-repo-"));
    execFileSync("git", ["init", "-q", repo]);
    const { out, notes } = await withNotes(
      [
        ["learn> ", `/save${ENTER}`],
        ["saved", `/save again${ENTER}`],
        ["saved", `/glossary a: b${ENTER}`],
        ["added", `/exit${ENTER}`],
      ],
      join(repo, "notes"),
    );
    expect(out.split("is inside the git repository")).toHaveLength(2);
    expect(out).toContain("could be committed by accident");
    expect(await readdir(notes)).toHaveLength(3);
  }, 30_000);

  it("does not warn when the notes directory is outside any repository", async () => {
    const { out } = await withNotes([
      ["learn> ", `/save${ENTER}`],
      ["saved", `/exit${ENTER}`],
    ]);
    expect(out).not.toContain("git repository");
  }, 30_000);

  it("says in the note when the Session included a file that is normally excluded, and only then", async () => {
    await writeFile(join(dir, ".env"), "SECRET_FOR_NOTE=1\n");
    const flagged = await withNotes([
      ["learn> ", `what is in @.env?${ENTER}`],
      ["ANSWER2", `/save${ENTER}`],
      ["saved", `/exit${ENTER}`],
    ]);
    const [name] = await readdir(flagged.notes);
    const text = await readFile(join(flagged.notes, name!), "utf8");
    expect(text.split("\n")[0]).toMatch(/contains code/);
    expect(text).toContain("this note includes content from a file normally excluded.");
    const plain = await withNotes([
      ["learn> ", `/save${ENTER}`],
      ["saved", `/exit${ENTER}`],
    ]);
    expect(await readFile(join(plain.notes, (await readdir(plain.notes))[0]!), "utf8")).not.toContain("normally excluded");
  }, 30_000);

  it("reports an unusable notes directory inline and the chat goes on", async () => {
    const blocker = join(await mkdtemp(join(tmpdir(), "learn-notes-")), "file");
    await writeFile(blocker, "");
    const { out } = await withNotes(
      [
        ["learn> ", `/save${ENTER}`],
        ["notes directory", `more?${ENTER}`],
        ["ANSWER2", `/exit${ENTER}`],
      ],
      blocker,
    );
    expect(out).toMatch(/\nexit 0\n$/);
    expect(bodies).toHaveLength(2);
  }, 30_000);
});

describe.skipIf(!hasPython)("learn --chat keeps every turn on the first turn's safety path", () => {
  const CANARY = "CANARY-9f3a-never-leave";
  const KEY_CANARY = "sk-CANARY-key-never-leave";

  it("sends the key only as the Authorization header of each turn, and no turn, error or output leaks the key or the Excerpt", async () => {
    const xdg = await mkdtemp(join(tmpdir(), "learn-xdg-"));
    await mkdir(join(xdg, "learn"));
    await writeFile(join(xdg, "learn", "config.toml"), '[provider]\nkey_env = "KEY_VAR"\n');
    const secretFile = join(dir, "secret.ts");
    await writeFile(secretFile, `export const token = "${CANARY}";\n`);
    const out = await chat(
      [
        ["learn> ", `first${ENTER}`],
        ["ANSWER2", `second${ENTER}`],
        ["ANSWER3", `badkey${ENTER}`],
        ["rejected the API key", `third${ENTER}`],
        ["ANSWER5", `/exit${ENTER}`],
      ],
      { KEY_VAR: KEY_CANARY, XDG_CONFIG_HOME: xdg },
      secretFile,
    );
    expect(out).toMatch(/\nexit 0\n$/);
    expect(bodies).toHaveLength(5);
    // Same key, same header, every turn, including the one the provider rejected.
    expect(auths).toEqual(Array(5).fill(`Bearer ${KEY_CANARY}`));
    // The key is in the header and nowhere else: not the bodies, not the output, not the error message.
    expect(JSON.stringify(bodies)).not.toContain(KEY_CANARY);
    expect(out).not.toContain(KEY_CANARY);
    expect(out).not.toContain("bad key");
    // The Excerpt was chosen by the user and goes to the model (as the pinned first turn), but is never echoed to the terminal.
    expect(bodies[4]!.messages[1]!.content).toContain(CANARY);
    expect(out).not.toContain(CANARY);
    // The error turn left no trace in the history of the next one.
    expect(bodies[4]!.messages.map((m) => m.content)).not.toContain("badkey");
  }, 30_000);
});
