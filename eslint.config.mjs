import tsParser from "@typescript-eslint/parser"

export default [
  {
    ignores: ["dist/**", "node_modules/**", ".npm-cache/**"]
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      // Keep lint low-friction for this repo; typecheck is authoritative.
    }
  }
]
