export {
  CONFIG_FILE,
  DEFAULT_CODEX_CONFIG,
  DEFAULT_CODEX_CONFIG_TEMPLATE,
  type BehaviorSettings,
  type CodexSpoofMode,
  type ModelBehaviorOverride,
  type ModelConfigOverride,
  type PersonalityOption,
  type PluginConfig,
  type PluginRuntimeMode,
  type PromptCacheKeyStrategy,
  type VerbosityOption
} from "./config/types.js"

export { type ConfigValidationResult, validateConfigFileObject } from "./config/validation.js"

export {
  buildResolvedBehaviorSettings,
  cloneBehaviorSettings,
  normalizePersonalityOption,
  normalizeVerbosityOption,
  parseConfigFileObject,
  parseConfigJsonWithComments,
  parseEnvBoolean,
  parseEnvNumber,
  parsePromptCacheKeyStrategy,
  parseRotationStrategy,
  parseRuntimeMode,
  parseSpoofMode
} from "./config/parse.js"

export {
  ensureDefaultConfigFile,
  loadConfigFile,
  resolveDefaultConfigPath,
  type EnsureDefaultConfigFileResult
} from "./config/io.js"

export {
  getBehaviorSettings,
  getCodexCompactionOverrideEnabled,
  getCollaborationProfileEnabled,
  getCompatInputSanitizerEnabled,
  getDebugEnabled,
  getHeaderSnapshotBodiesEnabled,
  getHeaderSnapshotsEnabled,
  getHeaderTransformDebugEnabled,
  getMode,
  getOrchestratorSubagentsEnabled,
  getPersonality,
  getPidOffsetEnabled,
  getProactiveRefreshBufferMs,
  getProactiveRefreshEnabled,
  getPromptCacheKeyStrategy,
  getQuietMode,
  getRemapDeveloperMessagesToUserEnabled,
  getRotationStrategy,
  getSpoofMode,
  getThinkingSummariesOverride,
  resolveConfig
} from "./config/resolve.js"
