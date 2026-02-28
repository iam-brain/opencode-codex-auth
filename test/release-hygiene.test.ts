import { describe, it, expect } from "vitest"

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const REQUIRED_RELEASE_RUNTIME_CI_JOBS = [
  "Verify on Node.js 20.x",
  "Verify on Node.js 22.x",
  "Package Smoke Test",
  "Package Smoke Test (Windows)",
  "Windows Runtime Hardening (Node.js 20.x)",
  "Windows Runtime Hardening (Node.js 22.x)",
  "Security Audit"
]
const REQUIRED_WORKFLOW_STATIC_JOB_NAMES = [
  "Package Smoke Test",
  "Package Smoke Test (Windows)",
  "Windows Runtime Hardening (Node.js ${{ matrix.node-version }})",
  "Security Audit"
]

describe("release hygiene", () => {
  it("package.json has verify script", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    const verifyScript = String(pkg.scripts?.verify ?? "")
    const verifyOrder = [
      "npm run check:esm-imports",
      "npm run typecheck",
      "npm run typecheck:test",
      "npm run test:coverage",
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
    expect(pkg.scripts?.["test:coverage"]).toBe("vitest run --coverage.enabled true --coverage.provider=v8")
    expect(pkg.scripts?.["patch:plugin-dts"]).toBe("node scripts/patch-opencode-plugin-dts.js")
    expect(pkg.scripts?.typecheck).toContain("npm run patch:plugin-dts")
    expect(pkg.scripts?.["typecheck:test"]).toContain("npm run patch:plugin-dts")
    expect(pkg.scripts?.prepack).toBe("npm run build")
    expect(pkg.scripts?.build).toBe("npm run patch:plugin-dts && npm run clean:dist && tsc")
    expect(pkg.scripts?.["clean:dist"]).toBe("node scripts/clean-dist.js")
    expect(existsSync(join(process.cwd(), "scripts", "clean-dist.js"))).toBe(true)
    expect(existsSync(join(process.cwd(), "scripts", "check-esm-import-specifiers.mjs"))).toBe(true)
    expect(existsSync(join(process.cwd(), "scripts", "check-dist-esm-import-specifiers.mjs"))).toBe(true)
  })

  it("declares Node engine range aligned with CI matrix", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    expect(pkg.engines?.node).toBe(">=20 <23")
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

  it("release script enforces remote CI gate on default branch HEAD", () => {
    const releaseScriptPath = join(process.cwd(), "scripts", "release.js")
    const releaseScript = readFileSync(releaseScriptPath, "utf-8")
    expect(releaseScript).toMatch(/resolveDefaultBranch\s*\(/)
    expect(releaseScript).toMatch(/assertHeadMatchesOriginDefaultBranch\s*\(/)
    expect(releaseScript).toMatch(/assertDefaultBranch\s*\(/)
    expect(releaseScript).toMatch(/assertRemoteCiGreenForHead\s*\(/)
    expect(releaseScript).toMatch(/RELEASE_SKIP_REMOTE_CI_GATE/)
    expect(releaseScript).toContain('"ls-remote", "--symref", "origin", "HEAD"')
    expect(releaseScript).toContain("const maxAttempts = 240")
    expect(releaseScript).toContain("release workflow may still be running")
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

  it("release workflow validates tag/package version parity and idempotent publish", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "release.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    expect(workflow).toContain("Ensure tagged commit matches default branch tip")
    expect(workflow).toContain('test "${TAGGED_SHA}" = "${BRANCH_HEAD_SHA}"')
    expect(workflow).toContain("Ensure required CI checks succeeded for tagged commit")
    expect(workflow).toContain("gh run list")
    expect(workflow).toContain("gh run view")
    expect(workflow).toContain("Ensure tag matches package version")
    expect(workflow).toContain('TAG_VERSION="${GITHUB_REF_NAME#v}"')
    expect(workflow).toContain('if npm view "${PKG_NAME}@${PKG_VERSION}" version >/dev/null 2>&1; then')
    expect(workflow).toContain("Package already published")
  })

  it("release workflow avoids npm ci under id-token permissions", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "release.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    const publishJob = workflow
      .split(/\n/)
      .slice(workflow.split(/\n/).findIndex((line) => line.includes("npm-publish:")))
      .join("\n")
    expect(publishJob).toContain("id-token: write")
    expect(publishJob).not.toContain("run: npm ci")
    expect(publishJob).toContain('node-version: "22.x"')
    expect(publishJob).toContain("npm install -g npm@11.5.1")
    expect(publishJob).toContain("ACTIONS_ID_TOKEN_REQUEST_URL")
    expect(publishJob).toContain("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    expect(publishJob).toContain('EXPECTED_REPO: "iam-brain/opencode-codex-auth"')
    expect(publishJob).toContain('EXPECTED_WORKFLOW_FILE: ".github/workflows/release.yml"')
    expect(publishJob).toContain('EXPECTED_ENVIRONMENT: "npm-release"')
    expect(publishJob).toContain('TARBALL="$(ls -1 ./release-artifact/*.tgz | head -n 1)"')
    expect(publishJob).not.toContain("OIDC publish unavailable; retrying with token auth.")
    expect(publishJob).not.toContain("${{ secrets.NPM_TOKEN")
    expect(publishJob).not.toContain("${{ secrets.NODE_AUTH_TOKEN")
  })

  it("all workflows pin external actions by commit SHA", () => {
    const workflowsDir = join(process.cwd(), ".github", "workflows")
    const files = ["ci.yml", "dependency-review.yml", "release.yml", "secret-scan.yml", "upstream-watch.yml"]

    for (const file of files) {
      const content = readFileSync(join(workflowsDir, file), "utf-8")
      const uses = [...content.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1])
      for (const actionRef of uses) {
        if (!actionRef) continue
        if (actionRef.startsWith("./")) continue
        if (actionRef.startsWith("docker://")) continue
        const [action, ref] = actionRef.split("@")
        expect(action.length).toBeGreaterThan(0)
        expect(ref).toMatch(/^[a-f0-9]{40}$/i)
      }
    }
  })

  it("all workflows define timeout-minutes for each job", () => {
    const workflowsDir = join(process.cwd(), ".github", "workflows")
    const files = ["ci.yml", "dependency-review.yml", "release.yml", "secret-scan.yml", "upstream-watch.yml"]

    for (const file of files) {
      const content = readFileSync(join(workflowsDir, file), "utf-8")
      const runsOnCount = (content.match(/^\s{4}runs-on:/gm) ?? []).length
      const timeoutCount = (content.match(/^\s{4}timeout-minutes:/gm) ?? []).length
      expect(timeoutCount).toBe(runsOnCount)
    }
  })

  it("upstream-watch workflow distinguishes drift from operational failures", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "upstream-watch.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    expect(workflow).toContain('echo "exit_code=${EXIT_CODE}" >> "$GITHUB_OUTPUT"')
    expect(workflow).toContain('if [ "${EXIT_CODE}" -eq 2 ]; then')
    expect(workflow).toContain("if: steps.check.outputs.exit_code == '1'")
    expect(workflow).toContain("if: steps.check.outputs.exit_code == '2'")
  })
})

describe("package publish surface", () => {
  it("limits published files via package.json files list", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    expect(Array.isArray(pkg.files)).toBe(true)
    expect(pkg.files).toContain("dist/bin/")
    expect(pkg.files).toContain("dist/lib/")
    expect(pkg.files).not.toContain("dist/")
    expect(pkg.files).toContain("README.md")
    expect(pkg.files).toContain("LICENSE")
  })

  it("release workflow enforces full verify gate", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "release.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    expect(workflow).toContain("run: npm run verify")
  })

  it("ci security audit includes dev dependencies", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "ci.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    expect(workflow).toContain("Audit dependencies (including dev toolchain)")
    expect(workflow).toContain("npm audit --audit-level=high")
    expect(workflow).not.toContain("npm audit --omit=dev")
  })

  it("ci package smoke executes packed CLI tarball", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "ci.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    expect(workflow).toContain("Pack and execute CLI tarball")
    expect(workflow).toContain("Package Smoke Test (Windows)")
    expect(workflow).toContain("npm pack --silent")
    expect(workflow).toContain("test -f")
    expect(workflow).toContain("npm install --silent --prefix")
    expect(workflow).toContain("node_modules/@iam-brain/opencode-codex-auth/dist/bin/opencode-codex-auth.js")
    expect(workflow).toContain("node")
  })

  it("vitest config isolates HOME/XDG test environment", () => {
    const vitestPath = join(process.cwd(), "vitest.config.ts")
    const vitestConfig = readFileSync(vitestPath, "utf-8")
    expect(vitestConfig).toMatch(/setupFiles:\s*\[\s*["']test\/setup-env\.ts["']\s*\]/)
    expect(existsSync(join(process.cwd(), "test", "setup-env.ts"))).toBe(true)
    expect(existsSync(join(process.cwd(), "test", "helpers", "isolate-env.ts"))).toBe(true)
  })
})
