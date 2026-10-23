import { parseArgs } from "node:util";
import { LearnError, buildRequest, explain } from "../core/index.js";
import { openAICompatibleModel } from "./openai-compatible.js";

const USAGE = `Usage: learn <file> [--base-url <url>] [--model <name>] [--dry-run]

Base URL and model come from flags, or LEARN_BASE_URL and LEARN_MODEL.`;

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        "base-url": { type: "string" },
        model: { type: "string" },
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
  const settings = { baseUrl, model };

  if (values["dry-run"]) {
    try {
      const request = await buildRequest({ reference, settings });
      process.stderr.write(
        `base URL: ${request.baseUrl}\nmodel: ${request.model}\n--- system ---\n${request.system}\n--- user ---\n${request.user}\n`,
      );
      return 0;
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return err instanceof LearnError ? err.exitCode : 1;
    }
  }

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const llm = openAICompatibleModel(process.env.LEARN_API_KEY);
  for await (const event of explain({ reference, settings, model: llm, signal: controller.signal })) {
    if (event.type === "text-delta") process.stdout.write(event.text);
    else if (event.type === "error") {
      process.stderr.write(`\n${event.error.message}\n`);
      return event.error.exitCode;
    }
  }
  process.stdout.write("\n");
  return 0;
}

process.exitCode = await main();
