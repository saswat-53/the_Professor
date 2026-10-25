import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: { cli: "src/cli/main.ts" },
  format: ["esm"],
  target: "node22",
  clean: true,
  // tsup externalizes dependencies but not optionalDependencies; the keychain library is native and must stay a runtime import (see src/cli/keychain.ts).
  external: ["@napi-rs/keyring"],
  // The teaching prompt is a plain .md file; bundling it as text keeps it inside dist/cli.js.
  loader: { ".md": "text" },
  define: { __VERSION__: JSON.stringify(version) },
  banner: { js: "#!/usr/bin/env node" },
});
