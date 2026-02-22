import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

const script = path.resolve(process.cwd(), "scripts/check-dist-esm-import-specifiers.mjs")

describe("check-dist-esm-import-specifiers script", () => {
  it("fails for extensionless side-effect imports in dist output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-dist-esm-guard-"))
    await fs.mkdir(path.join(root, "dist", "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "dist", "index.js"), 'import "./lib/side-effect"\n', "utf8")
    await fs.writeFile(path.join(root, "dist", "lib", "side-effect.js"), "export {}\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("extensionless relative imports in dist output")
    expect(result.stderr).toContain("dist/index.js:1 -> ./lib/side-effect")
  })

  it("passes when dist side-effect imports are fully specified", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-dist-esm-guard-"))
    await fs.mkdir(path.join(root, "dist", "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "dist", "index.js"), 'import "./lib/side-effect.js"\n', "utf8")
    await fs.writeFile(path.join(root, "dist", "lib", "side-effect.js"), "export {}\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("ignores commented side-effect imports in dist output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-dist-esm-guard-"))
    await fs.mkdir(path.join(root, "dist", "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "dist", "index.js"), '// import "./lib/side-effect"\n', "utf8")
    await fs.writeFile(path.join(root, "dist", "lib", "side-effect.js"), "export {}\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("ignores block-commented imports in dist output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-dist-esm-guard-"))
    await fs.mkdir(path.join(root, "dist", "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "dist", "index.js"), '/* import "./lib/side-effect" */\n', "utf8")
    await fs.writeFile(path.join(root, "dist", "lib", "side-effect.js"), "export {}\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("checks .mjs files in dist output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-dist-esm-guard-"))
    await fs.mkdir(path.join(root, "dist", "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "dist", "index.mjs"), 'import "./lib/side-effect"\n', "utf8")
    await fs.writeFile(path.join(root, "dist", "lib", "side-effect.mjs"), "export {}\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("dist/index.mjs:1 -> ./lib/side-effect")
  })

  it("ignores commented from imports in dist output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-dist-esm-guard-"))
    await fs.mkdir(path.join(root, "dist", "lib"), { recursive: true })
    await fs.writeFile(path.join(root, "dist", "index.js"), '// import { x } from "./lib/side-effect"\n', "utf8")
    await fs.writeFile(path.join(root, "dist", "lib", "side-effect.js"), "export const x = 1\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("ignores block-commented from/import() forms in dist output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-dist-esm-guard-"))
    await fs.mkdir(path.join(root, "dist", "lib"), { recursive: true })
    await fs.writeFile(
      path.join(root, "dist", "index.js"),
      '/* import { x } from "./lib/side-effect"\nimport("./lib/side-effect") */\n',
      "utf8"
    )
    await fs.writeFile(path.join(root, "dist", "lib", "side-effect.js"), "export const x = 1\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })

  it("ignores inline line-commented import forms in dist output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-dist-esm-guard-"))
    await fs.mkdir(path.join(root, "dist", "lib"), { recursive: true })
    await fs.writeFile(
      path.join(root, "dist", "index.js"),
      'const a = 1 // import { x } from "./lib/side-effect"\nconst b = 2 // import("./lib/side-effect")\n',
      "utf8"
    )
    await fs.writeFile(path.join(root, "dist", "lib", "side-effect.js"), "export const x = 1\n", "utf8")

    const result = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8"
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fully specified")
  })
})
