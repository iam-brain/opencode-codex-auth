import http from "node:http"

import { afterEach, describe, expect, it, vi } from "vitest"

import { createOAuthServerController } from "../lib/codex-native/oauth-server"

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve ephemeral port")))
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function httpRequest(input: { url: string; method?: string }): Promise<{
  statusCode: number
  body: string
  headers: Record<string, string | undefined>
}> {
  return new Promise((resolve, reject) => {
    const url = new URL(input.url)
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: input.method ?? "GET"
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
        })
        res.once("end", () => {
          const contentType = Array.isArray(res.headers["content-type"])
            ? res.headers["content-type"][0]
            : res.headers["content-type"]
          const cacheControl = Array.isArray(res.headers["cache-control"])
            ? res.headers["cache-control"][0]
            : res.headers["cache-control"]
          const referrerPolicy = Array.isArray(res.headers["referrer-policy"])
            ? res.headers["referrer-policy"][0]
            : res.headers["referrer-policy"]
          const xContentTypeOptions = Array.isArray(res.headers["x-content-type-options"])
            ? res.headers["x-content-type-options"][0]
            : res.headers["x-content-type-options"]
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: {
              "content-type": contentType,
              "cache-control": cacheControl,
              "referrer-policy": referrerPolicy,
              "x-content-type-options": xContentTypeOptions
            }
          })
        })
      }
    )
    req.once("error", reject)
    req.end()
  })
}

describe.sequential("oauth server controller", () => {
  const controllers: Array<ReturnType<typeof createOAuthServerController<string, { access_token: string }>>> = []

  afterEach(() => {
    while (controllers.length > 0) {
      controllers.pop()?.stop()
    }
  })

  it("returns plain-text 404 with hardened headers for unknown routes", async () => {
    const port = await getFreePort()
    const controller = createOAuthServerController({
      port,
      loopbackHost: "127.0.0.1",
      callbackOrigin: `http://127.0.0.1:${port}`,
      callbackUri: `http://127.0.0.1:${port}/auth/callback`,
      callbackPath: "/auth/callback",
      callbackTimeoutMs: 1_000,
      buildOAuthErrorHtml: (error: string) => `<html>${error}</html>`,
      buildOAuthSuccessHtml: () => "<html>ok</html>",
      composeCodexSuccessRedirectUrl: () => `http://127.0.0.1:${port}/success`,
      exchangeCodeForTokens: vi.fn(async () => ({ access_token: "token" }))
    })
    controllers.push(controller)

    await controller.start()
    const response = await httpRequest({
      url: `http://127.0.0.1:${port}/not-found`,
      method: "POST"
    })

    expect(response.statusCode).toBe(404)
    expect(response.body).toBe("Not found")
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["referrer-policy"]).toBe("no-referrer")
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
  })

  it("rejects invalid cancel state with plain-text error headers", async () => {
    const port = await getFreePort()
    const controller = createOAuthServerController({
      port,
      loopbackHost: "127.0.0.1",
      callbackOrigin: `http://127.0.0.1:${port}`,
      callbackUri: `http://127.0.0.1:${port}/auth/callback`,
      callbackPath: "/auth/callback",
      callbackTimeoutMs: 1_000,
      buildOAuthErrorHtml: (error: string) => `<html>${error}</html>`,
      buildOAuthSuccessHtml: () => "<html>ok</html>",
      composeCodexSuccessRedirectUrl: () => `http://127.0.0.1:${port}/success`,
      exchangeCodeForTokens: vi.fn(async () => ({ access_token: "token" }))
    })
    controllers.push(controller)

    await controller.start()
    const response = await httpRequest({
      url: `http://127.0.0.1:${port}/cancel?state=wrong-state`
    })

    expect(response.statusCode).toBe(400)
    expect(response.body).toBe("Invalid cancel state")
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["referrer-policy"]).toBe("no-referrer")
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
  })

  it("treats duplicate callback hits as invalid after the first resolution", async () => {
    const port = await getFreePort()
    const exchangeCodeForTokens = vi.fn(async () => ({ access_token: "token" }))
    const controller = createOAuthServerController({
      port,
      loopbackHost: "127.0.0.1",
      callbackOrigin: `http://127.0.0.1:${port}`,
      callbackUri: `http://127.0.0.1:${port}/auth/callback`,
      callbackPath: "/auth/callback",
      callbackTimeoutMs: 1_000,
      buildOAuthErrorHtml: (error: string) => `<html>${error}</html>`,
      buildOAuthSuccessHtml: () => "<html>ok</html>",
      composeCodexSuccessRedirectUrl: () => `http://127.0.0.1:${port}/success`,
      exchangeCodeForTokens
    })
    controllers.push(controller)

    await controller.start()
    const waitForCallback = controller.waitForCallback("pkce", "expected-state", "native")
    const firstResponse = await httpRequest({
      url: `http://127.0.0.1:${port}/auth/callback?code=ok&state=expected-state`
    })
    await expect(waitForCallback).resolves.toEqual({ access_token: "token" })

    const duplicateResponse = await httpRequest({
      url: `http://127.0.0.1:${port}/auth/callback?code=ok&state=expected-state`
    })

    expect(firstResponse.statusCode).toBe(200)
    expect(firstResponse.body).toContain("ok")
    expect(duplicateResponse.statusCode).toBe(400)
    expect(duplicateResponse.body).toContain("Invalid state - potential CSRF attack")
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(1)
  })
})
