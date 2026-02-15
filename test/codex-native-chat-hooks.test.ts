import { describe, expect, it } from "vitest"

import { handleChatParamsHook } from "../lib/codex-native/chat-hooks"

describe("codex-native chat hooks instruction source order", () => {
  it("prefers cached catalog instructions over model.instructions and default codexInstructions", async () => {
    const modelOptions: Record<string, unknown> = {
      codexCatalogModel: {
        slug: "gpt-5.3-codex",
        model_messages: {
          instructions_template: "{{ unsupported_marker }}"
        }
      },
      codexInstructions: "Default codex-instructions"
    }

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {
        instructions: "OpenCode Host Instructions"
      }
    }

    await handleChatParamsHook({
      hookInput: {
        model: {
          id: "gpt-5.3-codex",
          api: { id: "gpt-5.3-codex" },
          providerID: "openai",
          instructions: "Model Instructions From GitHub",
          capabilities: { toolcall: true },
          options: modelOptions
        } as any,
        message: {}
      },
      output: output as any,
      lastCatalogModels: [
        {
          slug: "gpt-5.3-codex",
          model_messages: {
            instructions_template: "Cached template instructions"
          }
        }
      ],
      spoofMode: "codex",
      collaborationProfileEnabled: false,
      orchestratorSubagentsEnabled: false,
      collaborationToolProfile: "opencode"
    })

    expect(output.options.instructions).toBe("Cached template instructions")
    expect(modelOptions.codexInstructions).toBe("Cached template instructions")
  })
})
