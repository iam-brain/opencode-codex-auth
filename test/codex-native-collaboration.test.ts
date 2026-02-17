import { describe, expect, it } from "vitest"

import {
  isOrchestratorInstructions,
  mergeInstructions,
  resolveCollaborationInstructions,
  resolveCollaborationProfile,
  resolveSubagentHeaderValue,
  resolveToolingInstructions
} from "../lib/codex-native/collaboration"

describe("codex collaboration profile", () => {
  it("maps plan agent to plan mode", () => {
    const profile = resolveCollaborationProfile("plan")
    expect(profile.enabled).toBe(true)
    expect(profile.kind).toBe("plan")
  })

  it("maps orchestrator agent to code mode", () => {
    const profile = resolveCollaborationProfile("Orchestrator")
    expect(profile.enabled).toBe(true)
    expect(profile.kind).toBe("code")
  })

  it("does not enable profile for unrelated build agent", () => {
    const profile = resolveCollaborationProfile("build")
    expect(profile.enabled).toBe(false)
  })

  it("maps codex review helper to review subagent header", () => {
    expect(resolveSubagentHeaderValue("Codex Review")).toBe("review")
  })

  it("does not emit subagent header for plan/orchestrator primaries", () => {
    expect(resolveSubagentHeaderValue("plan")).toBeUndefined()
    expect(resolveSubagentHeaderValue("orchestrator")).toBeUndefined()
  })

  it("selects mode instructions by collaboration kind", () => {
    const instructions = {
      plan: "PLAN",
      code: "CODE"
    }
    expect(resolveCollaborationInstructions("plan", instructions)).toBe("PLAN")
    expect(resolveCollaborationInstructions("code", instructions)).toBe("CODE")
  })

  it("merges instructions once without duplicating", () => {
    const merged = mergeInstructions("base", "extra")
    expect(merged).toBe("base\n\nextra")
    expect(mergeInstructions(merged, "extra")).toBe("base\n\nextra")
  })

  it("resolves tooling profiles", () => {
    expect(resolveToolingInstructions("opencode")).toContain("Tooling Compatibility (OpenCode)")
    expect(resolveToolingInstructions("codex")).toContain("Tooling Compatibility (Codex-style)")
  })

  it("detects orchestrator-style upstream instructions", () => {
    expect(
      isOrchestratorInstructions(
        [
          "You are Codex, a coding agent based on GPT-5.",
          "",
          "# Sub-agents",
          "If `spawn_agent` is unavailable or fails, ignore this section and proceed solo."
        ].join("\n")
      )
    ).toBe(true)
    expect(isOrchestratorInstructions("Catalog instructions\n\n# Plan Mode (Conversational)")).toBe(false)
  })
})
