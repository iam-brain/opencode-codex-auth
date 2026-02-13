import { describe, expect, it } from "vitest"

import { remapDeveloperMessagesToUserOnRequest } from "../lib/codex-native/request-transform"

describe("codex request role remap", () => {
  it("remaps non-permissions developer messages to user", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "Instructions from AGENTS.md" }]
          },
          {
            type: "message",
            role: "developer",
            content: [
              {
                type: "input_text",
                text: "<permissions instructions>\nFilesystem sandboxing defines which files can be read or written"
              }
            ]
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello" }]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: true
    })

    expect(remapped.changed).toBe(true)
    expect(remapped.reason).toBe("updated")
    expect(remapped.remappedCount).toBe(1)
    expect(remapped.preservedCount).toBe(1)

    const body = JSON.parse(await remapped.request.text()) as {
      input: Array<{ role: string }>
    }
    expect(body.input.map((item) => item.role)).toEqual(["user", "developer", "user"])
  })

  it("preserves permissions-only developer messages", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [
              {
                type: "input_text",
                text: "<permissions instructions>\nApproval policy is currently never"
              }
            ]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: true
    })

    expect(remapped.changed).toBe(false)
    expect(remapped.reason).toBe("permissions_only")
    expect(remapped.remappedCount).toBe(0)
    expect(remapped.preservedCount).toBe(1)
  })

  it("does nothing when remap is disabled", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "Any developer message" }]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: false
    })

    expect(remapped.changed).toBe(false)
    expect(remapped.reason).toBe("disabled")
    expect(remapped.remappedCount).toBe(0)
    expect(remapped.preservedCount).toBe(0)
  })

  it("preserves request metadata when body is rewritten", async () => {
    const controller = new AbortController()
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      mode: "cors",
      credentials: "include",
      keepalive: true,
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "rewrite me" }]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: true
    })

    expect(remapped.changed).toBe(true)
    expect(remapped.request.keepalive).toBe(true)
    expect(remapped.request.credentials).toBe("include")
    expect(remapped.request.mode).toBe("cors")

    controller.abort()
    expect(remapped.request.signal.aborted).toBe(true)
  })
})
