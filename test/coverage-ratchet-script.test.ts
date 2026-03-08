import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

const scriptPath = path.resolve(process.cwd(), "scripts/check-coverage-ratchet.mjs")

describe("coverage ratchet script", () => {
  it("uses explicit touched files from the environment instead of falling back to git ranges", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-coverage-ratchet-"))
    await fs.mkdir(path.join(root, "scripts"), { recursive: true })
    await fs.mkdir(path.join(root, "coverage"), { recursive: true })

    await fs.writeFile(
      path.join(root, "scripts", "coverage-ratchet.config.json"),
      JSON.stringify(
        {
          baselinePath: "scripts/coverage-ratchet.baseline.json",
          regressionTolerancePct: 1
        },
        null,
        2
      ),
      "utf8"
    )
    await fs.writeFile(
      path.join(root, "scripts", "coverage-ratchet.baseline.json"),
      JSON.stringify(
        {
          files: {
            "lib/kept.ts": {
              lines: 90,
              branches: 90,
              functions: 90,
              statements: 90
            },
            "lib/regressed.ts": {
              lines: 90,
              branches: 90,
              functions: 90,
              statements: 90
            }
          }
        },
        null,
        2
      ),
      "utf8"
    )
    await fs.writeFile(
      path.join(root, "coverage", "coverage-summary.json"),
      JSON.stringify(
        {
          total: {
            lines: { pct: 80 },
            branches: { pct: 80 },
            functions: { pct: 80 },
            statements: { pct: 80 }
          },
          "lib/kept.ts": {
            lines: { pct: 95 },
            branches: { pct: 95 },
            functions: { pct: 95 },
            statements: { pct: 95 }
          },
          "lib/regressed.ts": {
            lines: { pct: 10 },
            branches: { pct: 10 },
            functions: { pct: 10 },
            statements: { pct: 10 }
          }
        },
        null,
        2
      ),
      "utf8"
    )

    const result = spawnSync("node", [scriptPath], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        COVERAGE_RATCHET_TOUCHED_FILES: "lib/kept.ts\n"
      }
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Compared 1 touched existing source file(s).")
  })
})
