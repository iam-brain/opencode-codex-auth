import { afterEach, describe, expect, it, vi } from "vitest"
import { FetchOrchestrator, createFetchOrchestratorState } from "../lib/fetch-orchestrator"
import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

afterEach(() => {
  resetStubbedGlobals()
})

describe("FetchOrchestrator toasts and session affinity", () => {
  it("shows a toast when a new chat starts", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_new_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_new_1", input: "hi" })
    })

    expect(showToast).toHaveBeenCalledWith("New chat: user@example.com (plus)", "info", false)
  })

  it("shows a toast when switching to an existing session", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_alpha" },
      body: JSON.stringify({ prompt_cache_key: "ses_alpha", input: "one" })
    })
    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_beta" },
      body: JSON.stringify({ prompt_cache_key: "ses_beta", input: "two" })
    })
    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_alpha" },
      body: JSON.stringify({ prompt_cache_key: "ses_alpha", input: "three" })
    })

    expect(
      showToast.mock.calls.some(
        (call) => call[0] === "Session switched: user@example.com (plus)" && call[1] === "info" && call[2] === false
      )
    ).toBe(true)
  })

  it("shows a resume toast when restoring the same active session context", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})
    const sharedState = createFetchOrchestratorState()
    sharedState.seenSessionKeys.set("ses_resume_1", Date.now())
    sharedState.lastSessionKey = "ses_resume_1"

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_resume_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_resume_1", input: "continue" })
    })

    expect(showToast).toHaveBeenCalledWith("Resuming chat: user@example.com (plus)", "info", false)
    expect(showToast.mock.calls.some((call) => call[0] === "New chat: user@example.com (plus)")).toBe(false)
  })

  it("does not repeatedly emit resume toasts for the same unchanged session", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})
    const sharedState = createFetchOrchestratorState()
    sharedState.seenSessionKeys.set("ses_resume_single", Date.now())
    sharedState.lastSessionKey = "ses_resume_single"
    let nowValue = 10_000

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState,
      now: () => nowValue
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_resume_single" },
      body: JSON.stringify({ prompt_cache_key: "ses_resume_single", input: "continue-one" })
    })
    nowValue = 40_000
    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_resume_single" },
      body: JSON.stringify({ prompt_cache_key: "ses_resume_single", input: "continue-two" })
    })
    nowValue = 70_000
    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_resume_single" },
      body: JSON.stringify({ prompt_cache_key: "ses_resume_single", input: "continue-three" })
    })

    const resumeToasts = showToast.mock.calls.filter((call) => call[0] === "Resuming chat: user@example.com (plus)")
    expect(resumeToasts).toHaveLength(1)
  })

  it("does not emit a resume toast for seen sessions when no last active session is restored", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})
    const sharedState = createFetchOrchestratorState()
    sharedState.seenSessionKeys.set("ses_seen_1", Date.now())
    sharedState.lastSessionKey = null

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_seen_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_seen_1", input: "continue" })
    })

    expect(showToast.mock.calls.some((call) => call[0] === "Resuming chat: user@example.com (plus)")).toBe(false)
    expect(showToast.mock.calls.some((call) => call[0] === "New chat: user@example.com (plus)")).toBe(false)
  })

  it("shows a toast when the account changes", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (pro)" }
    ]
    let idx = 0
    const acquireAuth = vi.fn(async () => auths[idx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast
    })

    await orch.execute("https://api.com")
    await orch.execute("https://api.com")

    expect(showToast).toHaveBeenCalledWith("Account switched: two@example.com (pro)", "info", false)
  })

  it("shows a warning toast on rate-limit switch", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (plus)" }
    ]
    let idx = 0
    const acquireAuth = vi.fn(async () => auths[idx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        if (idx === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "Retry-After": "1" }
          })
        }
        return new Response("OK", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      maxAttempts: 2
    })

    const response = await orch.execute("https://api.com")
    expect(response.status).toBe(200)
    expect(showToast).toHaveBeenCalledWith("Rate limited - switching account", "warning", false)
  })

  it("tags account-switch toast with reason code when switched after 429", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (plus)" }
    ]
    let idx = 0
    const acquireAuth = vi.fn(async () => auths[idx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        if (idx === 1) {
          return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "1" } })
        }
        return new Response("OK", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      maxAttempts: 2
    })

    const response = await orch.execute("https://api.com")
    expect(response.status).toBe(200)
    expect(
      showToast.mock.calls.some(
        (call) =>
          call[0] === "Account switched after rate limit: two@example.com (plus)" &&
          call[1] === "info" &&
          call[2] === false
      )
    ).toBe(true)
  })

  it("reuses shared session state across orchestrator instances to avoid duplicate new-chat toasts", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})
    const sharedState = createFetchOrchestratorState()

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const first = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState
    })
    await first.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_shared_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_shared_1", input: "first" })
    })

    const second = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState
    })
    await second.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_shared_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_shared_1", input: "second" })
    })

    const newChatToasts = showToast.mock.calls.filter((call) => call[0] === "New chat: user@example.com (plus)")
    expect(newChatToasts).toHaveLength(1)
  })

  it("coalesces rapid new-chat toasts across different sessions", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})
    let nowValue = 1_000

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      now: () => nowValue
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_new_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_new_1", input: "one" })
    })
    nowValue = 2_000
    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_new_2" },
      body: JSON.stringify({ prompt_cache_key: "ses_new_2", input: "two" })
    })

    const newChatToasts = showToast.mock.calls.filter((call) => call[0] === "New chat: user@example.com (plus)")
    expect(newChatToasts).toHaveLength(1)
  })

  it("coalesces rapid account-switch toasts", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (plus)" },
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (plus)" }
    ]
    let idx = 0
    const acquireAuth = vi.fn(async () => auths[idx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})
    let nowValue = 1_000

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      now: () => nowValue
    })

    await orch.execute("https://api.com")
    nowValue = 2_000
    await orch.execute("https://api.com")
    nowValue = 3_000
    await orch.execute("https://api.com")
    nowValue = 4_000
    await orch.execute("https://api.com")

    const accountSwitchToasts = showToast.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].startsWith("Account switched:")
    )
    expect(accountSwitchToasts).toHaveLength(1)
  })
})
