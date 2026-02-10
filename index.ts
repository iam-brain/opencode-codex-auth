import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import {
  listAccountsForTools,
  removeAccountByIndex,
  switchAccountByIndex,
  toggleAccountEnabledByIndex
} from "./lib/accounts-tools"
import { CodexAuthPlugin, refreshAccessToken } from "./lib/codex-native"
import {
  getCompatInputSanitizerEnabled,
  getCustomSettings,
  getDebugEnabled,
  getHeaderSnapshotsEnabled,
  getMode,
  getPidOffsetEnabled,
  getPersonality,
  getProactiveRefreshBufferMs,
  getProactiveRefreshEnabled,
  getSpoofMode,
  getQuietMode,
  loadConfigFile,
  resolveConfig
} from "./lib/config"
import { createLogger } from "./lib/logger"
import { runOneProactiveRefreshTick } from "./lib/proactive-refresh"
import { toolOutputForStatus } from "./lib/codex-status-tool"
import { requireOpenAIMultiOauthAuth, saveAuthStorage } from "./lib/storage"
import { switchToolMessage } from "./lib/tools-output"

let scheduler: { stop: () => void } | undefined

export const OpenAIMultiAuthPlugin: Plugin = async (input) => {
  if (scheduler) {
    scheduler.stop()
    scheduler = undefined
  }

  const cfg = resolveConfig({
    env: process.env,
    file: loadConfigFile({ env: process.env })
  })
  const log = createLogger({ debug: getDebugEnabled(cfg) })

  if (getProactiveRefreshEnabled(cfg)) {
    const bufferMs = getProactiveRefreshBufferMs(cfg)
    const timer = setInterval(() => {
      runOneProactiveRefreshTick({
        now: Date.now,
        bufferMs,
        refresh: async (refreshToken) => {
          const tokens = await refreshAccessToken(refreshToken)
          return {
            access: tokens.access_token,
            refresh: tokens.refresh_token,
            expires: Date.now() + (tokens.expires_in ?? 3600) * 1000
          }
        }
      }).catch(() => {})
    }, 60_000)
    scheduler = { stop: () => clearInterval(timer) }
  }

  log.debug("plugin init")
  const hooks = await CodexAuthPlugin(input, {
    log,
    personality: getPersonality(cfg),
    mode: getMode(cfg),
    quietMode: getQuietMode(cfg),
    pidOffsetEnabled: getPidOffsetEnabled(cfg),
    spoofMode: getSpoofMode(cfg),
    compatInputSanitizer: getCompatInputSanitizerEnabled(cfg),
    headerSnapshots: getHeaderSnapshotsEnabled(cfg),
    customSettings: getCustomSettings(cfg)
  })

  const z = tool.schema

  hooks.tool = {
    ...hooks.tool,
    "codex-status": tool({
      description: "Show the status and usage limits of all configured Codex accounts.",
      args: {},
      execute: async () => {
        return toolOutputForStatus()
      }
    }),
    "codex-switch-accounts": tool({
      description: "Switch the active OpenAI account by 1-based index.",
      args: { index: z.number().int().min(1) },
      execute: async ({ index }) => {
        let message = ""

        await saveAuthStorage(undefined, (authFile) => {
          const openai = requireOpenAIMultiOauthAuth(authFile)
          const row = listAccountsForTools(openai)[index - 1]
          const next = switchAccountByIndex(openai, index)
          authFile.openai = next
          message = switchToolMessage({ email: row?.email, plan: row?.plan, index1: index })
        })

        return message
      }
    }),
    "codex-toggle-account": tool({
      description: "Toggle enabled/disabled for an OpenAI account by 1-based index.",
      args: { index: z.number().int().min(1) },
      execute: async ({ index }) => {
        let message = ""

        await saveAuthStorage(undefined, (authFile) => {
          const openai = requireOpenAIMultiOauthAuth(authFile)
          const row = listAccountsForTools(openai)[index - 1]
          const next = toggleAccountEnabledByIndex(openai, index)
          authFile.openai = next
          const label = row?.email ?? "account"
          const plan = row?.plan ? ` (${row.plan})` : ""
          const enabled = listAccountsForTools(next).find((r) => r.identityKey === row?.identityKey)?.enabled === true
          message = `Toggled #${index}: ${label}${plan} -> ${enabled ? "enabled" : "disabled"}`
        })

        return message
      }
    }),
    "codex-remove-account": tool({
      description: "Remove an OpenAI account by 1-based index (requires confirm).",
      args: { index: z.number().int().min(1), confirm: z.boolean().optional() },
      execute: async ({ index, confirm }) => {
        if (confirm !== true) {
          return "Refusing to remove account without confirm: true"
        }

        let message = ""

        await saveAuthStorage(undefined, (authFile) => {
          const openai = requireOpenAIMultiOauthAuth(authFile)
          const row = listAccountsForTools(openai)[index - 1]
          const next = removeAccountByIndex(openai, index)
          authFile.openai = next
          const label = row?.email ?? "account"
          const plan = row?.plan ? ` (${row.plan})` : ""
          message = `Removed #${index}: ${label}${plan}`
        })

        return message
      }
    })
  }

  return hooks
}

export default OpenAIMultiAuthPlugin
