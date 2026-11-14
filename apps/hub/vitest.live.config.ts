import { defineConfig } from "vitest/config";

/** Tests that call live AWS services. Not part of `pnpm test`. */
export default defineConfig({
  test: {
    include: ["test/live/**/*.live.ts"],
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
