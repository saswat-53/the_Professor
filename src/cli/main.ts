import { parseArgs } from "node:util";
import { DEFAULT_LEVEL, findProjectRoot, LEVELS, LearnError, buildRequest, explain, isLevel } from "../core/index.js";
import type { ModelRequest } from "../core/index.js";
import { openAICompatibleModel } from "./openai-compatible.js";

const USAGE = `Usage: learn <file> [--base-url <url>] [--model <name>] [--root <dir>] [--level <level>] [--allow-sensitive] [--show-prompt] [--dry-run]

Base URL and model come from flags, or LEARN_BASE_URL and LEARN_MODEL.
Level is one of: ${LEVELS.join(", ")} (default intermediate).`;

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        "base-url": { type: "string" },
        model: { type: "string" },
        level: { type: "string" },
        root: { type: "string" },
        "allow-sensitive": { type: "boolean" },
        "show-prompt": { type: "boolean" },
        "dry-run": { type: "boolean" },
      },
    });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n${USAGE}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  const baseUrl = values["base-url"] ?? process.env.LEARN_BASE_URL;
  const model = values.model ?? process.env.LEARN_MODEL;
  const [reference] = positionals;
  if (!reference || !baseUrl || !model) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const level = values.level ?? DEFAULT_LEVEL;
  if (!isLevel(level)) {
    process.stderr.write(`invalid --level "${level}"; choose one of: ${LEVELS.join(", ")}\n`);
    return 2;
  }
  const settings = { baseUrl, model, level };
  const fail = (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return err instanceof LearnError ? err.exitCode : 1;
  };
  try {
    const project = await findProjectRoot(process.cwd(), values.root);
    if (project.isHome) {
      process.stderr.write(
        "warning: the project root is your home directory, so everything in it is in reach; run learn from inside a project or pass --root\n",
      );
    }
  } catch (err) {
    return fail(err);
  }
  const printRequest = (request: ModelRequest) =>
    process.stderr.write(
      `base URL: ${request.baseUrl}\nmodel: ${request.model}\n--- system ---\n${request.system}\n--- user ---\n${request.user}\n`,
    );

  if (values["dry-run"]) {
    try {
      const request = await buildRequest({ reference, settings, root: values.root, allowSensitive: values["allow-sensitive"] });
      printRequest(request);
      return 0;
    } catch (err) {
      return fail(err);
    }
  }

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const llm = openAICompatibleModel(process.env.LEARN_API_KEY);
  let lastChar = "\n";
  for await (const event of explain({
    reference,
    settings,
    root: values.root,
    allowSensitive: values["allow-sensitive"],
    model: llm,
    signal: controller.signal,
    onRequest: values["show-prompt"] ? printRequest : undefined,
  })) {
    if (event.type === "text-delta") {
      process.stdout.write(event.text);
      lastChar = event.text.at(-1) ?? lastChar;
    } else if (event.type === "error") {
      // Start the message on a fresh line, but only if streamed text left the cursor mid-line.
      process.stderr.write(`${lastChar === "\n" ? "" : "\n"}${event.error.message}\n`);
      return event.error.exitCode;
    }
  }
  process.stdout.write("\n");
  return 0;
}

process.exitCode = await main();
