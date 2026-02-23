import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["test/setup-env.ts"],
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tmp/**", "**/node_modules/**", "**/dist/**", "**/tmp/**"]
  }
})
