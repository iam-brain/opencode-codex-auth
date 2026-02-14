#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

const WATCH_FILE = new URL("../docs/development/upstream-watch.json", import.meta.url)
const USER_AGENT = "opencode-codex-auth-upstream-watch"

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT
    }
  })
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }
  return response.json()
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain",
      "User-Agent": USER_AGENT
    }
  })
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }
  return response.text()
}

function buildRawUrl(repo, ref, filePath) {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${filePath}`
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

  const compareUrl = `https://github.com/${source.repo}/compare/${source.baselineTag}...${latestTag}`
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
  if (anyDrift) process.exitCode = 1
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`upstream watch failed: ${message}\n`)
  process.exit(1)
})
