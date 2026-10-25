import { Command, CommanderError } from "commander";
import { ExitCode, LEVELS } from "../core/index.js";

/** The subcommands `learn` routes to. `init` and `auth` are announced here before they exist (tickets 30 and 31). */
export const SUBCOMMANDS = ["init", "auth"] as const;

export const USAGE = `Usage: learn <file> [--base-url <url>] [--model <name>] [--root <dir>] [--level <level>] [--context-budget <chars>] [--allow-sensitive] [--show-prompt] [--dry-run]
       cat <file> | learn [--lang <language>] [same options]
       learn --clip [--lang <language>] [same options]
       learn <command>
       learn -h | --help | -v | --version

Commands: ${SUBCOMMANDS.join(", ")}

Each setting comes from its flag, then its environment variable (LEARN_BASE_URL, LEARN_MODEL, LEARN_LEVEL, LEARN_CONTEXT_BUDGET),
then the config file (~/.config/learn/config.toml), then the default.
Level is one of: ${LEVELS.join(", ")} (default intermediate).`;

/** The exit codes scripts can rely on, with what each means. */
const EXIT_CODES: [number, string][] = [
  [0, "success"],
  [ExitCode.Runtime, "runtime or provider error"],
  [ExitCode.Usage, "usage error (bad flag, missing setting, unknown command)"],
  [ExitCode.Refused, "refused on purpose (sensitive file, path outside the project, input too large)"],
  [ExitCode.Cancelled, "cancelled (Ctrl-C; SIGTERM ends with 143)"],
];

/** What `--help` prints: the usage plus the exit codes scripts can rely on. */
export const HELP = `${USAGE}

Exit codes:
${EXIT_CODES.map(([code, meaning]) => `  ${String(code).padEnd(4)}${meaning}`).join("\n")}`;

/** The flags of the main `learn <file>` command, as commander names them. */
export type Flags = {
  baseUrl?: string;
  model?: string;
  level?: string;
  root?: string;
  contextBudget?: string;
  allowSensitive?: boolean;
  showPrompt?: boolean;
  dryRun?: boolean;
  lang?: string;
  clip?: boolean;
};

export type Parsed =
  | { kind: "run"; reference?: string; flags: Flags }
  | { kind: "help"; text: string }
  | { kind: "version" }
  | { kind: "usage-error"; message: string };

/**
 * A bare lowercase word such as `learn init` or a mistyped `learn ini`. When no file of that name exists,
 * it is far more likely a command than a file, so the CLI says which commands there are.
 */
export const looksLikeCommand = (reference: string) => /^[a-z][a-z-]*$/.test(reference);

/** Commander's message in this tool's voice. A flag's `=value` is dropped, so a secret typed after `--api-key=` is never echoed back. */
function messageOf(err: CommanderError): string {
  const text = err.message.replace(/^error: /, "").replace(/(--[\w-]+)=[^'\s]*/g, "$1");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Parses the arguments (without `node` and the script) into what the caller should do. Commander only reads
 * the command line: it never writes or exits itself (`exitOverride`, silenced output), so every outcome,
 * including a usage error, comes back as a value and the exit code stays this tool's own (2, not commander's 1).
 */
export function parseCommandLine(argv: string[]): Parsed {
  let result: Parsed | undefined;
  let helpText = "";
  const program = new Command("learn")
    .exitOverride()
    .configureOutput({ writeOut: (text) => (helpText += text), writeErr: () => {}, outputError: () => {} })
    .helpOption(false)
    .showSuggestionAfterError(false)
    // Extra positionals have always been ignored; the first one is the reference.
    .allowExcessArguments(true)
    .argument("[reference]")
    .option("--base-url <url>")
    .option("--model <name>")
    .option("--level <level>")
    .option("--root <dir>")
    .option("--context-budget <chars>")
    .option("--allow-sensitive")
    .option("--show-prompt")
    .option("--dry-run")
    .option("--lang <language>")
    .option("--clip")
    .option("-h, --help")
    .option("-v, --version")
    .action((reference: string | undefined, { help, version, ...flags }: Flags & { help?: boolean; version?: boolean }) => {
      // Asked for on purpose, and ahead of everything else, even a file argument or valid flags.
      if (help) result = { kind: "help", text: HELP };
      else if (version) result = { kind: "version" };
      else result = { kind: "run", reference, flags };
    });
  for (const name of SUBCOMMANDS) {
    const command = program.command(name).description(`learn ${name}`);
    command.action(() => {
      // The program owns -h/--help (so it wins over a file argument), which means it also swallows `learn init --help`.
      if (program.opts<{ help?: boolean }>().help) result = { kind: "help", text: command.helpInformation() };
      else result = { kind: "usage-error", message: `learn ${name} is not available yet` };
    });
  }
  try {
    program.parse(argv, { from: "user" });
  } catch (err) {
    if (!(err instanceof CommanderError)) throw err;
    if (err.code === "commander.helpDisplayed") return { kind: "help", text: helpText };
    return { kind: "usage-error", message: messageOf(err) };
  }
  return result ?? { kind: "usage-error", message: "nothing to do" };
}
