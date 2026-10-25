import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * A fake clipboard for black-box runs: a directory of scripts named like every platform's clipboard tool
 * (pbpaste, wl-paste, xclip by default, or just `tools`), put first on PATH. Each prints `text` and records how it was started, so a
 * test can show the exact arguments. `failWith` makes the tool exit with that status and print nothing.
 */
export async function fakeClipboard(text: string, { failWith, tools = ["pbpaste", "wl-paste", "xclip"] }: { failWith?: number; tools?: string[] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "learn-clip-"));
  const bin = join(dir, "bin");
  await mkdir(bin);
  const content = join(dir, "content");
  const calls = join(dir, "calls");
  await writeFile(content, text);
  await writeFile(calls, "");
  const script = `#!/bin/sh\nprintf '%s' "$(basename "$0")" >> '${calls}'\nfor a in "$@"; do printf ' [%s]' "$a" >> '${calls}'; done\nprintf '\\n' >> '${calls}'\n${failWith ? `exit ${failWith}` : `cat '${content}'`}\n`;
  for (const name of tools) {
    await writeFile(join(bin, name), script);
    await chmod(join(bin, name), 0o755);
  }
  return {
    env: { PATH: tools.length === 0 ? bin : [bin, process.env.PATH].join(delimiter) },
    /** One line per start: the tool's name, then each argument in brackets. */
    calls: async () => (await readFile(calls, "utf8")).split("\n").filter(Boolean),
  };
}

/** An environment where no clipboard tool exists: PATH holds only `node`, so the CLI itself still starts. */
export async function noClipboardTools() {
  const bin = join(await mkdtemp(join(tmpdir(), "learn-noclip-")), "bin");
  await mkdir(bin);
  await symlink(process.execPath, join(bin, "node"));
  return { PATH: bin };
}
