import { describe, expect, it, vi } from "vitest"

import { CodexAuthPlugin } from "../lib/codex-native.js"
import {
  classifyAgentExecutionFallback,
  createAgentExecutionResolver,
  deletedSessionIDFromEvent,
  readAgentModes
} from "../lib/codex-native/agent-execution.js"

describe("Ultra agent execution classification", () => {
  it("classifies OpenCode built-ins without relying on Codex names", () => {
    expect(classifyAgentExecutionFallback({ agentName: "build" }).role).toBe("root")
    expect(classifyAgentExecutionFallback({ agentName: "general" }).role).toBe("child")
    expect(classifyAgentExecutionFallback({ agentName: "explore" }).role).toBe("child")
    expect(classifyAgentExecutionFallback({ agentName: "scout" }).role).toBe("child")
    expect(classifyAgentExecutionFallback({ agentName: "title" }).role).toBe("auxiliary")
    expect(classifyAgentExecutionFallback({ agentName: "summary" }).role).toBe("auxiliary")
    expect(classifyAgentExecutionFallback({ agentName: "compaction" }).role).toBe("auxiliary")
  })

  it("reads custom primary and subagent modes from OpenCode config", () => {
    const modes = readAgentModes({
      agent: {
        captain: { mode: "primary" },
        reviewer: { mode: "subagent" },
        flexible: { mode: "all" }
      }
    } as never)

    expect(classifyAgentExecutionFallback({ agentName: "captain", configuredModes: modes }).role).toBe("root")
    expect(classifyAgentExecutionFallback({ agentName: "reviewer", configuredModes: modes }).role).toBe("child")
    expect(classifyAgentExecutionFallback({ agentName: "flexible", configuredModes: modes }).role).toBe("child")
  })

  it("uses session lineage to distinguish mode:all root and child invocations", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "root" } })
      .mockResolvedValueOnce({ data: { id: "child", parentID: "root" } })
    const resolver = createAgentExecutionResolver({ client: { session: { get } } })
    resolver.updateConfig({ agent: { flexible: { mode: "all" } } } as never)

    await expect(resolver.resolve({ sessionID: "root", agentName: "flexible" })).resolves.toMatchObject({
      role: "root",
      reason: "session_root"
    })
    await expect(resolver.resolve({ sessionID: "child", agentName: "flexible" })).resolves.toMatchObject({
      role: "child",
      reason: "session_parent"
    })
  })

  it("caches lineage and invalidates it when a session is deleted", async () => {
    const get = vi.fn(async () => ({ data: { id: "child", parentID: "root" } }))
    const resolver = createAgentExecutionResolver({ client: { session: { get } } })

    await resolver.resolve({ sessionID: "child", agentName: "custom" })
    await resolver.resolve({ sessionID: "child", agentName: "custom" })
    expect(get).toHaveBeenCalledOnce()

    resolver.deleteSession("child")
    await resolver.resolve({ sessionID: "child", agentName: "custom" })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("shares concurrent lineage lookups for the same session", async () => {
    let release: ((value: { data: { id: string } }) => void) | undefined
    const get = vi.fn(
      () =>
        new Promise<{ data: { id: string } }>((resolve) => {
          release = resolve
        })
    )
    const resolver = createAgentExecutionResolver({ client: { session: { get } } })

    const first = resolver.resolve({ sessionID: "root", agentName: "custom" })
    const second = resolver.resolve({ sessionID: "root", agentName: "custom" })
    expect(get).toHaveBeenCalledOnce()
    release?.({ data: { id: "root" } })

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ role: "root", reason: "session_root" }),
      expect.objectContaining({ role: "root", reason: "session_root" })
    ])
  })

  it("does not restore deleted lineage from an in-flight lookup", async () => {
    let release: ((value: { data: { id: string } }) => void) | undefined
    const get = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ data: { id: string } }>((resolve) => {
            release = resolve
          })
      )
      .mockResolvedValue({ data: { id: "session", parentID: "parent" } })
    const resolver = createAgentExecutionResolver({ client: { session: { get } } })

    const stale = resolver.resolve({ sessionID: "session", agentName: "custom" })
    resolver.deleteSession("session")
    release?.({ data: { id: "session" } })
    await expect(stale).resolves.toMatchObject({
      role: "child",
      reason: "conservative_fallback"
    })

    await expect(resolver.resolve({ sessionID: "session", agentName: "custom" })).resolves.toMatchObject({
      role: "child",
      reason: "session_parent"
    })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("fails closed to child policy when lineage lookup is unavailable", async () => {
    const resolver = createAgentExecutionResolver({
      client: { session: { get: vi.fn(async () => ({ data: undefined, error: new Error("offline") })) } }
    })

    await expect(resolver.resolve({ sessionID: "unknown", agentName: "custom" })).resolves.toMatchObject({
      role: "child",
      reason: "conservative_fallback"
    })
  })

  it("fails closed when session data is malformed or belongs to another session", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { id: "different" } })
    const resolver = createAgentExecutionResolver({ client: { session: { get } } })

    await expect(resolver.resolve({ sessionID: "missing-id", agentName: "custom" })).resolves.toMatchObject({
      role: "child",
      reason: "conservative_fallback"
    })
    await expect(resolver.resolve({ sessionID: "wrong-id", agentName: "custom" })).resolves.toMatchObject({
      role: "child",
      reason: "conservative_fallback"
    })
  })

  it("extracts deleted session IDs from current and compatibility event shapes", () => {
    expect(deletedSessionIDFromEvent({ type: "session.deleted", properties: { info: { id: "current" } } })).toBe(
      "current"
    )
    expect(deletedSessionIDFromEvent({ type: "session.deleted", properties: { id: "legacy" } })).toBe("legacy")
    expect(
      deletedSessionIDFromEvent({ type: "session.updated", properties: { info: { id: "ignored" } } })
    ).toBeUndefined()
  })

  it("accepts OpenCode session lifecycle events through the plugin hook", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    expect(hooks.event).toBeTypeOf("function")
    await hooks.event?.({ event: { type: "session.updated", properties: {} } as never })
    await hooks.event?.({ event: { type: "session.deleted", properties: { info: { id: "session-1" } } } as never })
  })

  it("resolves lineage through the plugin chat hook for Ultra turns", async () => {
    const get = vi.fn(async () => ({ data: { id: "root" } }))
    const hooks = await CodexAuthPlugin({ client: { session: { get } } } as never, {
      mode: "codex",
      ultraEnabled: true
    })
    const output = { temperature: 0, topP: 1, topK: 0, options: {} as Record<string, unknown> }

    await hooks["chat.params"]?.(
      {
        sessionID: "root",
        agent: "build",
        provider: {},
        message: {},
        model: {
          id: "gpt-5.6-sol",
          providerID: "openai",
          capabilities: { toolcall: true },
          options: {
            codexCatalogModel: {
              slug: "gpt-5.6-sol",
              multi_agent_version: "v2",
              supported_in_api: true,
              visibility: "list",
              supported_reasoning_levels: [{ effort: "ultra" }]
            },
            codexRuntimeDefaults: { defaultReasoningEffort: "ultra" }
          }
        }
      } as never,
      output as never
    )

    expect(get).toHaveBeenCalledWith({ path: { id: "root" } })
    expect(output.options.instructions).toContain("Proactive multi-agent delegation")
  })
})
