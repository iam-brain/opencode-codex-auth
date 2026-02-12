export type PersonaTargetStyle = "lean" | "mid" | "friendly-sized"
export type PersonaDomain = "coding" | "audit" | "research" | "general"

export type PersonaToolInput = {
  source_text: string
  target_style: PersonaTargetStyle
  voice_fidelity: number
  competence_strictness: number
  domain?: PersonaDomain
  include_variants?: boolean
}

export type PersonaVariant = {
  agent_markdown: string
  token_estimate: number
}

export type PersonaToolOutput = {
  agent_markdown: string
  token_estimate: number
  voice_signature: string[]
  protocol_rules: string[]
  failure_modes_prevented: string[]
  diff_summary: string
  variants?: {
    lean: PersonaVariant
    mid: PersonaVariant
    friendly_sized: PersonaVariant
  }
}

type StyleProfile = {
  minTokens: number
  maxTokens: number
  voiceRuleCount: number
  detailLevel: 1 | 2 | 3
}

const STYLE_PROFILES: Record<PersonaTargetStyle, StyleProfile> = {
  lean: { minTokens: 250, maxTokens: 450, voiceRuleCount: 4, detailLevel: 1 },
  mid: { minTokens: 500, maxTokens: 800, voiceRuleCount: 6, detailLevel: 2 },
  "friendly-sized": { minTokens: 1100, maxTokens: 1400, voiceRuleCount: 8, detailLevel: 3 }
}

const REQUIRED_POLICY_TITLES = [
  "Clarify vs Assume",
  "Disagree / Correct",
  "Momentum",
  "Accuracy",
  "Self-Correction",
  "Verbosity Control",
  "Safety/Refusal"
] as const

const PROTOCOL_FAILURE_MODES = [
  "over-asking clarifications",
  "overconfidence presented as certainty",
  "stalling instead of progressing",
  "speculation presented as fact",
  "runaway verbosity",
  "failure to self-correct"
]

const SLANG_TERMS = ["dude", "bro", "chief", "buddy", "fam", "yo", "lmao", "lol", "goblin", "meme"]

const GOOFY_TERMS = ["chaotic", "chaos", "goofy", "silly", "clown", "nonsense", "absurd", "gremlin"]

const WARMTH_TERMS = ["friendly", "warm", "supportive", "encouraging", "kind", "empathetic"]

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function sanitizeSourceText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function hasEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text)
}

function extractAddressTerms(lower: string): string[] {
  const terms = ["my dude", "chief", "buddy", "friend", "captain", "boss", "homie", "pal"]
  return terms.filter((term) => lower.includes(term))
}

function pickQuotedFragments(source: string): string[] {
  const matches = source.match(/"([^"\n]{3,60})"/g) ?? []
  const cleaned = matches.map((entry) => entry.replaceAll('"', "").trim()).filter((entry) => entry.length >= 3)
  return cleaned.slice(0, 3)
}

function extractVoiceSignature(sourceText: string, fidelity: number): string[] {
  const source = sanitizeSourceText(sourceText)
  const lower = source.toLowerCase()
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const result: string[] = []

  const slangHits = SLANG_TERMS.filter((term) => lower.includes(term))
  if (slangHits.length > 0) {
    result.push(`Uses slang/casual terms (${slangHits.slice(0, 4).join(", ")}).`)
  }

  const goofyHits = GOOFY_TERMS.filter((term) => lower.includes(term))
  if (goofyHits.length > 0) {
    result.push(`Leans into playful or chaotic humor (${goofyHits.slice(0, 4).join(", ")}).`)
  }

  const warmthHits = WARMTH_TERMS.filter((term) => lower.includes(term))
  if (warmthHits.length > 0) {
    result.push(`Maintains warm/supportive framing (${warmthHits.slice(0, 4).join(", ")}).`)
  }

  if (hasEmoji(source)) {
    result.push("Includes emoji as part of tone and emphasis.")
  }

  const exclamationCount = (source.match(/!/g) ?? []).length
  if (exclamationCount >= 3) {
    result.push("Prefers energetic punctuation and punchy emphasis.")
  }

  const addressTerms = extractAddressTerms(lower)
  if (addressTerms.length > 0) {
    result.push(`Directly addresses the user with recurring motifs (${addressTerms.join(", ")}).`)
  }

  const quoted = pickQuotedFragments(source)
  if (quoted.length > 0) {
    result.push(`Has explicit catchphrase-style fragments: ${quoted.join(" | ")}.`)
  }

  const avgLineLen =
    lines.length > 0 ? Math.round(lines.reduce((sum, line) => sum + line.split(/\s+/).length, 0) / lines.length) : 0
  if (avgLineLen > 18) {
    result.push("Uses longer, descriptive phrasing and richer context.")
  } else if (avgLineLen > 0) {
    result.push("Uses short-to-medium phrasing with quick cadence.")
  }

  if (result.length === 0) {
    result.push("Use the source voice cadence and vocabulary faithfully without flattening tone.")
  }

  const maxRules = Math.max(4, Math.min(10, Math.round(4 + fidelity * 6)))
  return result.slice(0, maxRules)
}

function extractBehavioralIntents(sourceText: string): string[] {
  const source = sanitizeSourceText(sourceText).toLowerCase()
  const intents: string[] = []

  const mapping: Array<{ pattern: RegExp; intent: string }> = [
    { pattern: /never ask|don't ask|do not ask/, intent: "discourages clarifying questions" },
    { pattern: /always sound sure|never admit uncertainty|always confident/, intent: "demands overconfidence" },
    { pattern: /always hype|always agree|never disagree/, intent: "pushes sycophantic agreement" },
    { pattern: /be concise|short answers|brief only/, intent: "prefers concise responses" },
    { pattern: /be verbose|long explanation|tons of detail/, intent: "pushes high verbosity" },
    { pattern: /chaotic|goofy|meme|silly/, intent: "wants comedic character fidelity" }
  ]

  for (const item of mapping) {
    if (item.pattern.test(source)) intents.push(item.intent)
  }

  return Array.from(new Set(intents))
}

function strictVerb(strictness: number): string {
  if (strictness >= 0.75) return "Must"
  if (strictness >= 0.4) return "Should"
  return "Prefer to"
}

function synthesizeProtocolRules(strictness: number): string[] {
  const verb = strictVerb(strictness)
  return [
    `Clarify vs Assume: ${verb} ask only when uncertainty materially changes outcome, otherwise state assumptions briefly and proceed.`,
    `Disagree / Correct: ${verb} extend when correct, test when uncertain, and correct clearly when wrong with concrete alternatives.`,
    `Momentum: ${verb} perform useful next actions immediately, then propose verification-oriented next steps.`,
    `Accuracy: ${verb} avoid speculation-as-fact, mark confidence level, and define quick resolution paths for uncertainty.`,
    `Self-Correction: ${verb} acknowledge discovered errors plainly, fix them promptly, and continue without defensive framing.`,
    `Verbosity Control: ${verb} default to concise output and expand only when task complexity justifies more detail.`,
    `Safety/Refusal: ${verb} pause calmly on unsafe requests, explain concern contextually, and offer safer aligned alternatives.`
  ]
}

function collectFailureModes(intents: string[]): string[] {
  const modes = [...PROTOCOL_FAILURE_MODES]
  if (intents.includes("discourages clarifying questions")) {
    modes.push("missing critical clarification before execution")
  }
  if (intents.includes("demands overconfidence")) {
    modes.push("false certainty under uncertainty")
  }
  if (intents.includes("pushes high verbosity")) {
    modes.push("signal loss from overlong answers")
  }
  return Array.from(new Set(modes))
}

function renderDomainSection(domain: PersonaDomain): string[] {
  if (domain === "coding") {
    return [
      "## Domain Add-ons (coding)",
      "- State assumptions, prerequisites, and environment constraints before irreversible steps.",
      "- Do not hallucinate APIs, package versions, or command outcomes; verify with local evidence.",
      "- Prefer minimal, reversible diffs and provide concrete verification commands (tests/build/lint).",
      ""
    ]
  }
  if (domain === "audit") {
    return [
      "## Domain Add-ons (audit)",
      "- Prioritize findings by severity and include concrete evidence paths.",
      "- Separate confirmed findings from hypotheses and state residual risk clearly.",
      "- Recommend mitigations with rollback-safe sequencing.",
      ""
    ]
  }
  if (domain === "research") {
    return [
      "## Domain Add-ons (research)",
      "- Distinguish observed facts from inferred conclusions.",
      "- Provide concise source-backed summaries and unresolved questions.",
      "- Suggest next probes that reduce uncertainty quickly.",
      ""
    ]
  }
  return [
    "## Domain Add-ons (general)",
    "- Keep plans actionable, testable, and scoped.",
    "- Surface assumptions and constraints when they affect outcomes.",
    "- Maintain momentum with next-step suggestions tied to user goals.",
    ""
  ]
}

function buildProtocolInteractionBlock(detailLevel: 1 | 2 | 3): string[] {
  const lines = [
    "## Interaction Protocol (drift prevention)",
    "1. Observe request and constraints.",
    "2. Decide clarify vs assume using material-impact rule.",
    "3. Execute smallest useful step immediately.",
    "4. Verify outcomes and report confidence.",
    "5. Self-correct fast when new evidence conflicts with prior assumptions."
  ]
  if (detailLevel >= 2) {
    lines.push("6. Keep voice consistent while never weakening accuracy or safety policies.")
  }
  if (detailLevel >= 3) {
    lines.push("7. Re-anchor every few turns: intent, progress, risks, and next verifiable action.")
    lines.push(
      "8. If style and protocol conflict, preserve style externally but obey protocol internally without exception."
    )
  }
  lines.push("")
  return lines
}

function truncateVoiceRules(voice: string[], targetCount: number): string[] {
  if (voice.length <= targetCount) return voice
  return voice.slice(0, targetCount)
}

function renderMarkdown(input: {
  style: PersonaTargetStyle
  sourceText: string
  voiceSignature: string[]
  protocolRules: string[]
  domain: PersonaDomain
  competenceStrictness: number
  intents: string[]
}): string {
  const profile = STYLE_PROFILES[input.style]
  const strict = strictVerb(input.competenceStrictness)
  const voiceRules = truncateVoiceRules(input.voiceSignature, profile.voiceRuleCount)
  const lines: string[] = [
    "# Agent Specification",
    "",
    "## Voice Layer (How you sound)",
    "- Preserve the source voice signature faithfully, including quirky tone and stylistic motifs.",
    ...voiceRules.map((rule) => `- ${rule}`),
    "- Keep phrasing in-character even when the style is silly or intentionally dumb-sounding.",
    "- Voice never overrides protocol correctness, safety, or honesty.",
    ""
  ]

  if (profile.detailLevel >= 2) {
    lines.push(
      "In-character uncertainty example: \"I feel good about this direction, but I'm not fully certain yet — let's verify with a quick check.\"",
      ""
    )
  }

  lines.push("## Protocol Layer (How you behave)")
  lines.push(...input.protocolRules.map((rule) => `- ${rule}`))
  lines.push(
    `- Competence override: ${strict} preserve factual integrity and delivery momentum even when voice directives demand pure confidence or nonstop hype.`,
    ""
  )

  if (input.intents.length > 0) {
    lines.push(
      "## Normalized Behavioral Intents",
      ...input.intents.map((intent) => `- Detected source intent: ${intent}.`),
      ""
    )
  }

  lines.push(...renderDomainSection(input.domain))
  lines.push(...buildProtocolInteractionBlock(profile.detailLevel))

  if (profile.detailLevel >= 3) {
    lines.push(
      "## Reinforcement Examples",
      "- Clarify vs Assume: if a missing requirement changes architecture, ask; if not, proceed with a stated default.",
      "- Accuracy: label confidence numerically when uncertain and name the fastest verification path.",
      "- Momentum: after each action, propose the next concrete check to prevent stalls.",
      "- Self-correction: if a command output contradicts prior assumptions, acknowledge and pivot immediately.",
      ""
    )
  }

  let markdown = `${lines.join("\n").trim()}\n`

  const reinforcementPool = [
    "Protocol reinforcement: do useful work first, then ask for only the smallest blocking clarification.",
    "Protocol reinforcement: disagreement is constructive and concrete, never performative or vague.",
    "Protocol reinforcement: uncertainty must be explicit and coupled with a verification plan.",
    "Protocol reinforcement: keep outputs concise unless complexity requires expansion.",
    "Protocol reinforcement: if safety blocks direct execution, provide nearest safe alternative path.",
    "Protocol reinforcement: maintain style consistency without sacrificing correctness.",
    "Protocol reinforcement: assumptions should be short, explicit, and testable.",
    "Protocol reinforcement: close each major response with next-step momentum."
  ]

  let reinforcementIndex = 0
  while (estimateTokens(markdown) < profile.minTokens && reinforcementIndex < reinforcementPool.length) {
    markdown = `${markdown.trimEnd()}\n${reinforcementPool[reinforcementIndex]}\n`
    reinforcementIndex += 1
  }

  const deepReinforcement = [
    'Extended protocol note: If source voice says "never ask questions," reinterpret that as "avoid unnecessary friction" while still asking one blocking clarifier when architecture, security, or destructive operations depend on it.',
    'Extended protocol note: If source voice says "always be confident," keep the energetic delivery but label confidence numerically (for example 0.7 confidence) and attach a concrete verification step before final claims.',
    "Extended protocol note: Maintain a short execution loop in long sessions — restate objective, report completed action, report current risk, and propose one verifiable next action to prevent drift.",
    "Extended protocol note: In goofy or meme-heavy voices, preserve slang and metaphor while keeping operational language explicit enough for reproducible execution and debugging.",
    "Extended protocol note: For collaborative resilience, acknowledge user corrections quickly, update assumptions immediately, and continue without defensiveness or unnecessary restarts.",
    "Extended protocol note: When uncertain about external dependencies, avoid hallucinated specifics; prefer evidence-first phrasing and name the exact command or lookup required to resolve uncertainty."
  ]
  let deepAdded = 0
  if (profile.detailLevel === 3 && estimateTokens(markdown) < profile.minTokens) {
    let deepIndex = 0
    while (estimateTokens(markdown) < profile.minTokens && deepIndex < deepReinforcement.length) {
      markdown = `${markdown.trimEnd()}\n${deepReinforcement[deepIndex]}\n`
      deepIndex += 1
      deepAdded += 1
    }
  }

  while (estimateTokens(markdown) > profile.maxTokens && reinforcementIndex > 0) {
    reinforcementIndex -= 1
    const needle = `\n${reinforcementPool[reinforcementIndex]}\n`
    markdown = markdown.replace(needle, "\n")
  }

  while (estimateTokens(markdown) > profile.maxTokens && deepAdded > 0) {
    deepAdded -= 1
    const needle = `\n${deepReinforcement[deepAdded]}\n`
    markdown = markdown.replace(needle, "\n")
  }

  return `${markdown.trimEnd()}\n`
}

function buildDiffSummary(input: { voiceSignature: string[]; protocolRules: string[]; intents: string[] }): string {
  const conflicts = input.intents.filter(
    (intent) => intent.includes("overconfidence") || intent.includes("discourages")
  )
  if (conflicts.length === 0) {
    return `Preserved ${input.voiceSignature.length} voice traits and enforced ${input.protocolRules.length} protocol rules with competence-first behavior.`
  }
  return `Preserved ${input.voiceSignature.length} voice traits while overriding conflicting directives (${conflicts.join(", ")}) with ${input.protocolRules.length} competence rules.`
}

export function generatePersonaSpec(rawInput: PersonaToolInput): PersonaToolOutput {
  const sourceText = sanitizeSourceText(rawInput.source_text)
  const style = rawInput.target_style
  const domain: PersonaDomain = rawInput.domain ?? "general"
  const voiceFidelity = clamp01(rawInput.voice_fidelity)
  const competenceStrictness = clamp01(rawInput.competence_strictness)
  const includeVariants = rawInput.include_variants !== false

  const voiceSignature = extractVoiceSignature(sourceText, voiceFidelity)
  const intents = extractBehavioralIntents(sourceText)
  const protocolRules = synthesizeProtocolRules(competenceStrictness)
  const failureModes = collectFailureModes(intents)

  const renderForStyle = (targetStyle: PersonaTargetStyle): PersonaVariant => {
    const markdown = renderMarkdown({
      style: targetStyle,
      sourceText,
      voiceSignature,
      protocolRules,
      domain,
      competenceStrictness,
      intents
    })
    return {
      agent_markdown: markdown,
      token_estimate: estimateTokens(markdown)
    }
  }

  const selected = renderForStyle(style)

  const output: PersonaToolOutput = {
    agent_markdown: selected.agent_markdown,
    token_estimate: selected.token_estimate,
    voice_signature: voiceSignature,
    protocol_rules: REQUIRED_POLICY_TITLES.map((title, index) => protocolRules[index] ?? title),
    failure_modes_prevented: failureModes,
    diff_summary: buildDiffSummary({ voiceSignature, protocolRules, intents })
  }

  if (includeVariants) {
    output.variants = {
      lean: renderForStyle("lean"),
      mid: renderForStyle("mid"),
      friendly_sized: renderForStyle("friendly-sized")
    }
  }

  return output
}
