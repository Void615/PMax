import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["../entry/__tests__/**/*.test.ts", "./**/*.test.ts"],
  },
});
