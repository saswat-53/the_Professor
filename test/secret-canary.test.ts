import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./support/cli.js";
import { fakeClipboard } from "./support/fake-clipboard.js";

// Ticket 21: a planted secret can never leave through any path the tool has. Black-box, against the built CLI and a real
// temp project, so a new output path that forgets the gate shows up here. The cases that need a hosted URL never
// contact it: a refusal happens before any request.
const CANARY = "CANARY-9f3a-never-leave";
const KEY_CANARY = "sk-CANARY-key-never-leave";
const HOSTED = "https://api.example.com/v1";

/** A repo inside a temp HOME holding the canary in a gitignored file and in several denylisted ones, plus ordinary files that name them. */
async function secretProject() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "learn-home-")));
  const repo = join(home, "proj");
  await mkdir(join(repo, "sub"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
  await writeFile(join(repo, "ignored.txt"), `${CANARY}\n`);
  await writeFile(join(repo, ".env"), `TOKEN=${CANARY}\n`);
  await writeFile(join(repo, "sub", ".env.local"), `TOKEN=${CANARY}\n`);
  await writeFile(join(repo, "server.pem"), `${CANARY}\n`);
  // Links with harmless names: one to a root `.env`, one to a denylisted file two directories down. Only the target's name gives either away.
  await symlink(join(repo, ".env"), join(repo, "innocent.txt"));
  await symlink(join(repo, "sub", ".env.local"), join(repo, "notes.txt"));
  // Ordinary files whose Context (imports, nearby lines) mentions the secret files. Nothing may follow those references.
  await writeFile(join(repo, "app.ts"), 'import secrets from "./.env";\nimport ignored from "./ignored.txt";\nimport pem from "./server.pem";\n\nexport const x = 1;\nexport const y = 2;\n');
  await writeFile(join(repo, "app.py"), 'from secrets import load\nimport ignored\n\n\ndef f():\n    return open(".env").read()\n');
  return { home, repo };
}

async function keyVarConfig() {
  const xdg = await mkdtemp(join(tmpdir(), "learn-xdg-"));
  await mkdir(join(xdg, "learn"));
  await writeFile(join(xdg, "learn", "config.toml"), '[provider]\nkey_env = "KEY_VAR"\n');
  return { XDG_CONFIG_HOME: xdg };
}

/** The environment for a run against `baseUrl`: the key canary in the variable the config names, and the temp HOME. */
async function envFor(baseUrl: string, home: string) {
  return { LEARN_BASE_URL: baseUrl, LEARN_MODEL: "m", KEY_VAR: KEY_CANARY, HOME: home, ...(await keyVarConfig()) };
}

/** A local endpoint that records the request body and Authorization header, and answers with `reply`. */
async function withServer<T>(
  body: (url: string, seen: { body: () => string; auth: () => string | undefined; requests: () => number }) => Promise<T>,
  reply: (res: ServerResponse) => void = (res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = { id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] };
    res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  },
): Promise<T> {
  let received = "";
  let auth: string | undefined;
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    auth = req.headers.authorization;
    req.on("data", (d) => (received += d));
    req.on("end", () => reply(res));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, { body: () => received, auth: () => auth, requests: () => requests });
  } finally {
    server.close();
  }
}

const MODES: { name: string; flags: string[] }[] = [
  { name: "plain run", flags: [] },
  { name: "--show-prompt", flags: ["--show-prompt"] },
  { name: "--dry-run", flags: ["--dry-run"] },
];

describe("secret canary: Sensitive files and the Context", () => {
  const refused = [".env", "ignored.txt", "innocent.txt", "notes.txt", "sub/.env.local", "server.pem", ".env:1", "ignored.txt:1-1"];
  const cases = refused.flatMap((target) => MODES.map((m) => [target, m.name, m.flags] as const));

  it.each(cases)("%s with %s: refused, and the canary, key and home path appear nowhere", async (target, _mode, flags) => {
    const { home, repo } = await secretProject();
    const env = await envFor(HOSTED, home);
    const r = await run([target, ...flags], env, repo);
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/refused: /);
    expect(r.stdout).toBe("");
    const everything = r.stdout + r.stderr;
    expect(everything).not.toContain(CANARY);
    expect(everything).not.toContain(KEY_CANARY);
    expect(everything).not.toContain(home);
  });

  const importers = ["app.ts", "app.ts:5", "app.py", "app.py:5"];
  const importerCases = importers.flatMap((target) => MODES.map((m) => [target, m.name, m.flags] as const));

  it.each(importerCases)("%s with %s: a file that imports secret files sends its own text and never theirs", async (target, mode, flags) => {
    const { home, repo } = await secretProject();
    await withServer(async (url, seen) => {
      const env = await envFor(url, home);
      const r = await run([target, ...flags], env, repo);
      expect(r.code).toBe(0);
      // Not vacuous: the import lines are in the request (or the printed prompt), the contents they point at are not.
      const shown = mode === "--dry-run" ? r.stderr : (JSON.parse(seen.body()) as { messages: { content: string }[] }).messages[1]!.content;
      expect(shown).toContain(target.startsWith("app.ts") ? 'import secrets from "./.env";' : "import ignored");
      const everything = r.stdout + r.stderr + seen.body();
      expect(everything).not.toContain(CANARY);
      expect(everything).not.toContain(KEY_CANARY);
      expect(everything).not.toContain(home);
      // --dry-run sends nothing; the other modes send the key as the Authorization header and nowhere else.
      expect(seen.requests()).toBe(mode === "--dry-run" ? 0 : 1);
      expect(seen.auth()).toBe(mode === "--dry-run" ? undefined : `Bearer ${KEY_CANARY}`);
    });
  });
});

describe("secret canary: piped input", () => {
  it("has no filename for a rule to catch, says so in the report, and the key still appears nowhere", async () => {
    const { home, repo } = await secretProject();
    await withServer(async (url, seen) => {
      for (const flags of [[], ["--show-prompt"], ["--dry-run"]]) {
        const r = await run(flags, await envFor(url, home), repo, undefined, `TOKEN=${CANARY}\n`);
        expect(r.code).toBe(0);
        // The pinned wording: a pipe cannot be checked by name, and the user is told.
        expect(r.stderr).toContain("no filename checks applied");
        expect(r.stdout + r.stderr + seen.body()).not.toContain(KEY_CANARY);
        expect(r.stdout + r.stderr + seen.body()).not.toContain(home);
      }
      // The two sending runs carried the text (it is what the user chose to pipe); the dry run sent nothing.
      expect(seen.requests()).toBe(2);
      expect(seen.body()).toContain(CANARY);
      expect(seen.auth()).toBe(`Bearer ${KEY_CANARY}`);
    });
  });
});

describe("secret canary: clipboard input", () => {
  it("is like piped input: no filename check, said in the report, and the key still appears nowhere", async () => {
    const { home, repo } = await secretProject();
    const clip = await fakeClipboard(`TOKEN=${CANARY}\n`);
    await withServer(async (url, seen) => {
      for (const flags of [[], ["--show-prompt"], ["--dry-run"]]) {
        const r = await run(["--clip", ...flags], { ...(await envFor(url, home)), ...clip.env }, repo);
        expect(r.code).toBe(0);
        expect(r.stderr).toContain("no filename checks applied");
        expect(r.stdout + r.stderr + seen.body()).not.toContain(KEY_CANARY);
        expect(r.stdout + r.stderr + seen.body()).not.toContain(home);
      }
      // The two sending runs carried the text (it is what the user chose to copy); the dry run sent nothing.
      expect(seen.requests()).toBe(2);
      expect(seen.body()).toContain(CANARY);
      expect(seen.auth()).toBe(`Bearer ${KEY_CANARY}`);
    });
  });
});

describe("secret canary: the API key", () => {
  it.each([
    ["server answers 401", (res: ServerResponse) => { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":{"message":"Incorrect API key provided"}}'); }],
    ["server answers 500 with text", (res: ServerResponse) => { res.writeHead(500); res.end("boom"); }],
    ["server drops the connection", (res: ServerResponse) => { res.socket?.destroy(); }],
  ])("%s: the key is in no output", async (_name, reply) => {
    const { home, repo } = await secretProject();
    await withServer(
      async (url, seen) => {
        for (const flags of [[], ["--show-prompt"]]) {
          const r = await run(["app.ts", ...flags], await envFor(url, home), repo);
          expect(r.code).not.toBe(0);
          expect(r.stdout + r.stderr + seen.body()).not.toContain(KEY_CANARY);
        }
      },
      reply,
    );
  });

  it("nothing listens at the endpoint: the key is in no output", async () => {
    const { home, repo } = await secretProject();
    const r = await run(["app.ts", "--show-prompt"], await envFor("http://127.0.0.1:1/v1", home), repo);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).not.toContain(KEY_CANARY);
  });

  it("usage and reference errors never print the key", async () => {
    const { home, repo } = await secretProject();
    const env = await envFor(HOSTED, home);
    for (const args of [["missing.txt"], ["app.ts:abc"], ["app.ts", "--level", "nope"], ["--bogus"], []]) {
      const r = await run(args, env, repo);
      expect(r.code).not.toBe(0);
      expect(r.stdout + r.stderr).not.toContain(KEY_CANARY);
    }
  });

  it("a key-looking password in the base URL is rejected with the credentials removed from the message", async () => {
    const { home, repo } = await secretProject();
    const r = await run(["app.ts", "--dry-run"], { LEARN_BASE_URL: `https://user:${KEY_CANARY}@api.example.com/v1`, LEARN_MODEL: "m", HOME: home }, repo);
    expect(r.stdout + r.stderr).not.toContain(KEY_CANARY);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("must not contain a username or password");
  });
});

describe("secret canary: the override", () => {
  it("--allow-sensitive on files that are otherwise refused sends the canary, says so in the report, and still hides the key", async () => {
    const flag = "--allow-sensitive";
    for (const target of [".env", "ignored.txt", "innocent.txt", "notes.txt"]) {
      const { home, repo } = await secretProject();
      await withServer(async (url, seen) => {
        const r = await run([target, flag], await envFor(url, home), repo);
        expect(r.code).toBe(0);
        expect(seen.body()).toContain(CANARY);
        expect(r.stderr).toMatch(new RegExp(`overridden: .* is being sent to 127\\.0\\.0\\.1 because ${flag} was passed`));
        const everything = r.stdout + r.stderr + seen.body();
        expect(everything).not.toContain(KEY_CANARY);
        expect(everything).not.toContain(home);
        expect(seen.auth()).toBe(`Bearer ${KEY_CANARY}`);
      });
    }
  });

  it("--allow-sensitive with --dry-run shows the canary only in the printed request, and still not the key", async () => {
    const { home, repo } = await secretProject();
    const r = await run([".env", "--allow-sensitive", "--dry-run"], await envFor(HOSTED, home), repo);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(CANARY);
    expect(r.stderr).toContain("overridden: .env (rule: .env) is being sent to api.example.com because --allow-sensitive was passed");
    expect(r.stdout + r.stderr).not.toContain(KEY_CANARY);
  });

  it("a local endpoint skips the check, sends the canary, and the report says the check was skipped", async () => {
    const { home, repo } = await secretProject();
    await withServer(async (url, seen) => {
      const r = await run([".env"], await envFor(url, home), repo);
      expect(r.code).toBe(0);
      expect(seen.body()).toContain(CANARY);
      expect(r.stderr).toContain("sensitive-file check skipped: .env (rule: .env); endpoint is local (127.0.0.1)");
      expect(r.stdout + r.stderr + seen.body()).not.toContain(KEY_CANARY);
    });
  });
});
