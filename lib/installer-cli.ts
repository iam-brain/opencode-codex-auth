import path from "node:path"

import { installCreatePersonalityCommand } from "./personality-command.js"
import { installPersonalityBuilderSkill } from "./personality-skill.js"
import {
  ensureDefaultConfigFile,
  getCollaborationProfileEnabled,
  getMode,
  loadConfigFile,
  resolveConfig
} from "./config.js"
import { reconcileOrchestratorAgentVisibility } from "./orchestrator-agent.js"
import { DEFAULT_PLUGIN_SPECIFIER, defaultOpencodeConfigPath, ensurePluginInstalled } from "./opencode-install.js"
import { refreshCachedCodexPrompts } from "./codex-prompts-cache.js"

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
  configPath?: string
  pluginSpecifier?: string
} {
  const command = args[0] && !args[0].startsWith("-") ? args[0] : "install"
  const tail = command === "install" ? args.slice(1) : args
  let configPath: string | undefined
  let pluginSpecifier: string | undefined
  for (let i = 0; i < tail.length; i += 1) {
    const token = tail[i]
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
  return { command, configPath, pluginSpecifier }
}

function helpText(): string {
  return [
    "opencode-codex-auth installer",
    "",
    "Usage:",
    "  opencode-codex-auth install [--config <path>] [--plugin <specifier>]",
    "",
    "Commands:",
    "  install         Install plugin entry in opencode.json plus personality command/skill scaffolding.",
    "",
    "Options:",
    "  --config <path> Custom opencode.json path (defaults to $XDG_CONFIG_HOME/opencode/opencode.json when set, otherwise ~/.config/opencode/opencode.json).",
    `  --plugin <spec> Plugin specifier for opencode.json (default: ${DEFAULT_PLUGIN_SPECIFIER}).`
  ].join("\n")
}

export async function runInstallerCli(args: string[], io: InstallerIo = DEFAULT_IO): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.out(helpText())
    return 0
  }

  const parsed = parseArgs(args)
  if (parsed.command !== "install") {
    io.err(`Unknown command: ${parsed.command}`)
    io.err("")
    io.err(helpText())
    return 1
  }

  const configPath = parsed.configPath ? path.resolve(parsed.configPath) : defaultOpencodeConfigPath()
  const pluginResult = await ensurePluginInstalled({
    configPath,
    pluginSpecifier: parsed.pluginSpecifier ?? DEFAULT_PLUGIN_SPECIFIER
  })

  io.out(`OpenCode config: ${pluginResult.configPath}`)
  io.out(`Plugin specifier: ${pluginResult.pluginSpecifier}`)
  io.out(`OpenCode config created: ${pluginResult.created ? "yes" : "no"}`)
  io.out(`OpenCode config updated: ${pluginResult.changed ? "yes" : "no"}`)

  const defaultConfig = await ensureDefaultConfigFile({ env: process.env })
  io.out(`Codex config: ${defaultConfig.filePath}`)
  io.out(`Codex config created: ${defaultConfig.created ? "yes" : "no"}`)

  const commandResult = await installCreatePersonalityCommand({ force: true })
  io.out(`Commands directory: ${commandResult.commandsDir}`)
  io.out(
    `/create-personality synchronized: ${
      commandResult.created ? "created" : commandResult.updated ? "updated" : "unchanged"
    }`
  )

  const skillResult = await installPersonalityBuilderSkill({ force: true })
  io.out(`Skills directory: ${skillResult.skillsDir}`)
  io.out(
    `personality-builder skill synchronized: ${
      skillResult.created ? "created" : skillResult.updated ? "updated" : "unchanged"
    }`
  )

  const promptsResult = await refreshCachedCodexPrompts({ forceRefresh: true })
  io.out(`Codex prompts cache synchronized: ${promptsResult.orchestrator && promptsResult.plan ? "yes" : "fallback"}`)

  const resolvedConfig = resolveConfig({
    env: process.env,
    file: loadConfigFile({ env: process.env })
  })
  const runtimeMode = getMode(resolvedConfig)
  const collaborationProfileEnabled = getCollaborationProfileEnabled(resolvedConfig)
  const orchestratorResult = await reconcileOrchestratorAgentVisibility({ visible: collaborationProfileEnabled })
  io.out(`Orchestrator agent file: ${orchestratorResult.filePath}`)
  io.out(
    `Orchestrator agent visible in current mode (${runtimeMode}, collaboration=${collaborationProfileEnabled ? "on" : "off"}): ${
      orchestratorResult.visible ? "yes" : "no"
    }`
  )

  return 0
}
