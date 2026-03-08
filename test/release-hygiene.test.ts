import { describe, it, expect } from "vitest"

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const REQUIRED_RELEASE_RUNTIME_CI_JOBS = [
  "Verify (Node.js 22.x)",
  "Package Smoke Test",
  "Windows Compatibility Smoke",
  "Security Audit"
]
const REQUIRED_WORKFLOW_STATIC_JOB_NAMES = ["Package Smoke Test", "Windows Compatibility Smoke", "Security Audit"]
const REQUIRED_PR_CI_JOB_NAMES = ["Verify (Node.js 22.x)", "Package Smoke Test", "Windows Compatibility Smoke"]

describe("release hygiene", () => {
  it("package.json has verify script", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    const verifyScript = String(pkg.scripts?.verify ?? "")
    expect(pkg.scripts?.["verify:local"]).toBe("node scripts/enforce-local-verify.mjs manual")
    expect(pkg.scripts?.prepush).toBe("npm run verify:local")
    expect(pkg.scripts?.["hooks:install"]).toBe("node scripts/install-git-hooks.mjs")
    const verifyOrder = [
      "npm run check:esm-imports",
      "npm run lint",
      "npm run format:check",
      "npm run typecheck",
      "npm run typecheck:test",
      "npm run test:anti-mock",
      "npm run test:coverage",
      "npm run check:coverage-ratchet",
      "npm run check:docs",
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
    expect(pkg.scripts?.["check:dist-esm-imports"]).toBe("node scripts/check-esm-import-specifiers.mjs --dist")
    expect(pkg.scripts?.["smoke:cli:dist"]).toBe("node ./dist/bin/opencode-codex-auth.js --help")
    expect(pkg.scripts?.["test:coverage"]).toBe("vitest run --coverage.enabled true --coverage.provider=v8")
    expect(pkg.scripts?.["patch:plugin-dts"]).toBe("node scripts/patch-opencode-plugin-dts.js")
    expect(pkg.scripts?.typecheck).toContain("npm run patch:plugin-dts")
    expect(pkg.scripts?.["typecheck:test"]).toContain("npm run patch:plugin-dts")
    expect(pkg.scripts?.["check:file-size"]).toBeUndefined()
    expect(pkg.scripts?.prepack).toBe("npm run build")
    expect(pkg.scripts?.build).toBe("npm run patch:plugin-dts && npm run clean:dist && tsc")
    expect(pkg.scripts?.["clean:dist"]).toBe("node scripts/clean-dist.js")
    expect(existsSync(join(process.cwd(), "scripts", "clean-dist.js"))).toBe(true)
    expect(existsSync(join(process.cwd(), "scripts", "enforce-local-verify.mjs"))).toBe(true)
    expect(existsSync(join(process.cwd(), "scripts", "install-git-hooks.mjs"))).toBe(true)
    expect(existsSync(join(process.cwd(), "scripts", "check-esm-import-specifiers.mjs"))).toBe(true)
    expect(existsSync(join(process.cwd(), "scripts", "check-dist-esm-import-specifiers.mjs"))).toBe(false)
    expect(existsSync(join(process.cwd(), "scripts", "check-file-size.mjs"))).toBe(false)
    expect(existsSync(join(process.cwd(), "scripts", "file-size-allowlist.json"))).toBe(false)
    expect(existsSync(join(process.cwd(), ".githooks", "pre-commit"))).toBe(true)
    expect(existsSync(join(process.cwd(), ".githooks", "pre-push"))).toBe(true)
    expect((statSync(join(process.cwd(), ".githooks", "pre-commit")).mode & 0o111) !== 0).toBe(true)
    expect((statSync(join(process.cwd(), ".githooks", "pre-push")).mode & 0o111) !== 0).toBe(true)
    expect(readFileSync(join(process.cwd(), ".githooks", "pre-commit"), "utf-8")).toContain(
      "node scripts/enforce-local-verify.mjs pre-commit"
    )
    expect(readFileSync(join(process.cwd(), ".githooks", "pre-push"), "utf-8")).toContain(
      "node scripts/enforce-local-verify.mjs pre-push"
    )
    expect(
      execFileSync("git", ["ls-files", "--error-unmatch", ".githooks/pre-commit"], {
        cwd: process.cwd(),
        encoding: "utf-8"
      }).trim()
    ).toBe(".githooks/pre-commit")
    expect(
      execFileSync("git", ["ls-files", "--error-unmatch", ".githooks/pre-push"], {
        cwd: process.cwd(),
        encoding: "utf-8"
      }).trim()
    ).toBe(".githooks/pre-push")
  })

  it("coverage ratchet config stays regression-only", () => {
    const configPath = join(process.cwd(), "scripts", "coverage-ratchet.config.json")
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(config.baselinePath).toBe("scripts/coverage-ratchet.baseline.json")
    expect(config.regressionTolerancePct).toBe(1)
    expect(config.globalThresholds).toBeUndefined()
    expect(config.milestones).toBeUndefined()
  })

  it("coverage ratchet script does not enforce repo-wide floors", () => {
    const scriptPath = join(process.cwd(), "scripts", "check-coverage-ratchet.mjs")
    const script = readFileSync(scriptPath, "utf-8")
    expect(script).toContain("function isCoveredSourceFile(filePath)")
    expect(script).toContain(
      'return filePath === "index.ts" || (filePath.startsWith("lib/") && filePath.endsWith(".ts"))'
    )
    expect(script).toContain("Compared ${comparedFiles} touched existing source file(s).")
    expect(script).not.toContain("const globalThresholds = config.globalThresholds")
    expect(script).not.toContain("Global ")
    expect(script).not.toContain("missing coverage baseline entry")
    expect(script).not.toContain('rangeCandidates.push("origin/main...HEAD")')
  })

  it("declares the Node engine aligned with CI", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    expect(pkg.engines?.node).toBe(">=22 <23")
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
    expect(workflow).toContain("Verify (Node.js 22.x)")
    expect(workflow).not.toMatch(/node-version:\s*\[\s*20\.x\s*,\s*22\.x\s*\]/)
    for (const job of REQUIRED_WORKFLOW_STATIC_JOB_NAMES) {
      expect(workflow).toContain(job)
    }
  })

  it("keeps PR CI lean while retaining security audit on main pushes", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "ci.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    expect(workflow).toMatch(/on:\s*\n\s+push:\s*\n\s+branches:\s*\n\s+-\s+main\s*\n\s+pull_request:/)
    for (const job of REQUIRED_PR_CI_JOB_NAMES) {
      expect(workflow).toContain(job)
    }
    const securityAuditBlock = workflow
      .split(/\n/)
      .slice(workflow.split(/\n/).findIndex((line) => line.includes("security-audit:")))
      .join("\n")
    expect(securityAuditBlock).toContain("name: Security Audit")
    expect(securityAuditBlock).toContain("if: github.event_name == 'push'")
    expect(securityAuditBlock).toContain("npm audit --audit-level=high")
  })

  it("keeps dependency review and secret scanning on pull requests", () => {
    const dependencyReviewWorkflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "dependency-review.yml"),
      "utf-8"
    )
    const secretScanWorkflow = readFileSync(join(process.cwd(), ".github", "workflows", "secret-scan.yml"), "utf-8")
    expect(dependencyReviewWorkflow).toMatch(/on:\s*\n\s+pull_request:/)
    expect(dependencyReviewWorkflow).toContain("name: Dependency Review")
    expect(secretScanWorkflow).toMatch(/on:\s*\n\s+push:\s*\n\s+branches:\s*\n\s+-\s+main\s*\n\s+pull_request:/)
    expect(secretScanWorkflow).toContain("name: Secret Scan")
    expect(secretScanWorkflow).toContain("name: Gitleaks")
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
    expect(workflow).toContain("if: github.event_name == 'push'")
    expect(workflow).toContain("npm audit --audit-level=high")
    expect(workflow).not.toContain("npm audit --omit=dev")
  })

  it("ci package smoke executes packed CLI tarball", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "ci.yml")
    const workflow = readFileSync(workflowPath, "utf-8")
    expect(workflow).toContain("Pack and execute CLI tarball")
    expect(workflow).toContain("Windows Compatibility Smoke")
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

  it("uses regression-only coverage enforcement", () => {
    const vitestConfig = readFileSync(join(process.cwd(), "vitest.config.ts"), "utf-8")
    const ratchetScript = readFileSync(join(process.cwd(), "scripts", "check-coverage-ratchet.mjs"), "utf-8")
    const ratchetConfig = JSON.parse(
      readFileSync(join(process.cwd(), "scripts", "coverage-ratchet.config.json"), "utf-8")
    ) as {
      regressionTolerancePct?: unknown
      globalThresholds?: unknown
      milestones?: unknown
    }
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf-8")

    expect(vitestConfig).not.toContain("thresholds:")
    expect(ratchetScript).toContain("isCoveredSourceFile")
    expect(ratchetScript).not.toContain("const globalThresholds")
    expect(ratchetScript).not.toContain("origin/main...HEAD")
    expect(ratchetConfig.regressionTolerancePct).toBe(1)
    expect(ratchetConfig.globalThresholds).toBeUndefined()
    expect(ratchetConfig.milestones).toBeUndefined()
    expect(workflow).toContain("COVERAGE_RATCHET_BASE_REF")
    expect(workflow).toContain("COVERAGE_RATCHET_HEAD_REF")
  })
})
