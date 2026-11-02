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

// 看板统计（#21）：管理员与分享域共用同一服务。
export { createDashboardService, DASHBOARD_BUCKET_KEYS, DUE_BUCKET_KEYS } from "./modules/dashboard/dashboard-service.js";
export type {
  DashboardBucketKey,
  DashboardScopeInput,
  DashboardService,
  DashboardServiceDeps,
} from "./modules/dashboard/dashboard-service.js";

// 网络与分享链接（#20）：LAN 动态监听、network.json、链接生命周期。
export {
  collectShareInterfaces,
  createNetworkService,
} from "./modules/network/network-service.js";
export type {
  NetworkFile,
  NetworkListenerHandle,
  NetworkService,
  NetworkServiceOptions,
  RawNetworkInterface,
  StartNetworkListener,
} from "./modules/network/network-service.js";
export { createShareLinkService } from "./modules/share/share-links.js";
export type {
  ShareLinkService,
  ShareLinkServiceOptions,
  ShareNetworkState,
} from "./modules/share/share-links.js";
export { destroySession, destroySessionsForMember } from "./modules/share/share-auth.js";
export type { ShareLinkFile } from "./modules/share/share-auth.js";
export { createMemberService } from "./modules/members/member-service.js";
export type {
  MemberFile as MemberRecordFile,
  MemberService,
  MemberServiceDeps,
  ShareLinkSummarySource,
} from "./modules/members/member-service.js";
