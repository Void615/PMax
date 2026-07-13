import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts", "entry/**/__tests__/**/*.test.ts", "tools/**/__tests__/**/*.test.ts", "capabilities/**/__tests__/**/*.test.ts"],
  },
});
