# Codex-to-OpenCode Prompt Compatibility

Codex prompt behavior cannot be copied into OpenCode safely by changing tool names in prose. The two harnesses differ in tool schemas, agent lifecycle, concurrency, steering, cancellation, injected context, and instruction precedence. This document defines the maintainable workflow for adapting a pinned Codex prompt surface to OpenCode.

Ultra uses this workflow for its proactive and explicit-request-only mode overlays. The scope is deliberately narrow: it adapts the Codex delegation-policy wording to OpenCode's `task` tool without copying Codex-specific collaboration tools, limits, or lifecycle instructions.

## Design goals

- Preserve portable upstream wording exactly where the harnesses agree.
- Make every harness-specific difference explicit and reviewable.
- Fail closed when the pinned source or an expected replacement changes.
- Separate verified harness facts from policy choices made by this plugin.
- Generate runtime prompt artifacts deterministically instead of editing them by hand.
- Test the final composed OpenCode instructions, not only individual replacement rules.

## Artifact model

The implementation follows the same source-to-generated pattern used by Claudex:

| Artifact | Responsibility |
| --- | --- |
| Pinned Codex source | Verbatim upstream prompt fragment plus source repository, tag or commit, path, and SHA-256. |
| Harness evidence manifest | Pinned Codex and OpenCode source files and the exact symbols that prove each mapped capability. |
| Transformation rules | Ordered declarative operations with exact expected match counts. |
| Generator | Validates the source hash, applies only supported operations, and writes atomically. |
| Generated OpenCode overlay | Runtime artifact; never edited directly. |
| Drift checker | Regenerates in memory, compares output byte-for-byte, and audits pinned source evidence. |

The current scope is the Ultra multi-agent overlay only. It does not replace OpenCode's full base prompt or create a second general-purpose orchestrator.

## Difference inventory

Before adding a transformation, record the contract on both sides. The checked-in evidence and rules live under `prompts/`, the generator is `scripts/generate-prompt-compatibility.mjs`, and the runtime artifact is `lib/codex-native/generated/ultra-instructions.ts`.

| Surface | Codex evidence | OpenCode evidence | Adaptation decision |
| --- | --- | --- | --- |
| Delegation tools | `spawn_agent`-based collaboration family | `task` with `description`, `prompt`, `subagent_type`, and optional `task_id` | Replace Codex's generic spawn/use wording with OpenCode's `task` tool; leave parameters to the host tool schema. |
| Child identity | Root/child role and inheritance rules | Session parentage, agent mode, and child model inheritance | Translate only states represented by OpenCode hooks. |
| Concurrency | Limit and scheduling semantics | Host task scheduling semantics | Do not copy Codex limits unless OpenCode enforces the same contract. |
| Steering and follow-up | Codex agent messaging lifecycle | OpenCode task/session lifecycle | Remove or replace unsupported actions explicitly. |
| Cancellation and failure | Codex failure propagation | OpenCode tool and session errors | Keep the root turn recoverable when the host contract allows it. |
| Instruction precedence | Codex developer-overlay ordering | OpenCode hook composition ordering | Verify the final composed prompt and idempotent replacement behavior. |
| Auxiliary turns | Codex title, summary, and compaction policy | OpenCode auxiliary request detection | Keep delegation overlays off auxiliary turns. |

Each row must cite a pinned file and symbol in the evidence manifest. A statement observed only in a session log is a hypothesis until matched to source or a stable public contract.

## Allowed transformations

Keep the rule language intentionally small:

- `replace_literal` with `expectedCount`.

The generator rejects unknown operations, hash mismatches, missing constants, unexpected match counts, missing evidence symbols, and output drift. It does not use regular-expression substitutions for semantic rewrites or silently accept upstream changes.

## Verification contract

A prompt-compatibility change is complete only when all of these pass:

1. The pinned Codex prompt hash matches.
2. Every Codex and OpenCode evidence file exists at its pinned revision and contains the declared symbols.
3. Generation is deterministic and `--check` reports a byte-for-byte match.
4. Tests cover root, child, auxiliary, native-mode, disabled, degraded, retry, and idempotent composition paths.
5. A captured final OpenCode request contains the generated overlay exactly once and retains unrelated host instructions.
6. A manual Ultra smoke records the selected logical effort, final wire effort, available host tools, actual delegation calls, and child-session lineage separately.
7. `npm run verify` passes.

The smoke must not treat selecting `ultra` as proof that delegation occurred. OpenCode can log the logical `ultra` selection before the plugin's last-mile transform; the backend receives `runtime.ultraReasoningEffort`, which defaults to `max`.

## Update workflow

1. Pin the new Codex and OpenCode revisions.
2. Run the evidence audit before changing rules.
3. Review upstream prompt differences independently from harness API differences.
4. Update the difference inventory and transformation rules together.
5. Regenerate the runtime artifact.
6. Inspect the source-to-generated diff and final composed-prompt fixtures.
7. Run the verification contract and record any intentional compatibility gaps in `docs/development/ULTRA.md`.

Do not update a source hash merely to make the checker pass. A changed hash is a review trigger: either the existing mapping is still valid and can be repinned with evidence, or the transformation and its tests must change.

## Commands

```bash
npm run generate:prompts
npm run check:prompts
```

`generate:prompts` validates every pinned source before atomically replacing the generated runtime module. `npm run build` runs generation before TypeScript compilation, producing `dist/lib/codex-native/generated/ultra-instructions.js`; `prepack` runs that build, so the completed overlay and the applicable upstream license and notice files are included in the published package. `check:prompts` performs the same validation in memory and fails if the checked-in module differs. The full `npm run verify` gate checks drift and then exercises the build and distribution smoke path.
