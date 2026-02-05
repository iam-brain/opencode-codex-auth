import { describe, it, expect } from "vitest"

import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("release hygiene", () => {
  it("package.json has verify script", () => {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    expect(pkg.scripts?.verify).toBe("npm run typecheck && npm test && npm run build")
  })
})
