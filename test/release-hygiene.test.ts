import { describe, it, expect } from "vitest"

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

describe("release hygiene", () => {
  it("package.json has verify script", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    expect(pkg.scripts?.verify).toBe("npm run typecheck && npm test && npm run build")
    expect(pkg.scripts?.prepack).toBe("npm run build")
  })

  it("includes license and changelog files", () => {
    expect(existsSync(join(process.cwd(), "LICENSE"))).toBe(true)
    expect(existsSync(join(process.cwd(), "CHANGELOG.md"))).toBe(true)
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
})
