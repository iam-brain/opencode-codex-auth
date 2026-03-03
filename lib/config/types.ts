import type { RotationStrategy } from "../types.js"

export type PersonalityOption = string
export type CodexSpoofMode = "native" | "codex"
export type PluginRuntimeMode = "native" | "codex"
export type VerbosityOption = "default" | "low" | "medium" | "high"
export type PromptCacheKeyStrategy = "default" | "project"

export type ModelBehaviorOverride = {
  personality?: PersonalityOption
  thinkingSummaries?: boolean
  verbosityEnabled?: boolean
  verbosity?: VerbosityOption
}

export type ModelConfigOverride = ModelBehaviorOverride & {
  variants?: Record<string, ModelBehaviorOverride>
}

export type BehaviorSettings = {
  global?: ModelBehaviorOverride
  perModel?: Record<string, ModelConfigOverride>
}

export type PluginConfig = {
  debug?: boolean
  proactiveRefresh?: boolean
  proactiveRefreshBufferMs?: number
  quiet?: boolean
  quietMode?: boolean
  pidOffsetEnabled?: boolean
  personality?: PersonalityOption
  mode?: PluginRuntimeMode
  rotationStrategy?: RotationStrategy
  spoofMode?: CodexSpoofMode
  compatInputSanitizer?: boolean
  remapDeveloperMessagesToUser?: boolean
  codexCompactionOverride?: boolean
  headerSnapshots?: boolean
  headerSnapshotBodies?: boolean
  headerTransformDebug?: boolean
  promptCacheKeyStrategy?: PromptCacheKeyStrategy
  collaborationProfile?: boolean
  collaborationProfileEnabled?: boolean
  orchestratorSubagents?: boolean
  orchestratorSubagentsEnabled?: boolean
  behaviorSettings?: BehaviorSettings
}

export const CONFIG_FILE = "codex-config.json"

export const DEFAULT_CODEX_CONFIG = {
  $schema: "https://schemas.iam-brain.dev/opencode-codex-auth/codex-config.schema.json",
  debug: false,
  quiet: false,
  refreshAhead: {
    enabled: true,
    bufferMs: 60_000
  },
  runtime: {
    mode: "native",
    rotationStrategy: "sticky",
    sanitizeInputs: false,
    developerMessagesToUser: true,
    promptCacheKeyStrategy: "default",
    headerSnapshots: false,
    headerSnapshotBodies: false,
    headerTransformDebug: false,
    pidOffset: false
  },
  global: {
    personality: "pragmatic",
    verbosityEnabled: true,
    verbosity: "default"
  },
  perModel: {}
} as const

export const DEFAULT_CODEX_CONFIG_TEMPLATE = `{
  "$schema": "https://schemas.iam-brain.dev/opencode-codex-auth/codex-config.schema.json",

  // Enable verbose plugin debug logs.
  // options: true | false
  // default: false
  "debug": false,

  // Suppress plugin UI toasts/notifications.
  // options: true | false
  // default: false
  "quiet": false,

  // Proactively refresh access tokens before expiry.
  "refreshAhead": {
    // options: true | false
    // default: true
    "enabled": true,

    // Milliseconds before expiry to refresh.
    // default: 60000
    "bufferMs": 60000
  },

  "runtime": {
    // Request identity/profile mode.
    // options: "native" | "codex"
    // default: "native"
    "mode": "native",

    // Account rotation strategy.
    // options: "sticky" | "hybrid" | "round_robin"
    // default: "sticky"
    "rotationStrategy": "sticky",

    // Input compatibility sanitizer for edge payloads.
    // options: true | false
    // default: false
    "sanitizeInputs": false,

    // Experimental: remap non-permissions developer messages to user role.
    // Only applies when runtime.mode is "codex".
    // options: true | false
    // default: true
    "developerMessagesToUser": true,

    // Prompt cache key policy.
    // "default" keeps upstream session-based keys.
    // "project" overrides with a hashed project path + runtime mode key.
    // options: "default" | "project"
    // default: "default"
    "promptCacheKeyStrategy": "default",

    // Write request header snapshots to plugin logs.
    // options: true | false
    // default: false
    "headerSnapshots": false,

    // Capture request bodies in snapshot files.
    // options: true | false
    // default: false
    "headerSnapshotBodies": false,

    // Capture inbound/outbound header transforms for message requests.
    // options: true | false
    // default: false
    "headerTransformDebug": false,

    // Session-aware offset for account selection.
    // options: true | false
    // default: false
    "pidOffset": false

    // Experimental collaboration controls (optional):
    // "collaborationProfile": true,
    // "orchestratorSubagents": true
  },

  "global": {
    // Global personality key.
    // built-ins: "pragmatic", "friendly"
    // custom: any lowercase key from personalities/<key>.md
    // default: "pragmatic"
    "personality": "pragmatic",

    // Thinking summaries behavior:
    // true  => force on
    // false => force off
    // omit  => use model default from catalog cache (recommended)
    // "thinkingSummaries": true

    // Text verbosity behavior:
    // verbosityEnabled: true  => apply verbosity setting/default
    // verbosityEnabled: false => do not send textVerbosity
    // default: true
    "verbosityEnabled": true,

    // options: "default" | "low" | "medium" | "high"
    // "default" uses each model's catalog default verbosity.
    // default: "default"
    "verbosity": "default"
  },

  // Optional model-specific overrides.
  // Supports same fields as global plus nested variants.
  "perModel": {
     // "gpt-5.3-codex": {
     //   "personality": "friendly",
     //   "thinkingSummaries": true,
     //   "verbosityEnabled": true,
     //   "verbosity": "default",
     //   "variants": {
     //     "high": {
     //       "personality": "pragmatic",
     //       "thinkingSummaries": false,
     //       "verbosityEnabled": true,
     //       "verbosity": "high"
     //     }
     //   }
     // }
  }
}
`
