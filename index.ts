import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"

import {
  listAccountsForTools,
  removeAccountByIndex,
  switchAccountByIndex,
  toggleAccountEnabledByIndex
} from "./lib/accounts-tools.js"
import { removedAccountMessage, switchedAccountMessage, toggledAccountMessage } from "./lib/auth-messages.js"
import { CodexAuthPlugin, refreshAccessToken } from "./lib/codex-native.js"
import {
  ensureDefaultConfigFile,
  getCompatInputSanitizerEnabled,
  getCodexCompactionOverrideEnabled,
  getBehaviorSettings,
  getCollaborationProfileEnabled,
  getDebugEnabled,
  getHeaderSnapshotBodiesEnabled,
  getHeaderTransformDebugEnabled,
  getHeaderSnapshotsEnabled,
  getOrchestratorSubagentsEnabled,
  getMode,
  getRemapDeveloperMessagesToUserEnabled,
  getRotationStrategy,
  getPromptCacheKeyStrategy,
  getPidOffsetEnabled,
  getPersonality,
  getProactiveRefreshBufferMs,
  getProactiveRefreshEnabled,
  getSpoofMode,
  getQuietMode,
  loadConfigFile,
  resolveConfig
} from "./lib/config.js"
import { createLogger } from "./lib/logger.js"
import { generatePersonaSpec } from "./lib/persona-tool.js"
import { createPersonalityFile } from "./lib/personality-create.js"
import { installCreatePersonalityCommand } from "./lib/personality-command.js"
import { installPersonalityBuilderSkill } from "./lib/personality-skill.js"
import { reconcileOrchestratorAgentVisibility } from "./lib/orchestrator-agent.js"
import { runOneProactiveRefreshTick } from "./lib/proactive-refresh.js"
import { toolOutputForStatus } from "./lib/codex-status-tool.js"
import { requireOpenAIMultiOauthAuth, saveAuthStorage } from "./lib/storage.js"
import { refreshCachedCodexPrompts } from "./lib/codex-prompts-cache.js"
import { setCodexPlanModeInstructions } from "./lib/codex-native/collaboration.js"

let scheduler: { stop: () => void } | undefined

export const OpenAIMultiAuthPlugin: Plugin = async (input) => {
  if (scheduler) {
    scheduler.stop()
    scheduler = undefined
  }

  await ensureDefaultConfigFile({ env: process.env }).catch((error) => {
    if (error instanceof Error) {
      console.warn(`[opencode-codex-auth] bootstrap: ensureDefaultConfigFile failed: ${error.message}`)
    }
  })
  await installCreatePersonalityCommand({ force: true }).catch((error) => {
    if (error instanceof Error) {
      console.warn(`[opencode-codex-auth] bootstrap: installCreatePersonalityCommand failed: ${error.message}`)
    }
  })
  await installPersonalityBuilderSkill({ force: true }).catch((error) => {
    if (error instanceof Error) {
      console.warn(`[opencode-codex-auth] bootstrap: installPersonalityBuilderSkill failed: ${error.message}`)
    }
  })

  await refreshCachedCodexPrompts()
    .then((prompts) => {
      setCodexPlanModeInstructions(prompts.plan)
    })
    .catch((error) => {
      if (error instanceof Error) {
        console.warn(`[opencode-codex-auth] bootstrap: refreshCachedCodexPrompts failed: ${error.message}`)
      }
    })

  const cfg = resolveConfig({
    env: process.env,
    file: loadConfigFile({ env: process.env })
  })
  const runtimeMode = getMode(cfg)
  const collaborationProfileEnabled = getCollaborationProfileEnabled(cfg)
  const log = createLogger({ debug: getDebugEnabled(cfg) })

  await reconcileOrchestratorAgentVisibility({ visible: collaborationProfileEnabled }).catch((error) => {
    if (error instanceof Error) {
      console.warn(`[opencode-codex-auth] bootstrap: reconcileOrchestratorAgentVisibility failed: ${error.message}`)
    }
  })

  if (getProactiveRefreshEnabled(cfg)) {
    const bufferMs = getProactiveRefreshBufferMs(cfg)
    const timer = setInterval(() => {
      runOneProactiveRefreshTick({
        now: Date.now,
        bufferMs,
        refresh: async (refreshToken) => {
          const tokens = await refreshAccessToken(refreshToken)
          return {
            access: tokens.access_token,
            refresh: tokens.refresh_token,
            expires: Date.now() + (tokens.expires_in ?? 3600) * 1000
          }
        }
      }).catch((error) => {
        if (error instanceof Error) {
          // best-effort background scheduler
        }
      })
    }, 60_000)
    scheduler = { stop: () => clearInterval(timer) }
  }

  log.debug("plugin init")
  const hooks = await CodexAuthPlugin(input, {
    log,
    personality: getPersonality(cfg),
    mode: runtimeMode,
    quietMode: getQuietMode(cfg),
    pidOffsetEnabled: getPidOffsetEnabled(cfg),
    rotationStrategy: getRotationStrategy(cfg),
    promptCacheKeyStrategy: getPromptCacheKeyStrategy(cfg),
    spoofMode: getSpoofMode(cfg),
    compatInputSanitizer: getCompatInputSanitizerEnabled(cfg),
    remapDeveloperMessagesToUser: getRemapDeveloperMessagesToUserEnabled(cfg),
    codexCompactionOverride: getCodexCompactionOverrideEnabled(cfg),
    headerSnapshots: getHeaderSnapshotsEnabled(cfg),
    headerSnapshotBodies: getHeaderSnapshotBodiesEnabled(cfg),
    headerTransformDebug: getHeaderTransformDebugEnabled(cfg),
    collaborationProfileEnabled,
    orchestratorSubagentsEnabled: getOrchestratorSubagentsEnabled(cfg),
    behaviorSettings: getBehaviorSettings(cfg)
  })

  const z = tool.schema
  hooks.tool = {
    ...hooks.tool,
    "codex-status": tool({
      description: "Show the status and usage limits of all configured Codex accounts.",
      args: {},
      execute: async () => {
        return toolOutputForStatus()
      }
    }),
    "codex-switch-accounts": tool({
      description: "Switch the active OpenAI account by 1-based index.",
      args: { index: z.number().int().min(1) },
      execute: async ({ index }) => {
        let message = ""

        await saveAuthStorage(undefined, (authFile) => {
          const openai = requireOpenAIMultiOauthAuth(authFile)
          const row = listAccountsForTools(openai)[index - 1]
          const next = switchAccountByIndex(openai, index)
          authFile.openai = next
          message = switchedAccountMessage({ email: row?.email, plan: row?.plan, index1: index })
        })

        return message
      }
    }),
    "codex-toggle-account": tool({
      description: "Toggle enabled/disabled for an OpenAI account by 1-based index.",
      args: { index: z.number().int().min(1) },
      execute: async ({ index }) => {
        let message = ""

        await saveAuthStorage(undefined, (authFile) => {
          const openai = requireOpenAIMultiOauthAuth(authFile)
          const rowsBefore = listAccountsForTools(openai)
          const row = rowsBefore[index - 1]
          const next = toggleAccountEnabledByIndex(openai, index)
          authFile.openai = next
          const enabled = listAccountsForTools(next)[index - 1]?.enabled === true
          message = toggledAccountMessage({
            index1: index,
            email: row?.email,
            plan: row?.plan,
            enabled
          })
        })

        return message
      }
    }),
    "codex-remove-account": tool({
      description: "Remove an OpenAI account by 1-based index (requires confirm).",
      args: { index: z.number().int().min(1), confirm: z.boolean().optional() },
      execute: async ({ index, confirm }) => {
        if (confirm !== true) {
          return "Refusing to remove account without confirm: true"
        }

        let message = ""

        await saveAuthStorage(undefined, (authFile) => {
          const openai = requireOpenAIMultiOauthAuth(authFile)
          const row = listAccountsForTools(openai)[index - 1]
          const next = removeAccountByIndex(openai, index)
          authFile.openai = next
          message = removedAccountMessage({
            index1: index,
            email: row?.email,
            plan: row?.plan
          })
        })

        return message
      }
    }),
    "create-personality": tool({
      description: "Create or update a custom personality markdown file for codex-config.json usage.",
      args: {
        name: z.string().min(1).optional(),
        sourceText: z.string().optional(),
        targetStyle: z.enum(["lean", "mid", "friendly-sized"]).optional(),
        voiceFidelity: z.number().min(0).max(1).optional(),
        competenceStrictness: z.number().min(0).max(1).optional(),
        domain: z.enum(["coding", "audit", "research", "general"]).optional(),
        inspiration: z.string().optional(),
        tone: z.string().optional(),
        collaborationStyle: z.string().optional(),
        codeStyle: z.string().optional(),
        constraints: z.string().optional(),
        examples: z.string().optional(),
        scope: z.enum(["global", "project"]).optional(),
        overwrite: z.boolean().optional()
      },
      execute: async (args) => {
        const name = args.name ?? "custom-personality"
        if (args.sourceText && args.sourceText.trim()) {
          const generated = generatePersonaSpec({
            source_text: args.sourceText,
            target_style: args.targetStyle ?? "mid",
            voice_fidelity: args.voiceFidelity ?? 0.85,
            competence_strictness: args.competenceStrictness ?? 0.95,
            domain: args.domain ?? "general"
          })
          const result = await createPersonalityFile({
            name,
            scope: args.scope,
            overwrite: args.overwrite,
            projectRoot: input.worktree,
            markdown: generated.agent_markdown
          })
          const action = result.created ? "Created" : "Kept existing"
          return `${action} personality "${result.key}" at ${result.filePath} (${result.scope}) • tokens=${generated.token_estimate}`
        }

        const result = await createPersonalityFile({
          ...args,
          name,
          projectRoot: input.worktree
        })
        const action = result.created ? "Created" : "Kept existing"
        return `${action} personality "${result.key}" at ${result.filePath} (${result.scope})`
      }
    })
  }

  return hooks
}

export default OpenAIMultiAuthPlugin
