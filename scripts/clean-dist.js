#!/usr/bin/env node

import { rm } from "node:fs/promises"

try {
  await rm("dist", { recursive: true, force: true })
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error
  }
}
