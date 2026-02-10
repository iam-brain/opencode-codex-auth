import { describe, expect, it } from "vitest"

import {
  buildAccountActionItems,
  buildAuthMenuItems,
  formatAccountAuthTypes,
  formatRelativeTime,
  formatStatusBadges
} from "../lib/ui/auth-menu"

describe("auth menu helpers", () => {
  it("formats relative time", () => {
    const now = Date.UTC(2026, 1, 8)
    expect(formatRelativeTime(now, now)).toBe("today")
    expect(formatRelativeTime(now - 86_400_000, now)).toBe("yesterday")
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe("3d ago")
  })

  it("builds auth menu items with optional transfer action", () => {
    const accounts = [
      {
        index: 0,
        identityKey: "acc_1|one@example.com|plus",
        email: "one@example.com",
        plan: "plus",
        enabled: true,
        isCurrentAccount: true,
        status: "active" as const,
        authTypes: ["native"] as const
      }
    ]

    const withTransfer = buildAuthMenuItems(accounts, { useColor: false, allowTransfer: true })
    const withoutTransfer = buildAuthMenuItems(accounts, { useColor: false, allowTransfer: false })
    expect(withTransfer.some((item) => item.label.includes("Transfer OpenAI accounts"))).toBe(true)
    expect(withoutTransfer.some((item) => item.label.includes("Transfer OpenAI accounts"))).toBe(false)
  })

  it("formats status badges for enabled/disabled", () => {
    const enabled = formatStatusBadges({ enabled: true, isCurrentAccount: true, status: "active" }, false)
    const disabled = formatStatusBadges({ enabled: false, isCurrentAccount: false, status: "expired" }, false)
    expect(enabled).toContain("[enabled]")
    expect(enabled).toContain("[last active]")
    expect(disabled).toContain("[disabled]")
    expect(disabled).toContain("[expired]")
  })

  it("builds account action items with refresh disabled for disabled account", () => {
    const enabledItems = buildAccountActionItems({ index: 0, enabled: true, authTypes: ["native"] })
    const disabledItems = buildAccountActionItems({ index: 0, enabled: false, authTypes: ["native"] })
    const enabledRefresh = enabledItems.find((item) => item.value.type === "refresh")
    const disabledRefresh = disabledItems.find((item) => item.value.type === "refresh")
    const enabledDeleteAll = enabledItems.find(
      (item) => item.value.type === "delete-all" && item.value.scope === "native"
    )
    expect(enabledRefresh?.disabled).not.toBe(true)
    expect(disabledRefresh?.disabled).toBe(true)
    expect(enabledDeleteAll).toBeDefined()
  })

  it("formats account auth types and includes both scopes for mixed accounts", () => {
    expect(formatAccountAuthTypes(["native"])).toBe("Native")
    expect(formatAccountAuthTypes(["codex"])).toBe("Codex")
    expect(formatAccountAuthTypes(["native", "codex"])).toBe("Native+Codex")

    const mixedItems = buildAccountActionItems(
      { index: 0, enabled: true, authTypes: ["native", "codex"] },
      { availableDeleteScopes: ["native", "codex"] }
    )

    expect(
      mixedItems.some((item) => item.value.type === "delete" && item.value.scope === "native")
    ).toBe(true)
    expect(
      mixedItems.some((item) => item.value.type === "delete" && item.value.scope === "codex")
    ).toBe(true)
    expect(
      mixedItems.some((item) => item.value.type === "delete" && item.value.scope === "both")
    ).toBe(true)
  })
})
