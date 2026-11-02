export { buildApp } from "./app.js";
export type { BuildAppOptions, ListenerKind } from "./app.js";
export { serve } from "./bootstrap.js";
export type { ServeHandle } from "./bootstrap.js";
export { defaultDataDir, isLoopbackHost, isWildcardHost, validateServeConfig } from "./config.js";
export type { ServeConfigInput, ServerConfig } from "./config.js";
export { acquireDataDirLock, LockHeldError } from "./lock.js";
export type { DataDirLock } from "./lock.js";

export { canonicalJson, checksumOf } from "./storage/checksum.js";
export { readJsonFile, writeJsonAtomic } from "./storage/atomic-json.js";
export type { AtomicWriteHooks } from "./storage/atomic-json.js";
export { appendJsonlLine, iterateJsonl, recoverJsonlTail } from "./storage/jsonl.js";
export type { TailRecoveryResult } from "./storage/jsonl.js";
export { DATA_SUBDIRS, TEMP_PREFIX, ensureDataDirLayout } from "./storage/paths.js";
export { initManifest, readManifest, SUPPORTED_FORMAT_VERSION } from "./storage/manifest-store.js";
export type { Manifest } from "./storage/manifest-store.js";
export { createWriteQueue } from "./storage/write-queue.js";
export type { WriteQueue } from "./storage/write-queue.js";
export {
  createTaskStore,
  readTaskAggregate,
  taskCurrentPath,
  taskDir,
  taskRevisionsPath,
} from "./storage/task-store.js";
export type {
  CommitInput,
  CreateAggregateInput,
  TaskStore,
  TaskStoreHooks,
  TaskStoreOptions,
} from "./storage/task-store.js";
export type {
  AssignmentRecord,
  RevisionLine,
  RevisionTip,
  SubtaskRecord,
  TaskAggregate,
  TaskRecord,
} from "./storage/task-types.js";
export { createEntityStore } from "./storage/entity-store.js";
export type { EntityStore } from "./storage/entity-store.js";
export { buildIndexes } from "./storage/indexes.js";
export type { DerivedIndexes } from "./storage/indexes.js";
export { initStore } from "./storage/store.js";
export type { FolderFile, MemberFile, StoreInitOptions, ZtaskStore } from "./storage/store.js";
export {
  EntryNotFoundError,
  StorageCorruptionError,
  StorageError,
  UnsupportedFormatError,
  VersionConflictError,
} from "./storage/errors.js";
