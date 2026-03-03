import { createFetchOrchestratorState, type FetchOrchestratorState } from "../fetch-orchestrator.js"
import type { Logger } from "../logger.js"
import { defaultSessionAffinityPath } from "../paths.js"
import { createStickySessionState, type StickySessionState } from "../rotation.js"
import {
  createSessionExistsFn,
  loadSessionAffinity,
  pruneSessionAffinitySnapshot,
  readSessionAffinitySnapshot,
  saveSessionAffinity,
  writeSessionAffinitySnapshot
} from "../session-affinity.js"
import type { OpenAIAuthMode } from "../types.js"

export type SessionAffinityRuntimeState = {
  orchestratorState: FetchOrchestratorState
  stickySessionState: StickySessionState
  hybridSessionState: StickySessionState
  persistSessionAffinityState: () => void | Promise<void>
}

type SessionAffinityRuntimeDeps = {
  defaultSessionAffinityPath: typeof defaultSessionAffinityPath
  createSessionExistsFn: typeof createSessionExistsFn
  loadSessionAffinity: typeof loadSessionAffinity
  pruneSessionAffinitySnapshot: typeof pruneSessionAffinitySnapshot
  readSessionAffinitySnapshot: typeof readSessionAffinitySnapshot
  saveSessionAffinity: typeof saveSessionAffinity
  writeSessionAffinitySnapshot: typeof writeSessionAffinitySnapshot
}

const DEFAULT_RUNTIME_DEPS: SessionAffinityRuntimeDeps = {
  defaultSessionAffinityPath,
  createSessionExistsFn,
  loadSessionAffinity,
  pruneSessionAffinitySnapshot,
  readSessionAffinitySnapshot,
  saveSessionAffinity,
  writeSessionAffinitySnapshot
}

export async function createSessionAffinityRuntimeState(input: {
  authMode: OpenAIAuthMode
  env: NodeJS.ProcessEnv
  missingGraceMs: number
  log?: Logger
  deps?: Partial<SessionAffinityRuntimeDeps>
}): Promise<SessionAffinityRuntimeState> {
  const deps = { ...DEFAULT_RUNTIME_DEPS, ...(input.deps ?? {}) }
  const sessionAffinityPath = deps.defaultSessionAffinityPath(input.env)
  const loadedSessionAffinity = await deps.loadSessionAffinity(sessionAffinityPath).catch(() => ({
    version: 1 as const
  }))
  const initialSessionAffinity = deps.readSessionAffinitySnapshot(loadedSessionAffinity, input.authMode)
  const sessionExists = deps.createSessionExistsFn(input.env)
  await deps
    .pruneSessionAffinitySnapshot(initialSessionAffinity, sessionExists, {
      missingGraceMs: input.missingGraceMs
    })
    .catch(() => 0)

  const orchestratorState = createFetchOrchestratorState()
  orchestratorState.seenSessionKeys = initialSessionAffinity.seenSessionKeys

  const stickySessionState = createStickySessionState()
  stickySessionState.bySessionKey = initialSessionAffinity.stickyBySessionKey
  const hybridSessionState = createStickySessionState()
  hybridSessionState.bySessionKey = initialSessionAffinity.hybridBySessionKey

  let sessionAffinityPersistQueue = Promise.resolve()
  let persistenceErrorLogged = false
  const persistSessionAffinityState = (): Promise<void> => {
    sessionAffinityPersistQueue = sessionAffinityPersistQueue
      .then(async () => {
        await deps.pruneSessionAffinitySnapshot(
          {
            seenSessionKeys: orchestratorState.seenSessionKeys,
            stickyBySessionKey: stickySessionState.bySessionKey,
            hybridBySessionKey: hybridSessionState.bySessionKey
          },
          sessionExists,
          {
            missingGraceMs: input.missingGraceMs
          }
        )
        await deps.saveSessionAffinity(
          async (current) =>
            deps.writeSessionAffinitySnapshot(current, input.authMode, {
              seenSessionKeys: orchestratorState.seenSessionKeys,
              stickyBySessionKey: stickySessionState.bySessionKey,
              hybridBySessionKey: hybridSessionState.bySessionKey
            }),
          sessionAffinityPath
        )
        persistenceErrorLogged = false
      })
      .catch((error) => {
        if (!persistenceErrorLogged) {
          persistenceErrorLogged = true
          input.log?.debug("session affinity persistence failed", {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return sessionAffinityPersistQueue
  }

  return {
    orchestratorState,
    stickySessionState,
    hybridSessionState,
    persistSessionAffinityState
  }
}
