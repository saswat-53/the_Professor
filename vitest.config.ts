import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Reset every mock before each test, back to the function it wraps, so a one-shot
    // `mockResolvedValueOnce` that a test never consumed cannot leak into the next test.
    mockReset: true,
  },
});
