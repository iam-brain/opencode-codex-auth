import { describe, expect, it } from "vitest"

import {
  CODEX_PLAN_MODE_INSTRUCTIONS_FALLBACK,
  hasCodexToolNameMarkers,
  isOrchestratorInstructions,
  mergeInstructions,
  replaceCodexToolCallsForOpenCode,
  resolveCollaborationInstructions,
  resolveCollaborationProfile,
  resolveSubagentHeaderValue
} from "../lib/codex-native/collaboration"

describe("codex collaboration profile", () => {
  it("keeps fallback plan instructions runtime-safe", () => {
    expect(CODEX_PLAN_MODE_INSTRUCTIONS_FALLBACK).toContain("# Plan Mode")
    expect(CODEX_PLAN_MODE_INSTRUCTIONS_FALLBACK).not.toContain("request_user_input")
    expect(CODEX_PLAN_MODE_INSTRUCTIONS_FALLBACK).not.toContain("<proposed_plan>")
  })

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

  it("does not map build agent to plan preset", () => {
    const profile = resolveCollaborationProfile("build")
    expect(profile.instructionPreset).toBeUndefined()
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

  it("detects codex tool names and replaces with OpenCode tool names", () => {
    const codexInstructions = "Use spawn_agent and send_input to coordinate workers."
    expect(hasCodexToolNameMarkers(codexInstructions)).toBe(true)
    expect(replaceCodexToolCallsForOpenCode(codexInstructions)).toContain("task")
    expect(replaceCodexToolCallsForOpenCode(codexInstructions)).not.toContain("spawn_agent")

    const replaced = replaceCodexToolCallsForOpenCode(codexInstructions)
    expect(replaced).toContain("task")

    const writeStdin = "If needed, call write_stdin to continue the worker session."
    expect(hasCodexToolNameMarkers(writeStdin)).toBe(true)
    expect(replaceCodexToolCallsForOpenCode(writeStdin)).toContain("task")

    const plainInstructions = "Use available tools in this runtime."
    expect(hasCodexToolNameMarkers(plainInstructions)).toBe(false)
    expect(replaceCodexToolCallsForOpenCode(plainInstructions)).toBe(plainInstructions)
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
    expect(
      isOrchestratorInstructions(
        [
          "---",
          "description: Codex-style orchestration profile for parallel delegation and synthesis.",
          "mode: primary",
          "---"
        ].join("\n")
      )
    ).toBe(true)
    expect(isOrchestratorInstructions("Catalog instructions\n\n# Plan Mode (Conversational)")).toBe(false)
    expect(
      isOrchestratorInstructions(
        [
          "Any lead-in",
          "# Sub-agents",
          "If spawn_agent fails, proceed solo.",
          "Coordinate subagent workers and synthesize output."
        ].join("\n")
      )
    ).toBe(true)
    expect(
      isOrchestratorInstructions(
        ["Any lead-in", "# Sub-agents", "Coordinate them via wait / send_input.", "General guidance only."].join("\n")
      )
    ).toBe(true)
    expect(
      isOrchestratorInstructions(
        [
          "Team playbook",
          "# Sub-agents",
          "Ask a subagent to summarize docs for context.",
          "An orchestrator can help planning discussions."
        ].join("\n")
      )
    ).toBe(false)
    expect(
      isOrchestratorInstructions(
        [
          "Operations note",
          "# Sub-agents",
          "Please wait for approval before deploy.",
          "Then send_input from the release form."
        ].join("\n")
      )
    ).toBe(false)
  })
})
