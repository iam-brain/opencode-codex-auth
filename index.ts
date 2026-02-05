import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { removeAccountByIndex, switchAccountByIndex, toggleAccountEnabledByIndex } from "./lib/accounts-tools"
import { CodexAuthPlugin } from "./lib/codex-native"
import { toolOutputForStatus } from "./lib/codex-status-tool"
import { requireOpenAIMultiOauthAuth, saveAuthStorage } from "./lib/storage"
import { switchToolMessage } from "./lib/tools-output"

export const OpenAIMultiAuthPlugin: Plugin = async (input) => {
  const hooks = await CodexAuthPlugin(input)

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
          const target = openai.accounts[index - 1]
          const next = switchAccountByIndex(openai, index)
          authFile.openai = next
          message = switchToolMessage({ email: target?.email, plan: target?.plan, index1: index })
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
          const target = openai.accounts[index - 1]
          const next = toggleAccountEnabledByIndex(openai, index)
          authFile.openai = next
          const label = target?.email ?? "account"
          const plan = target?.plan ? ` (${target.plan})` : ""
          const enabled = next.accounts[index - 1]?.enabled !== false
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
          const target = openai.accounts[index - 1]
          const next = removeAccountByIndex(openai, index)
          authFile.openai = next
          const label = target?.email ?? "account"
          const plan = target?.plan ? ` (${target.plan})` : ""
          message = `Removed #${index}: ${label}${plan}`
        })

        return message
      }
    })
  }

  return hooks
}

export default OpenAIMultiAuthPlugin
