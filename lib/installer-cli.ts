import path from "node:path"

import { defaultOpencodeAgentsDir, installOrchestratorAgents } from "./orchestrator-agents.js"
import {
  DEFAULT_PLUGIN_SPECIFIER,
  defaultOpencodeConfigPath,
  ensurePluginInstalled
} from "./opencode-install.js"

type InstallerIo = {
  out: (message: string) => void
  err: (message: string) => void
}

const DEFAULT_IO: InstallerIo = {
  out: (message) => process.stdout.write(`${message}\n`),
  err: (message) => process.stderr.write(`${message}\n`)
}

function parseArgs(args: string[]): {
  command: string
  force: boolean
  dir?: string
  configPath?: string
  pluginSpecifier?: string
} {
  const command = args[0] && !args[0].startsWith("-") ? args[0] : "install"
  const tail = command === "install" || command === "install-agents" ? args.slice(1) : args
  let force = false
  let dir: string | undefined
  let configPath: string | undefined
  let pluginSpecifier: string | undefined
  for (let i = 0; i < tail.length; i += 1) {
    const token = tail[i]
    if (token === "--force") {
      force = true
      continue
    }
    if (token === "--dir") {
      dir = tail[i + 1]
      i += 1
      continue
    }
    if (token.startsWith("--dir=")) {
      dir = token.slice("--dir=".length)
      continue
    }
    if (token === "--config") {
      configPath = tail[i + 1]
      i += 1
      continue
    }
    if (token.startsWith("--config=")) {
      configPath = token.slice("--config=".length)
      continue
    }
    if (token === "--plugin") {
      pluginSpecifier = tail[i + 1]
      i += 1
      continue
    }
    if (token.startsWith("--plugin=")) {
      pluginSpecifier = token.slice("--plugin=".length)
      continue
    }
  }
  return { command, force, dir, configPath, pluginSpecifier }
}

function helpText(): string {
  return [
    "opencode-openai-multi installer",
    "",
    "Usage:",
    "  opencode-openai-multi install [--force] [--dir <path>] [--config <path>] [--plugin <specifier>]",
    "  opencode-openai-multi install-agents [--force] [--dir <path>]",
    "",
    "Commands:",
    "  install         Install plugin entry in opencode.json and install Codex collaboration agents.",
    "  install-agents  Install local Codex collaboration agent templates.",
    "",
    "Options:",
    "  --force         Overwrite existing Codex*.md collaboration agent files.",
    "  --dir <path>    Custom agents directory (defaults to ~/.config/opencode/agents).",
    "  --config <path> Custom opencode.json path (defaults to ~/.config/opencode/opencode.json).",
    `  --plugin <spec> Plugin specifier for opencode.json (default: ${DEFAULT_PLUGIN_SPECIFIER}).`
  ].join("\n")
}

export async function runInstallerCli(args: string[], io: InstallerIo = DEFAULT_IO): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.out(helpText())
    return 0
  }

  const parsed = parseArgs(args)
  if (parsed.command !== "install" && parsed.command !== "install-agents") {
    io.err(`Unknown command: ${parsed.command}`)
    io.err("")
    io.err(helpText())
    return 1
  }

  if (parsed.command === "install") {
    const configPath = parsed.configPath
      ? path.resolve(parsed.configPath)
      : defaultOpencodeConfigPath()
    const pluginResult = await ensurePluginInstalled({
      configPath,
      pluginSpecifier: parsed.pluginSpecifier ?? DEFAULT_PLUGIN_SPECIFIER
    })

    io.out(`OpenCode config: ${pluginResult.configPath}`)
    io.out(`Plugin specifier: ${pluginResult.pluginSpecifier}`)
    io.out(`Config created: ${pluginResult.created ? "yes" : "no"}`)
    io.out(`Plugin updated: ${pluginResult.changed ? "yes" : "no"}`)
  }

  const agentsDir = parsed.dir ? path.resolve(parsed.dir) : defaultOpencodeAgentsDir()
  const result = await installOrchestratorAgents({
    agentsDir,
    force: parsed.force
  })

  io.out(`Agents directory: ${result.agentsDir}`)
  io.out(`Written: ${result.written.length}`)
  io.out(`Skipped: ${result.skipped.length}`)
  for (const filePath of result.written) {
    io.out(`  + ${filePath}`)
  }
  for (const filePath of result.skipped) {
    io.out(`  = ${filePath}`)
  }

  return 0
}
