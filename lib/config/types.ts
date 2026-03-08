import type { RotationStrategy } from "../types.js"

export type PersonalityOption = string
export type CodexSpoofMode = "native" | "codex"
export type PluginRuntimeMode = "native" | "codex"
export type VerbosityOption = "default" | "low" | "medium" | "high"
export type TextVerbosityOption = VerbosityOption | "none"
export type ReasoningSummaryOption = "auto" | "concise" | "detailed" | "none"
export type IncludeOption = "reasoning.encrypted_content" | "file_search_call.results" | "message.output_text.logprobs"
export type ServiceTierOption = "auto" | "priority" | "flex"
export type PromptCacheKeyStrategy = "default" | "project"

export type ModelBehaviorOverride = {
  personality?: PersonalityOption
  reasoningEffort?: string
  reasoningSummary?: ReasoningSummaryOption
  reasoningSummaries?: boolean
  thinkingSummaries?: boolean
  textVerbosity?: TextVerbosityOption
  verbosityEnabled?: boolean
  verbosity?: VerbosityOption
  serviceTier?: ServiceTierOption
  include?: IncludeOption[]
  parallelToolCalls?: boolean
}

export type ModelConfigOverride = ModelBehaviorOverride & {
  variants?: Record<string, ModelBehaviorOverride>
}

export type CustomModelConfig = ModelConfigOverride & {
  targetModel: string
  name?: string
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
  customModels?: Record<string, CustomModelConfig>
}

export const CONFIG_FILE = "codex-config.jsonc"
export const LEGACY_CONFIG_FILE = "codex-config.json"

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
    reasoningEffort: "high",
    reasoningSummary: "auto",
    textVerbosity: "default"
  },
  customModels: {},
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

    // Codex-rs compaction/profile override.
    // options: true | false
    // mode default: false in "native", true in "codex"
    // "codexCompactionOverride": true,

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

    // Collaboration profile toggles.
    // options: true | false
    // mode default: false in "native", true in "codex"
    // "collaborationProfile": true,

    // Subagent header hints.
    // options: true | false
    // default: inherits collaborationProfile
    // "orchestratorSubagents": true,

    // Session-aware offset for account selection.
    // options: true | false
    // default: false
    "pidOffset": false
  },

  "global": {
    // Global personality key.
    // built-ins: "pragmatic", "friendly"
    // custom: any lowercase key from personalities/<key>.md
    // default: "pragmatic"
    "personality": "pragmatic",

    // Reasoning effort override.
    // examples: "minimal", "low", "medium", "high"
    // omit => use the selected model/catalog default
    "reasoningEffort": "high",

    // Reasoning summary format sent upstream as reasoning.summary.
    // options: "auto" | "concise" | "detailed" | "none"
    // "none" disables reasoning summaries entirely.
    // deprecated aliases: reasoningSummaries, thinkingSummaries
    "reasoningSummary": "auto",

    // Fast Mode behavior (serviceTier):
    // "auto"     => do not force a service_tier override
    // "priority" => fast mode for GPT-5.4* requests only
    // "flex"     => pass through service_tier: "flex"
    // omit       => leave request body unchanged (recommended)
    // "serviceTier": "priority",

    // Text verbosity behavior sent upstream as text.verbosity.
    // options: "default" | "low" | "medium" | "high" | "none"
    // "default" uses each model's catalog default verbosity.
    // "none" disables text verbosity entirely.
    "textVerbosity": "default"

    // Optional extra response includes.
    // allowed: "reasoning.encrypted_content" | "file_search_call.results" | "message.output_text.logprobs"
    // "include": ["file_search_call.results"],

    // Whether to allow multiple tool calls in parallel.
    // options: true | false
    // omit => use the selected model/catalog default
    // "parallelToolCalls": true
  },

  // Optional custom selectable model aliases.
  // The config key becomes the model slug users select, while targetModel stays the backend-facing model id.
  "customModels": {
    // "my-fast-codex": {
    //   "targetModel": "gpt-5.3-codex",
    //   "name": "My Fast Codex",
    //   "reasoningEffort": "low",
    //   "reasoningSummary": "concise",
    //   "textVerbosity": "medium",
    //   "serviceTier": "auto",
    //   "include": ["file_search_call.results"],
    //   "parallelToolCalls": true,
    //   "variants": {
    //     "high": {
    //       "reasoningEffort": "high",
    //       "reasoningSummary": "detailed"
    //     }
    //   }
    // }
  },

  // Optional model-specific overrides.
  // Supports same fields as global plus nested variants.
  "perModel": {
     // "gpt-5.3-codex": {
     //   "personality": "friendly",
     //   "reasoningEffort": "medium",
     //   "reasoningSummary": "concise",
     //   "textVerbosity": "medium",
     //   "serviceTier": "priority",
     //   "include": ["file_search_call.results"],
     //   "parallelToolCalls": false,
     //   "variants": {
     //     "high": {
     //       "personality": "pragmatic",
     //       "reasoningSummary": "detailed",
     //       "textVerbosity": "high",
     //       "serviceTier": "flex"
     //     }
     //   }
     // }
  }
}
`
