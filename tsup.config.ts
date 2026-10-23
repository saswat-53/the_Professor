import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli/main.ts" },
  format: ["esm"],
  target: "node22",
  clean: true,
  // The teaching prompt is a plain .md file; bundling it as text keeps it inside dist/cli.js.
  loader: { ".md": "text" },
  banner: { js: "#!/usr/bin/env node" },
});
