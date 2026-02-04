import type { Plugin } from "@opencode-ai/plugin"

export const OpenAIMultiAuthPlugin: Plugin = async () => ({
  auth: {
    provider: "openai",
    methods: []
  }
})

export default OpenAIMultiAuthPlugin
