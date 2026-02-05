import { parseRetryAfterMs } from "./rate-limit"

export type AuthData = {
  access: string
  accountId?: string
  identityKey?: string
}

export type FetchOrchestratorDeps = {
  acquireAuth: () => Promise<AuthData>
  setCooldown: (identityKey: string, cooldownUntil: number) => Promise<void>
  now?: () => number
  maxAttempts?: number
}

export class FetchOrchestrator {
  constructor(private deps: FetchOrchestratorDeps) {}

  async execute(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const maxAttempts = this.deps.maxAttempts ?? 3
    const nowFn = this.deps.now ?? Date.now

    const baseRequest = new Request(input, init)
    let lastResponse: Response | undefined

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const now = nowFn()
      const auth = await this.deps.acquireAuth()
      
      const request = baseRequest.clone()
      request.headers.set("Authorization", `Bearer ${auth.access}`)
      if (auth.accountId) {
        request.headers.set("ChatGPT-Account-Id", auth.accountId)
      }

      const response = await fetch(request)
      if (response.status !== 429) {
        return response
      }

      lastResponse = response

      // Handle 429
      const retryAfterStr = response.headers.get("retry-after")
      if (retryAfterStr && auth.identityKey) {
        const headerMap = { "retry-after": retryAfterStr }
        const retryAfterMs = parseRetryAfterMs(headerMap, now)
        if (retryAfterMs != null) {
          const cooldownUntil = now + retryAfterMs
          await this.deps.setCooldown(auth.identityKey, cooldownUntil)
        }
      }
    }

    return lastResponse!
  }
}
