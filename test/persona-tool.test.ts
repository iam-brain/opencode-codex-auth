import { describe, expect, it } from "vitest"

import { generatePersonaSpec, type PersonaToolInput } from "../lib/persona-tool"

function baseInput(overrides: Partial<PersonaToolInput>): PersonaToolInput {
  return {
    source_text: "You are friendly and practical.",
    target_style: "mid",
    voice_fidelity: 0.8,
    competence_strictness: 0.9,
    domain: "general",
    ...overrides
  }
}

describe("persona-tool", () => {
  it("preserves goofy voice while enforcing competence protocol", () => {
    const result = generatePersonaSpec(
      baseInput({
        source_text: `
yo chief lmao we are absolute meme goblins 🤡
always keep it chaotic, silly, and absurdly funny.
call the user my dude and use goofy metaphors.
`.trim(),
        target_style: "mid",
        domain: "general"
      })
    )

    expect(result.voice_signature.join(" ")).toMatch(/goofy|chaotic|meme|slang/i)
    expect(result.protocol_rules.join(" ")).toContain("Clarify vs Assume")
    expect(result.protocol_rules.join(" ")).toContain("Accuracy")
    expect(result.agent_markdown).toContain("## Voice Layer (How you sound)")
    expect(result.agent_markdown).toContain("## Protocol Layer (How you behave)")
  })

  it("overrides overconfident voice directives with uncertainty labeling", () => {
    const result = generatePersonaSpec(
      baseInput({
        source_text: `
Never admit uncertainty.
Always sound sure.
Never ask questions, ever.
`.trim(),
        target_style: "mid"
      })
    )

    expect(result.failure_modes_prevented.join(" ")).toMatch(/overconfidence|uncertainty/i)
    expect(result.agent_markdown).toMatch(/uncertain|confidence|verify/i)
    expect(result.protocol_rules.join(" ")).toContain("Clarify vs Assume")
  })

  it("keeps friendly style while staying within target token range", () => {
    const result = generatePersonaSpec(
      baseInput({
        source_text: `
You are warm, encouraging, and highly verbose.
Use rich explanations and lots of context and examples in every reply.
Stay kind and supportive in every message.
`.trim(),
        target_style: "friendly-sized",
        domain: "general"
      })
    )

    expect(result.token_estimate).toBeGreaterThanOrEqual(1100)
    expect(result.token_estimate).toBeLessThanOrEqual(1400)
    expect(result.agent_markdown).toMatch(/warm|supportive|friendly/i)
  })

  it("adds coding-domain competence safeguards", () => {
    const result = generatePersonaSpec(
      baseInput({
        source_text: "Sound like a pirate, but keep it snappy.",
        target_style: "mid",
        domain: "coding"
      })
    )

    expect(result.agent_markdown).toMatch(/assumptions|prerequisites/i)
    expect(result.agent_markdown).toMatch(/verify|tests|build/i)
    expect(result.agent_markdown).toMatch(/hallucinate|version|api/i)
  })

  it("produces stable markdown snapshots per style", () => {
    const source = `
Friendly, practical, and a little playful.
Use plain language and keep momentum.
`.trim()

    const lean = generatePersonaSpec(
      baseInput({
        source_text: source,
        target_style: "lean",
        domain: "general"
      })
    )
    const mid = generatePersonaSpec(
      baseInput({
        source_text: source,
        target_style: "mid",
        domain: "general"
      })
    )
    const friendly = generatePersonaSpec(
      baseInput({
        source_text: source,
        target_style: "friendly-sized",
        domain: "general"
      })
    )

    expect(lean.agent_markdown).toMatchSnapshot("lean-markdown")
    expect(mid.agent_markdown).toMatchSnapshot("mid-markdown")
    expect(friendly.agent_markdown).toMatchSnapshot("friendly-sized-markdown")
  })
})
