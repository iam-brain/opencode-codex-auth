import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"

import type { CodexSpoofMode } from "../config.js"
import type { Logger } from "../logger.js"
import { defaultOpencodeCachePath } from "../paths.js"
import { fetchRemoteText } from "../remote-cache-fetch.js"
import { isFsErrorCode } from "../cache-io.js"
import type { CodexOriginator } from "./originator.js"
import { URL } from "node:url"

const DEFAULT_PLUGIN_VERSION = "0.1.0"
const DEFAULT_CODEX_CLIENT_VERSION = "0.97.0"
const CODEX_CLIENT_VERSION_CACHE_FILE = path.join(defaultOpencodeCachePath(), "codex-client-version.json")
const CODEX_CLIENT_VERSION_TTL_MS = 60 * 60 * 1000
const CODEX_GITHUB_RELEASES_API = "https://api.github.com/repos/openai/codex/releases/latest"
const CODEX_GITHUB_RELEASES_HTML = "https://github.com/openai/codex/releases/latest"
const REMOTE_RELEASE_ALLOWED_HOSTS = ["api.github.com", "github.com", "raw.githubusercontent.com"]

let cachedPluginVersion: string | undefined
let cachedMacProductVersion: string | undefined
let cachedTerminalUserAgentToken: string | undefined
let cachedCodexClientVersion: string | undefined
let codexClientVersionRefreshPromise: Promise<string> | undefined

function opencodeUserAgent(): string {
  const version = resolvePluginVersion()
  return `opencode/${version} (${os.platform()} ${os.release()}; ${os.arch()})`
}

function isPrintableAscii(value: string): boolean {
  if (!value) return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code > 0x7e) return false
  }
  return true
}

function sanitizeUserAgentCandidate(candidate: string, fallback: string, originator: string): string {
  if (isPrintableAscii(candidate)) return candidate

  const sanitized = Array.from(candidate)
    .map((char) => {
      const code = char.charCodeAt(0)
      return code >= 0x20 && code <= 0x7e ? char : "_"
    })
    .join("")

  if (isPrintableAscii(sanitized)) return sanitized
  if (isPrintableAscii(fallback)) return fallback
  return originator
}

function sanitizeTerminalToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._/-]/g, "_")
}

function nonEmptyEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

function splitProgramAndVersion(value: string): { program: string; version?: string } {
  const [program, version] = value.trim().split(/\s+/, 2)
  return {
    program: program ?? "unknown",
    ...(version ? { version } : {})
  }
}

function tmuxDisplayMessage(format: string): string | undefined {
  try {
    const value = execFileSync("tmux", ["display-message", "-p", format], { encoding: "utf8", timeout: 1500 }).trim()
    return value || undefined
  } catch (error) {
    if (error instanceof Error) {
      // tmux may be unavailable outside tmux sessions.
    }
    return undefined
  }
}

function ensureAllowedReleaseUrl(input: string): string {
  const parsed = new URL(input)
  if (parsed.protocol !== "https:") {
    throw new Error("invalid_release_url_scheme")
  }
  const host = parsed.hostname.toLowerCase()
  if (!REMOTE_RELEASE_ALLOWED_HOSTS.includes(host)) {
    throw new Error(`invalid_release_url_host:${host}`)
  }
  return parsed.toString()
}

function resolveTerminalUserAgentToken(env: NodeJS.ProcessEnv = process.env): string {
  if (cachedTerminalUserAgentToken) return cachedTerminalUserAgentToken

  const termProgram = nonEmptyEnv(env, "TERM_PROGRAM")
  const termProgramVersion = nonEmptyEnv(env, "TERM_PROGRAM_VERSION")
  const term = nonEmptyEnv(env, "TERM")
  const hasTmux = Boolean(nonEmptyEnv(env, "TMUX") || nonEmptyEnv(env, "TMUX_PANE"))

  if (termProgram && termProgram.toLowerCase() === "tmux" && hasTmux) {
    const tmuxTermType = tmuxDisplayMessage("#{client_termtype}")
    if (tmuxTermType) {
      const { program, version } = splitProgramAndVersion(tmuxTermType)
      cachedTerminalUserAgentToken = sanitizeTerminalToken(version ? `${program}/${version}` : program)
      return cachedTerminalUserAgentToken
    }
    const tmuxTermName = tmuxDisplayMessage("#{client_termname}")
    if (tmuxTermName) {
      cachedTerminalUserAgentToken = sanitizeTerminalToken(tmuxTermName)
      return cachedTerminalUserAgentToken
    }
  }

  if (termProgram) {
    cachedTerminalUserAgentToken = sanitizeTerminalToken(
      termProgramVersion ? `${termProgram}/${termProgramVersion}` : termProgram
    )
    return cachedTerminalUserAgentToken
  }

  const weztermVersion = nonEmptyEnv(env, "WEZTERM_VERSION")
  if (weztermVersion) {
    cachedTerminalUserAgentToken = sanitizeTerminalToken(`WezTerm/${weztermVersion}`)
    return cachedTerminalUserAgentToken
  }

  if (env.ITERM_SESSION_ID || env.ITERM_PROFILE || env.ITERM_PROFILE_NAME) {
    cachedTerminalUserAgentToken = "iTerm.app"
    return cachedTerminalUserAgentToken
  }

  if (env.TERM_SESSION_ID) {
    cachedTerminalUserAgentToken = "Apple_Terminal"
    return cachedTerminalUserAgentToken
  }

  if (env.KITTY_WINDOW_ID || term?.includes("kitty")) {
    cachedTerminalUserAgentToken = "kitty"
    return cachedTerminalUserAgentToken
  }

  if (env.ALACRITTY_SOCKET || term === "alacritty") {
    cachedTerminalUserAgentToken = "Alacritty"
    return cachedTerminalUserAgentToken
  }

  const konsoleVersion = nonEmptyEnv(env, "KONSOLE_VERSION")
  if (konsoleVersion) {
    cachedTerminalUserAgentToken = sanitizeTerminalToken(`Konsole/${konsoleVersion}`)
    return cachedTerminalUserAgentToken
  }

  if (env.GNOME_TERMINAL_SCREEN) {
    cachedTerminalUserAgentToken = "gnome-terminal"
    return cachedTerminalUserAgentToken
  }

  const vteVersion = nonEmptyEnv(env, "VTE_VERSION")
  if (vteVersion) {
    cachedTerminalUserAgentToken = sanitizeTerminalToken(`VTE/${vteVersion}`)
    return cachedTerminalUserAgentToken
  }

  if (env.WT_SESSION) {
    cachedTerminalUserAgentToken = "WindowsTerminal"
    return cachedTerminalUserAgentToken
  }

  if (term) {
    cachedTerminalUserAgentToken = sanitizeTerminalToken(term)
    return cachedTerminalUserAgentToken
  }

  cachedTerminalUserAgentToken = "unknown"
  return cachedTerminalUserAgentToken
}

function resolvePluginVersion(): string {
  if (cachedPluginVersion) return cachedPluginVersion

  const fromEnv = process.env.npm_package_version?.trim()
  if (fromEnv) {
    cachedPluginVersion = fromEnv
    return cachedPluginVersion
  }

  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    const parsed = JSON.parse(raw) as { version?: unknown }
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      cachedPluginVersion = parsed.version.trim()
      return cachedPluginVersion
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && !isFsErrorCode(error, "ENOENT")) {
      // Use fallback version below.
    }
    // Use fallback version below.
  }

  cachedPluginVersion = DEFAULT_PLUGIN_VERSION
  return cachedPluginVersion
}

function normalizeCodexClientVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

type CodexClientVersionCacheEntry = {
  version: string
  fetchedAt: number
}

function readCodexClientVersionCache(cacheFilePath: string): CodexClientVersionCacheEntry | undefined {
  try {
    const raw = readFileSync(cacheFilePath, "utf8")
    const parsed = JSON.parse(raw) as { version?: unknown; fetchedAt?: unknown }
    const version = normalizeCodexClientVersion(parsed.version)
    const fetchedAt =
      typeof parsed.fetchedAt === "number" && Number.isFinite(parsed.fetchedAt) ? parsed.fetchedAt : undefined
    if (!version) return undefined
    return {
      version,
      fetchedAt: fetchedAt ?? 0
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && !isFsErrorCode(error, "ENOENT")) {
      // Ignore unreadable cache.
    }
    return undefined
  }
}

function writeCodexClientVersionCache(
  entry: CodexClientVersionCacheEntry,
  cacheFilePath: string = CODEX_CLIENT_VERSION_CACHE_FILE
): void {
  try {
    mkdirSync(path.dirname(cacheFilePath), { recursive: true })
    const tempFilePath = `${cacheFilePath}.tmp.${Date.now().toString(36)}.${randomUUID()}`
    writeFileSync(tempFilePath, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 })
    renameSync(tempFilePath, cacheFilePath)
    chmodSync(cacheFilePath, 0o600)
  } catch (error) {
    if (!isFsErrorCode(error, "EACCES") && !isFsErrorCode(error, "EPERM")) {
      // best-effort cache persistence
    }
    // best-effort cache persistence
  }
}

function extractSemverFromTag(tag: string): string | undefined {
  const match = tag.match(/(\d+\.\d+\.\d+)/)
  return match?.[1]
}

async function fetchLatestCodexReleaseTag(fetchImpl: typeof fetch = fetch): Promise<string> {
  const apiResult = await fetchRemoteText(
    {
      key: "codex-release-api",
      url: CODEX_GITHUB_RELEASES_API
    },
    {
      fetchImpl,
      timeoutMs: 5000,
      allowedHosts: REMOTE_RELEASE_ALLOWED_HOSTS
    }
  )
  if (apiResult.status === "ok") {
    try {
      const payload = JSON.parse(apiResult.text) as { tag_name?: unknown }
      const tagName = normalizeCodexClientVersion(payload.tag_name)
      if (tagName) return tagName
    } catch (error) {
      if (error instanceof Error) {
        // best-effort API parse; continue to HTML fallback
      }
    }
  }

  const htmlResult = await fetchRemoteText(
    {
      key: "codex-release-html",
      url: CODEX_GITHUB_RELEASES_HTML
    },
    {
      fetchImpl,
      timeoutMs: 5000,
      allowedHosts: REMOTE_RELEASE_ALLOWED_HOSTS
    }
  )

  if (htmlResult.status !== "ok") {
    throw new Error("failed to fetch codex release tag")
  }

  const finalUrl = ensureAllowedReleaseUrl(htmlResult.finalUrl ?? CODEX_GITHUB_RELEASES_HTML)
  if (finalUrl.includes("/tag/")) {
    const tag = finalUrl.split("/tag/").pop()
    if (tag && !tag.includes("/")) return tag
  }

  const html = htmlResult.text
  const match = html.match(/\/openai\/codex\/releases\/tag\/([^"'/]+)/)
  if (match?.[1]) return match[1]
  throw new Error("failed to parse codex release tag")
}

export async function refreshCodexClientVersionFromGitHub(
  log?: Logger,
  options: {
    cacheFilePath?: string
    fetchImpl?: typeof fetch
    now?: () => number
    allowInTest?: boolean
  } = {}
): Promise<string> {
  const cacheFilePath = options.cacheFilePath ?? CODEX_CLIENT_VERSION_CACHE_FILE
  if (!options.allowInTest && (process.env.VITEST || process.env.NODE_ENV === "test")) {
    return resolveCodexClientVersion(cacheFilePath)
  }
  const now = options.now ?? Date.now
  const cached = readCodexClientVersionCache(cacheFilePath)
  const isFresh = cached && now() - cached.fetchedAt < CODEX_CLIENT_VERSION_TTL_MS
  if (isFresh) {
    if (cacheFilePath === CODEX_CLIENT_VERSION_CACHE_FILE) {
      cachedCodexClientVersion = cached.version
    }
    return cached.version
  }

  const run = async (): Promise<string> => {
    try {
      const releaseTag = await fetchLatestCodexReleaseTag(options.fetchImpl ?? fetch)
      const semver = extractSemverFromTag(releaseTag)
      if (!semver) throw new Error(`invalid_codex_release_tag:${releaseTag}`)
      const nextEntry: CodexClientVersionCacheEntry = { version: semver, fetchedAt: now() }
      writeCodexClientVersionCache(nextEntry, cacheFilePath)
      if (cacheFilePath === CODEX_CLIENT_VERSION_CACHE_FILE) {
        cachedCodexClientVersion = semver
      }
      return semver
    } catch (error) {
      log?.debug("codex client version refresh failed", {
        error: error instanceof Error ? error.message : String(error)
      })
      const fallback = cached?.version ?? DEFAULT_CODEX_CLIENT_VERSION
      if (cacheFilePath === CODEX_CLIENT_VERSION_CACHE_FILE) {
        cachedCodexClientVersion = fallback
      }
      return fallback
    }
  }

  if (cacheFilePath !== CODEX_CLIENT_VERSION_CACHE_FILE) {
    return run()
  }
  if (codexClientVersionRefreshPromise) return codexClientVersionRefreshPromise
  codexClientVersionRefreshPromise = run().finally(() => {
    codexClientVersionRefreshPromise = undefined
  })
  return codexClientVersionRefreshPromise
}

export function resolveCodexClientVersion(cacheFilePath: string = CODEX_CLIENT_VERSION_CACHE_FILE): string {
  if (cacheFilePath === CODEX_CLIENT_VERSION_CACHE_FILE && cachedCodexClientVersion) {
    return cachedCodexClientVersion
  }

  const fromCache = readCodexClientVersionCache(cacheFilePath)?.version
  const resolved = fromCache ?? cachedCodexClientVersion ?? DEFAULT_CODEX_CLIENT_VERSION

  if (cacheFilePath === CODEX_CLIENT_VERSION_CACHE_FILE) {
    cachedCodexClientVersion = resolved
  }
  return resolved
}

function resolveMacProductVersion(): string {
  if (cachedMacProductVersion) return cachedMacProductVersion
  try {
    const value = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8", timeout: 1500 }).trim()
    cachedMacProductVersion = value || os.release()
  } catch (error) {
    if (error instanceof Error) {
      // fallback to kernel release
    }
    cachedMacProductVersion = os.release()
  }
  return cachedMacProductVersion
}

function normalizeArchitecture(architecture: string): string {
  if (architecture === "x64") return "x86_64"
  if (architecture === "arm64") return "arm64"
  return architecture || "unknown"
}

function resolveCodexPlatformSignature(platform: NodeJS.Platform = process.platform): string {
  const architecture = normalizeArchitecture(os.arch())
  if (platform === "darwin") {
    return `Mac OS ${resolveMacProductVersion()}; ${architecture}`
  }
  if (platform === "win32") {
    return `Windows ${os.release()}; ${architecture}`
  }
  if (platform === "linux") {
    return `Linux ${os.release()}; ${architecture}`
  }
  return `${platform} ${os.release()}; ${architecture}`
}

export function buildCodexUserAgent(originator: CodexOriginator): string {
  if (originator === "opencode") return opencodeUserAgent()
  const buildVersion = resolvePluginVersion()
  const terminalToken = resolveTerminalUserAgentToken()
  const prefix = `${originator}/${buildVersion} (${resolveCodexPlatformSignature()}) ${terminalToken}`
  return sanitizeUserAgentCandidate(prefix, prefix, originator)
}

export function resolveRequestUserAgent(spoofMode: CodexSpoofMode, originator: CodexOriginator): string {
  if (spoofMode === "codex") return buildCodexUserAgent(originator)
  return opencodeUserAgent()
}
