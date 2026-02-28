import { describe, expect, it } from "vitest"
import { buildIdentityKey, synchronizeIdentityKey } from "../lib/identity"
import { parseJwtClaims } from "../lib/claims"

describe("identity", () => {
  it("builds a normalized identity key", () => {
    expect(
      buildIdentityKey({
        accountId: " acc_123 ",
        email: " User@Example.com ",
        plan: " Plus "
      })
    ).toBe("acc_123|user@example.com|plus")
  })

  it("parses jwt claims", () => {
    const payloadEmail = "User@Example.com"
    const sampleToken = [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      Buffer.from(
        JSON.stringify({
          email: payloadEmail,
          chatgpt_account_id: "acc_123",
          plan: "Plus"
        })
      ).toString("base64url"),
      "sig"
    ].join(".")

    expect(parseJwtClaims(sampleToken)?.email).toBe(payloadEmail)
  })

  it("returns undefined for malformed jwt", () => {
    expect(parseJwtClaims("not-a-jwt")).toBeUndefined()
  })

  it("returns undefined for non-object payload", () => {
    const tokenWithNullPayload = [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      Buffer.from("null").toString("base64url"),
      "sig"
    ].join(".")

    expect(parseJwtClaims(tokenWithNullPayload)).toBeUndefined()
  })

  it("upgrades legacy identity keys to canonical strict identity when available", () => {
    const account = synchronizeIdentityKey({
      identityKey: "legacy|acc_123|user%40example.com|plus",
      accountId: "acc_123",
      email: "User@Example.com",
      plan: "Plus"
    })

    expect(account.identityKey).toBe("acc_123|user@example.com|plus")
  })
})
