import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { CodexAuthPlugin } from "./lib/codex-native"
import { toolOutputForStatus } from "./lib/codex-status-tool"

export const OpenAIMultiAuthPlugin: Plugin = async (input) => {
  const hooks = await CodexAuthPlugin(input)

  hooks.tool = {
    ...hooks.tool,
    "codex-status": tool({
      description: "Show the status and usage limits of all configured Codex accounts.",
      args: {},
      execute: async () => {
        return toolOutputForStatus()
      }
    })
  }

  return hooks
}

export default OpenAIMultiAuthPlugin
