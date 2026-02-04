import { describe, expect, it } from "vitest"

import { extractAccountId, extractAccountIdFromClaims } from "../lib/codex-native"

describe("codex-native account id extraction", () => {
  it("extractAccountIdFromClaims prefers chatgpt_account_id", () => {
    expect(extractAccountIdFromClaims({ chatgpt_account_id: "acc_123" })).toBe("acc_123")
  })

  it("extractAccountIdFromClaims falls back to https://api.openai.com/auth.chatgpt_account_id", () => {
    expect(
      extractAccountIdFromClaims({
        "https://api.openai.com/auth": { chatgpt_account_id: "acc_456" }
      })
    ).toBe("acc_456")
  })

  it("extractAccountId reads id_token before access_token", () => {
    expect(
      extractAccountId({
        id_token: buildJwt({ chatgpt_account_id: "acc_from_id" }),
        access_token: buildJwt({ chatgpt_account_id: "acc_from_access" })
      })
    ).toBe("acc_from_id")
  })
})

function buildJwt(payload: Record<string, unknown>): string {
  return [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "sig"
  ].join(".")
}
