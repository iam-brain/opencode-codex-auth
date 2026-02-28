#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

const WATCH_FILE = new URL("../docs/development/upstream-watch.json", import.meta.url)
const USER_AGENT = "opencode-codex-auth-upstream-watch"
const FETCH_TIMEOUT_MS = 10_000
const FETCH_MAX_RETRIES = 3
const FETCH_RETRY_BASE_DELAY_MS = 750
const EXIT_CODE_DRIFT = 1
const EXIT_CODE_OPERATIONAL_FAILURE = 2

class RetryableUpstreamError extends Error {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

async function fetchWithTimeout(url, accept) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: accept,
        "User-Agent": USER_AGENT
      }
    })
    if (!response.ok) {
      if (isRetryableStatus(response.status)) {
        throw new RetryableUpstreamError(`Request failed (${response.status}) for ${url}`)
      }
      throw new Error(`Request failed (${response.status}) for ${url}`)
    }
    return response
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new RetryableUpstreamError(`Request timed out after ${FETCH_TIMEOUT_MS}ms for ${url}`)
    }
    if (error instanceof RetryableUpstreamError) {
      throw error
    }
    if (error instanceof TypeError) {
      throw new RetryableUpstreamError(`Network request failed for ${url}: ${error.message}`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchWithRetry(url, accept) {
  let attempt = 0
  while (true) {
    try {
      return await fetchWithTimeout(url, accept)
    } catch (error) {
      if (!(error instanceof RetryableUpstreamError) || attempt >= FETCH_MAX_RETRIES - 1) {
        throw error
      }
      const delayMs = FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt
      await sleep(delayMs)
      attempt += 1
    }
  }
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, "application/vnd.github+json")
  return response.json()
}

async function fetchText(url) {
  const response = await fetchWithRetry(url, "text/plain")
  return response.text()
}

function assertValidTrackedFile(item) {
  if (!item || typeof item.path !== "string" || item.path.trim().length === 0) {
    throw new Error("Invalid upstream watch file entry: missing path")
  }
  if (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(item.sha256)) {
    throw new Error(`Invalid upstream watch file entry sha256 for path: ${item.path}`)
  }
}

function encodePathSegments(value) {
  return value
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function buildRawUrl(repo, ref, filePath) {
  return `https://raw.githubusercontent.com/${encodePathSegments(repo)}/${encodeURIComponent(ref)}/${encodePathSegments(filePath)}`
}

function encodeCompareRef(ref) {
  return encodeURIComponent(ref)
}

function normalizeConfig(parsed) {
  if (Array.isArray(parsed?.sources) && parsed.sources.length > 0) return parsed
  if (parsed && typeof parsed.repo === "string" && Array.isArray(parsed.files)) {
    return {
      sources: [
        {
          id: "opencode",
          repo: parsed.repo,
          baselineTag: parsed.baselineTag,
          updatedAt: parsed.updatedAt,
          files: parsed.files
        }
      ]
    }
  }
  throw new Error("Invalid upstream watch config: expected sources[]")
}

async function loadWatchConfig() {
  const raw = await readFile(WATCH_FILE, "utf8")
  return normalizeConfig(JSON.parse(raw))
}

function buildReport({ source, latestTag, compareUrl, results }) {
  const changed = results.filter((item) => item.changed)
  const tagDrift = latestTag !== source.baselineTag
  const lines = [
    `Upstream watch source: ${source.id ?? source.repo}`,
    `Upstream watch repo: ${source.repo}`,
    `Baseline tag: ${source.baselineTag}`,
    `Latest release tag: ${latestTag}`,
    `Compare: ${compareUrl}`
  ]

  if (!tagDrift && changed.length === 0) {
    lines.push("Status: no tracked file hash changes detected.")
    return lines.join("\n")
  }

  if (tagDrift) lines.push("Status: upstream release tag drift detected.")
  if (changed.length > 0) {
    lines.push(`Status: ${changed.length} tracked file(s) changed.`)
    for (const item of changed) {
      lines.push(`- ${item.path}`)
      lines.push(`  baseline: ${item.baselineSha}`)
      lines.push(`  latest:   ${item.latestSha}`)
    }
  } else {
    lines.push("Status: tracked file hashes match, but baseline tag is behind latest release.")
  }
  return lines.join("\n")
}

async function collectSourceResult(source) {
  const release = await fetchJson(`https://api.github.com/repos/${source.repo}/releases/latest`)
  const latestTag =
    typeof release.tag_name === "string" && release.tag_name.trim() ? release.tag_name.trim() : undefined
  if (!latestTag) throw new Error(`Unable to resolve latest release tag for ${source.repo}`)

  const results = []
  for (const item of source.files) {
    assertValidTrackedFile(item)
    const rawUrl = buildRawUrl(source.repo, latestTag, item.path)
    const text = await fetchText(rawUrl)
    const latestSha = sha256(text)
    results.push({
      path: item.path,
      baselineSha: item.sha256,
      latestSha,
      changed: latestSha !== item.sha256
    })
  }

  const compareUrl = `https://github.com/${source.repo}/compare/${encodeCompareRef(source.baselineTag)}...${encodeCompareRef(latestTag)}`
  const hasTagDrift = latestTag !== source.baselineTag
  const hasHashDrift = results.some((result) => result.changed)
  const drift = hasTagDrift || hasHashDrift
  return { latestTag, results, compareUrl, drift }
}

async function main() {
  const update = process.argv.includes("--update")
  const watch = await loadWatchConfig()

  const reports = []
  const nextSources = []
  let anyDrift = false

  for (const source of watch.sources) {
    if (!source || typeof source.repo !== "string" || !Array.isArray(source.files)) {
      throw new Error("Invalid upstream watch source entry")
    }
    const collected = await collectSourceResult(source)
    reports.push(
      buildReport({
        source,
        latestTag: collected.latestTag,
        compareUrl: collected.compareUrl,
        results: collected.results
      })
    )
    anyDrift = anyDrift || collected.drift

    if (update) {
      nextSources.push({
        ...source,
        baselineTag: collected.latestTag,
        updatedAt: new Date().toISOString(),
        files: source.files.map((item) => {
          const found = collected.results.find((result) => result.path === item.path)
          return {
            ...item,
            sha256: found ? found.latestSha : item.sha256
          }
        })
      })
    }
  }

  if (update) {
    const next = {
      ...watch,
      sources: nextSources
    }
    await writeFile(WATCH_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8")
    process.stdout.write(`Updated ${new URL(WATCH_FILE).pathname} from GitHub latest releases.\n`)
    return
  }

  process.stdout.write(`${reports.join("\n\n")}\n`)
  if (anyDrift) process.exitCode = EXIT_CODE_DRIFT
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`upstream watch failed: ${message}\n`)
  process.exit(EXIT_CODE_OPERATIONAL_FAILURE)
})
