import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["test/setup-env.ts"],
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tmp/**", "**/node_modules/**", "**/dist/**", "**/tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["lib/**/*.ts", "index.ts"],
      thresholds: {
        lines: 20,
        branches: 20,
        functions: 20,
        statements: 20
      }
    }
  }
})
