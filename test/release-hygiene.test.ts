import { describe, it, expect } from "vitest"

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const REQUIRED_RELEASE_RUNTIME_CI_JOBS = [
  "Verify on Node.js 20.x",
  "Verify on Node.js 22.x",
  "Package Smoke Test",
  "Windows Runtime Hardening",
  "Security Audit"
]
const REQUIRED_WORKFLOW_STATIC_JOB_NAMES = ["Package Smoke Test", "Windows Runtime Hardening", "Security Audit"]

describe("release hygiene", () => {
  it("package.json has verify script", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    const verifyScript = String(pkg.scripts?.verify ?? "")
    const verifyOrder = [
      "npm run check:esm-imports",
      "npm run typecheck",
      "npm test",
      "npm run build",
      "npm run check:dist-esm-imports",
      "npm run smoke:cli:dist"
    ]
    let searchFrom = 0
    for (const step of verifyOrder) {
      const nextIndex = verifyScript.indexOf(step, searchFrom)
      expect(nextIndex).toBeGreaterThanOrEqual(0)
      searchFrom = nextIndex + step.length
    }
    expect(pkg.scripts?.["check:esm-imports"]).toBe("node scripts/check-esm-import-specifiers.mjs")
    expect(pkg.scripts?.["check:dist-esm-imports"]).toBe("node scripts/check-dist-esm-import-specifiers.mjs")
    expect(pkg.scripts?.["smoke:cli:dist"]).toBe("node ./dist/bin/opencode-codex-auth.js --help")
    expect(pkg.scripts?.prepack).toBe("npm run build")
    expect(pkg.scripts?.build).toBe("npm run clean:dist && tsc")
    expect(pkg.scripts?.["clean:dist"]).toBe("node scripts/clean-dist.js")
    expect(existsSync(join(process.cwd(), "scripts", "clean-dist.js"))).toBe(true)
    expect(existsSync(join(process.cwd(), "scripts", "check-esm-import-specifiers.mjs"))).toBe(true)
    expect(existsSync(join(process.cwd(), "scripts", "check-dist-esm-import-specifiers.mjs"))).toBe(true)
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

  it("release script enforces remote CI gate on main HEAD", () => {
    const releaseScriptPath = join(process.cwd(), "scripts", "release.js")
    const releaseScript = readFileSync(releaseScriptPath, "utf-8")
    expect(releaseScript).toMatch(/assertHeadMatchesOriginMain\s*\(/)
    expect(releaseScript).toMatch(/assertRemoteCiGreenForHead\s*\(/)
    expect(releaseScript).toMatch(/RELEASE_SKIP_REMOTE_CI_GATE/)
    for (const job of REQUIRED_RELEASE_RUNTIME_CI_JOBS) {
      expect(releaseScript).toContain(job)
    }
  })

  it("required release CI jobs exist in workflow", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "ci.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    expect(workflow).toContain("Verify on Node.js ${{ matrix.node-version }}")
    expect(workflow).toMatch(/node-version:\s*\[\s*20\.x\s*,\s*22\.x\s*\]/)
    for (const job of REQUIRED_WORKFLOW_STATIC_JOB_NAMES) {
      expect(workflow).toContain(job)
    }
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

  it("ci package smoke executes packed CLI tarball", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "ci.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    expect(workflow).toContain("Pack and execute CLI tarball")
    expect(workflow).toContain("npm pack --silent")
    expect(workflow).toContain("test -f")
    expect(workflow).toContain("npx --yes --package")
    expect(workflow).toContain("opencode-codex-auth --help")
  })

  it("vitest config isolates HOME/XDG test environment", () => {
    const vitestPath = join(process.cwd(), "vitest.config.ts")
    const vitestConfig = readFileSync(vitestPath, "utf-8")
    expect(vitestConfig).toMatch(/setupFiles:\s*\[\s*["']test\/setup-env\.ts["']\s*\]/)
    expect(existsSync(join(process.cwd(), "test", "setup-env.ts"))).toBe(true)
    expect(existsSync(join(process.cwd(), "test", "helpers", "isolate-env.ts"))).toBe(true)
  })
})
