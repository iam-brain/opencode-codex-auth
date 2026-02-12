import { describe, it, expect } from "vitest"

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

describe("release hygiene", () => {
  it("package.json has verify script", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    expect(pkg.scripts?.verify).toBe("npm run typecheck && npm test && npm run build")
    expect(pkg.scripts?.prepack).toBe("npm run build")
    expect(pkg.scripts?.build).toBe("npm run clean:dist && tsc")
    expect(pkg.scripts?.["clean:dist"]).toBe("node scripts/clean-dist.js")
    expect(existsSync(join(process.cwd(), "scripts", "clean-dist.js"))).toBe(true)
  })

  it("includes license and changelog files", () => {
    expect(existsSync(join(process.cwd(), "LICENSE"))).toBe(true)
    expect(existsSync(join(process.cwd(), "CHANGELOG.md"))).toBe(true)
  })

  it("uses single-command automated release scripts", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    expect(pkg.scripts?.release).toBe("node scripts/release.js")
    expect(pkg.scripts?.["release:patch"]).toBe("npm run release -- patch")
    expect(pkg.scripts?.["release:minor"]).toBe("npm run release -- minor")
    expect(pkg.scripts?.["release:major"]).toBe("npm run release -- major")
    expect(existsSync(join(process.cwd(), "scripts", "release.js"))).toBe(true)
  })
})

describe("package publish surface", () => {
  it("limits published files via package.json files list", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    expect(Array.isArray(pkg.files)).toBe(true)
    expect(pkg.files).toContain("dist/")
    expect(pkg.files).toContain("README.md")
    expect(pkg.files).toContain("LICENSE")
  })

  it("release workflow enforces full verify gate", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "release.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    expect(workflow).toContain("run: npm run verify")
  })
})
