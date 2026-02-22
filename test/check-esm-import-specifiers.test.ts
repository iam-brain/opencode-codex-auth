import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

const script = path.resolve(process.cwd(), "scripts/check-esm-import-specifiers.mjs")

describe("check-esm-import-specifiers script", () => {
  it("fails for side-effect imports without runtime extension", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-esm-guard-"))
    await fs.mkdir(path.join(root, "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "index.ts"), 'import "./lib/side-effect"\n', "utf8")
    await fs.writeFile(path.join(root, "lib", "side-effect.ts"), "export {}\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("extensionless local ESM import specifiers")
    expect(result.stderr).toContain("index.ts:1 -> ./lib/side-effect")
  })

  it("passes when side-effect imports are fully specified", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-esm-guard-"))
    await fs.mkdir(path.join(root, "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "index.ts"), 'import "./lib/side-effect.js"\n', "utf8")
    await fs.writeFile(path.join(root, "lib", "side-effect.ts"), "export {}\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("ignores commented side-effect imports", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-esm-guard-"))
    await fs.mkdir(path.join(root, "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "index.ts"), '// import "./lib/side-effect"\n', "utf8")
    await fs.writeFile(path.join(root, "lib", "side-effect.ts"), "export {}\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("ignores block-commented imports", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-esm-guard-"))
    await fs.mkdir(path.join(root, "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "index.ts"), '/* import "./lib/side-effect" */\n', "utf8")
    await fs.writeFile(path.join(root, "lib", "side-effect.ts"), "export {}\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("ignores commented from imports", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-esm-guard-"))
    await fs.mkdir(path.join(root, "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "index.ts"), '// import { x } from "./lib/side-effect"\n', "utf8")
    await fs.writeFile(path.join(root, "lib", "side-effect.ts"), "export const x = 1\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("ignores block-commented from/import() forms", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-esm-guard-"))
    await fs.mkdir(path.join(root, "lib"), { recursive: true })
    await fs.writeFile(
      path.join(root, "index.ts"),
      '/* import { x } from "./lib/side-effect"\nimport("./lib/side-effect") */\n',
      "utf8"
    )
    await fs.writeFile(path.join(root, "lib", "side-effect.ts"), "export const x = 1\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("ignores inline line-commented import forms", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-esm-guard-"))
    await fs.mkdir(path.join(root, "lib"), { recursive: true })
    await fs.writeFile(
      path.join(root, "index.ts"),
      'const a = 1 // import { x } from "./lib/side-effect"\nconst b = 2 // import("./lib/side-effect")\n',
      "utf8"
    )
    await fs.writeFile(path.join(root, "lib", "side-effect.ts"), "export const x = 1\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("fails when index.ts uses @opencode-ai/plugin runtime import", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-esm-guard-"))
    await fs.writeFile(path.join(root, "index.ts"), 'import { tool } from "@opencode-ai/plugin"\n', "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("runtime tool import must use")
  })
})
