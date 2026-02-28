import fs from "node:fs/promises"
import path from "node:path"

const filePath = path.join(process.cwd(), "node_modules", "@opencode-ai", "plugin", "dist", "index.d.ts")

async function patchPluginTypes() {
  let raw
  try {
    raw = await fs.readFile(filePath, "utf8")
  } catch {
    return
  }

  const patched = raw
    .replaceAll('from "./shell";', 'from "./shell.js";')
    .replaceAll('from "./tool";', 'from "./tool.js";')
    .replaceAll('from "./tool";', 'from "./tool.js";')
    .replaceAll('export * from "./tool";', 'export * from "./tool.js";')

  if (patched !== raw) {
    await fs.writeFile(filePath, patched, "utf8")
  }
}

await patchPluginTypes()
