#!/usr/bin/env node

import { rm } from "node:fs/promises"

try {
  await rm("dist", { recursive: true, force: true })
} catch {
  // best-effort cleanup
}
