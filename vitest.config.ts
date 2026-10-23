import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // Mirror tsup's text loader so tests can import the teaching prompt.
      name: "md-as-text",
      transform: (_code, id) =>
        id.endsWith(".md") ? `export default ${JSON.stringify(readFileSync(id, "utf8"))};` : null,
    },
  ],
  test: {
    globalSetup: ["test/support/build.ts"],
    include: ["test/**/*.test.ts"],
    // Reset every mock before each test, back to the function it wraps, so a one-shot
    // `mockResolvedValueOnce` that a test never consumed cannot leak into the next test.
    mockReset: true,
  },
});
