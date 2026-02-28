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

export async function createSessionAffinityRuntimeState(input: {
  authMode: OpenAIAuthMode
  env: NodeJS.ProcessEnv
  missingGraceMs: number
  log?: Logger
}): Promise<SessionAffinityRuntimeState> {
  const sessionAffinityPath = defaultSessionAffinityPath(input.env)
  const loadedSessionAffinity = await loadSessionAffinity(sessionAffinityPath).catch(() => ({
    version: 1 as const
  }))
  const initialSessionAffinity = readSessionAffinitySnapshot(loadedSessionAffinity, input.authMode)
  const sessionExists = createSessionExistsFn(input.env)
  await pruneSessionAffinitySnapshot(initialSessionAffinity, sessionExists, {
    missingGraceMs: input.missingGraceMs
  }).catch(() => 0)

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
        await pruneSessionAffinitySnapshot(
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
        await saveSessionAffinity(
          async (current) =>
            writeSessionAffinitySnapshot(current, input.authMode, {
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
