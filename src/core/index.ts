export { explain, buildRequest, prepareRequest } from "./explain.js";
export type { ExplainEvent, LanguageModel, ModelRequest, Settings } from "./types.js";
export {
  BadKeyError,
  BlockedFileError,
  ContextTooLongError,
  ExitCode,
  FileNotFoundError,
  FileRefusedError,
  LearnError,
  ModelNotFoundError,
  NetworkError,
  PathEscapeError,
  ProviderError,
  RateLimitError,
  RefusedError,
  RuntimeError,
  UnexpectedError,
  UntrustedRepoError,
  UsageError,
} from "./errors.js";
export type { BlockReason, FileRefusal } from "./errors.js";
export { parseReference, resolveReference, defaultResolvers } from "./reference.js";
export type { Excerpt, Reference, Resolver, Resolvers } from "./reference.js";
export { findRepo, runGit } from "./git.js";
export type { GitOptions, GitRepo, GitSubcommand } from "./git.js";
export { LEVELS, DEFAULT_LEVEL, isLevel } from "./prompt.js";
export type { Level } from "./prompt.js";
export { findProjectRoot, locateFile, isInside } from "./root.js";
export type { ProjectRoot, LocatedFile } from "./root.js";
export { createFileReader, denylistRule, insecureTransportWarning, isLocalHost, resolveEndpoint } from "./sensitive.js";
export type { FileReader, Endpoint, FileReaderOptions, SensitiveBypass } from "./sensitive.js";
export { braceBlockFinder, BRACE_EXTENSIONS } from "./brace-block-finder.js";
export { pythonBlockFinder, PYTHON_EXTENSIONS } from "./python-block-finder.js";
export { blockFinderFor } from "./block-finder-for.js";
export { assertExcerptFits, defaultBudget, isValidBudget, resolveBudget, HOSTED_BUDGET, LOCAL_BUDGET } from "./budget.js";
export type { Budget, BudgetSource, Dropped } from "./budget.js";
export { noBlockFinder, findImportBlock, gatherContext, WINDOW_LINES } from "./context.js";
export type { BlockFinder, Context, LineSpan } from "./context.js";
export { buildContextReport, formatContextReport, reportForError } from "./report.js";
export type { ContextReport, ReportedRange } from "./report.js";
export { EXAMPLE_CONFIG, configPath, describeMissing, firstRunMessage, parseConfig, redactUrl, HIDDEN, resolveSettings } from "./settings.js";
export type { Config, Flags, Resolution, ResolvedSettings } from "./settings.js";
export { resolveApiKey } from "./api-key.js";
export { readTextFile } from "./read-file.js";
