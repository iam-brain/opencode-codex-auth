import { describe, expect, it } from "vitest"

import { runCodexInVivoInstructionProbe } from "./helpers/codex-in-vivo"

describe("codex-native in-vivo instruction injection", () => {
  it("replaces host instructions and sends personality-rendered instructions in codex mode", async () => {
    const result = await runCodexInVivoInstructionProbe({
      hostInstructions: "OpenCode Host Instructions",
      personalityKey: "vivo_persona",
      personalityText: "Vivo Persona Voice"
    })

    expect(result.preflightInstructions).toBe("Base Vivo Persona Voice")
    expect(result.outboundInstructions).toBe("Base Vivo Persona Voice")
    expect(result.outboundInstructions).not.toBe("OpenCode Host Instructions")
    expect(result.outboundUrl).toBe("https://chatgpt.com/backend-api/codex/responses")
    expect(result.outboundOriginator).toMatch(/^codex_/)
    expect(result.outboundUserAgent).toMatch(/^codex_/)
  })

  it("replaces host instructions at outbound even when model options are stripped", async () => {
    const result = await runCodexInVivoInstructionProbe({
      hostInstructions: "OpenCode Host Instructions",
      personalityKey: "vivo_persona",
      personalityText: "Vivo Persona Voice",
      stripModelOptionsBeforeParams: true,
      modelInstructionsFallback: "OpenCode Host Instructions",
      omitModelIdentityBeforeParams: true
    })

    expect(result.preflightInstructions).toBe("OpenCode Host Instructions")
    expect(result.outboundInstructions).toBe("Base Vivo Persona Voice")
    expect(result.outboundInstructions).not.toBe("OpenCode Host Instructions")
  })
})
