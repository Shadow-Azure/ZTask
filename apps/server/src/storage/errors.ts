/**
 * 存储层错误体系。所有错误带稳定 code，供上层（未来的 API 错误映射）与日志使用；
 * 语义对照 06 §8.3：中间损坏拒绝自动修复、格式版本不比应用新等。
 */

export class StorageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

/** 文件内容损坏（checksum 不匹配、JSON 不完整且属中间行等），不允许静默丢弃。 */
export class StorageCorruptionError extends StorageError {
  constructor(message: string) {
    super("STORAGE_CORRUPTION", message);
    this.name = "StorageCorruptionError";
  }
}

/** 数据文件 formatVersion 比应用支持的更新，拒绝启动（06 §3）。 */
export class UnsupportedFormatError extends StorageError {
  constructor(message: string) {
    super("STORAGE_UNSUPPORTED_FORMAT", message);
    this.name = "UnsupportedFormatError";
  }
}

/** 期望存在的文件不存在。 */
export class EntryNotFoundError extends StorageError {
  constructor(message: string) {
    super("STORAGE_ENTRY_NOT_FOUND", message);
    this.name = "EntryNotFoundError";
  }
}

/** 乐观版本冲突：队列内复查 expectedVersion 不匹配（04 §5.1）。 */
export class VersionConflictError extends StorageError {
  readonly latestTaskVersion: number;

  constructor(latestTaskVersion: number, message: string) {
    super("TASK_VERSION_CONFLICT", message);
    this.name = "VersionConflictError";
    this.latestTaskVersion = latestTaskVersion;
  }
}
