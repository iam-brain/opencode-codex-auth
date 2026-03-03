export type AccountSelectionTrace = {
  strategy: string
  decision: string
  totalCount: number
  disabledCount: number
  cooldownCount: number
  refreshLeaseCount: number
  eligibleCount: number
  attemptedCount?: number
  selectedIdentityKey?: string
  selectedIndex?: number
  attemptKey?: string
  activeIdentityKey?: string
  sessionKey?: string
}

export type AuthData = {
  access: string
  accountId?: string
  identityKey?: string
  email?: string
  plan?: string
  accountLabel?: string
  selectionTrace?: Partial<AccountSelectionTrace>
}

export type FetchOrchestratorAuthContext = {
  sessionKey: string | null
}

export type FetchOrchestratorState = {
  lastSessionKey: string | null
  lastSessionToastEventKey: string | null
  seenSessionKeys: Map<string, number>
  lastAccountKey: string | null
  rateLimitToastShownAt: Map<string, number>
  toastShownAt: Map<string, number>
}

export type FetchAttemptReasonCode =
  | "initial_attempt"
  | "retry_same_account_after_429"
  | "retry_switched_account_after_429"

export function createFetchOrchestratorState(): FetchOrchestratorState {
  return {
    lastSessionKey: null,
    lastSessionToastEventKey: null,
    seenSessionKeys: new Map<string, number>(),
    lastAccountKey: null,
    rateLimitToastShownAt: new Map<string, number>(),
    toastShownAt: new Map<string, number>()
  }
}

export type FetchOrchestratorDeps = {
  acquireAuth: (context?: FetchOrchestratorAuthContext) => Promise<AuthData>
  setCooldown: (identityKey: string, cooldownUntil: number) => Promise<void>
  now?: () => number
  maxAttempts?: number
  quietMode?: boolean
  rateLimitToastDebounceMs?: number
  state?: FetchOrchestratorState
  showToast?: (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
  onAttemptRequest?: (input: {
    attempt: number
    maxAttempts: number
    attemptReasonCode: FetchAttemptReasonCode
    request: Request
    auth: AuthData
    sessionKey: string | null
  }) => Promise<Request | void> | Request | void
  onAttemptResponse?: (input: {
    attempt: number
    maxAttempts: number
    attemptReasonCode: FetchAttemptReasonCode
    response: Response
    auth: AuthData
    sessionKey: string | null
  }) => Promise<void> | void
  onSessionObserved?: (input: {
    sessionKey: string
    now: number
    event: "new" | "resume" | "switch" | "seen"
  }) => Promise<void> | void
  validateRedirectUrl?: (url: URL) => void
  maxRedirects?: number
}
