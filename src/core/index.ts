export { explain, buildRequest, prepareRequest } from "./explain.js";
export { Session, followUp } from "./session.js";
export type { DroppedTurns } from "./session.js";
export { buildSystemPrompt } from "./prompt.js";
export type { ExplainEvent, LanguageModel, Message, ModelRequest, Settings } from "./types.js";
export {
  BadKeyError,
  BlockedFileError,
  CancelledError,
  DiffExcludedError,
  ContextTooLongError,
  ExitCode,
  FileNotFoundError,
  FileRefusedError,
  LearnError,
  ModelNotFoundError,
  NetworkError,
  NotesError,
  PathEscapeError,
  ProviderError,
  QuizError,
  RateLimitError,
  RefusedError,
  RuntimeError,
  SessionTooLongError,
  UnexpectedError,
  UntrustedRepoError,
  UsageError,
  WordNotFoundError,
  describeSearchLimits,
} from "./errors.js";
export type { BlockReason, FileRefusal, SearchLimits } from "./errors.js";
export { parseReference, pipedExcerpt, resolveReference, defaultResolvers } from "./reference.js";
export type { Excerpt, Reference, WordSearchNote, ResolverDeps, Resolver, Resolvers } from "./reference.js";
export { clipboardCommands, readClipboard } from "./clipboard.js";
export type { ClipboardCommand, ReadClipboardOptions } from "./clipboard.js";
export { findRepo, findRepoAround, runGit } from "./git.js";
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
export { assertExcerptFits, defaultBudget, isValidBudget, isValidContextWindow, resolveBudget, resolveSessionCap, DEFAULT_CONTEXT_WINDOW, HOSTED_BUDGET, localDefaultBudget } from "./budget.js";
export type { Budget, BudgetSource, Dropped } from "./budget.js";
export { noBlockFinder, findImportBlock, gatherContext, WINDOW_LINES } from "./context.js";
export type { BlockFinder, Context, LineSpan } from "./context.js";
export { buildBlameReport, buildContextReport, buildDiffReport, formatContextReport, hasOverride, reportForError } from "./report.js";
export type { ContextReport, ReportedRange } from "./report.js";
export { EXAMPLE_CONFIG, configPath, describeMissing, firstRunMessage, parseConfig, redactUrl, HIDDEN, resolveSettings, trimEnds, validateSetting } from "./settings.js";
export type { Config, Flags, Resolution, ResolvedSettings } from "./settings.js";
export { resolveApiKey } from "./api-key.js";
export type { KeyStore } from "./api-key.js";
export { readTextFile } from "./read-file.js";
export { INIT_PRESETS, renderConfig, testRequest } from "./init.js";
export type { InitAnswers, InitPreset, PresetName } from "./init.js";
export { attachReferences, findMentions } from "./attachments.js";
export type { AttachInput, Attached, Mention } from "./attachments.js";
export { findDefinition, listSearchableFiles } from "./word-search.js";
export type { FoundDefinition, SearchDeps, SearchList } from "./word-search.js";
export { appendGlossaryEntry, saveNote } from "./notes.js";
export type { NoteTurn } from "./notes.js";
export { QUIZ_LENGTH, generateQuiz, gradeAnswer, parseQuiz } from "./quiz.js";
