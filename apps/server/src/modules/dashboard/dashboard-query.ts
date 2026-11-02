import { ApiError } from "@ztask/shared";
import { DASHBOARD_BUCKET_KEYS, type DashboardBucketKey } from "./dashboard-service.js";

/** Fastify 解析后的 query（重复参数会变成数组）。 */
type Query = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * folderId 必填（05 §5.1–5.2）；缺失或空串 400。
 * 格式不合法/未知任务夹不在此拒绝——看板按空集处理，与任务列表一致（不 404）。
 * @param query 请求 query。
 * @returns 原始 folderId。
 */
export function parseFolderId(query: Query): string {
  const value = query.folderId;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "INVALID_REQUEST", "folderId 必填");
  }
  return value;
}

/**
 * bucket 必填且只能是 done|gt50|lt50（05 §5.2）；缺失或非法 400。
 * @param query 请求 query。
 * @returns 统计桶键。
 */
export function parseBucket(query: Query): DashboardBucketKey {
  const value = query.bucket;
  if (typeof value === "string" && DASHBOARD_BUCKET_KEYS.includes(value as DashboardBucketKey)) {
    return value as DashboardBucketKey;
  }
  throw new ApiError(400, "INVALID_REQUEST", "bucket 须为 done|gt50|lt50");
}

/**
 * memberIds 可选，支持逗号分隔与重复参数（05 §5.1）：`a,b`、`a&memberIds=b` 等价。
 * 去空白、去重并按首次出现顺序回显；成员 UUID 非法一律 400。
 * 归档/未知（但格式合法）成员不在这里拒绝——由服务层过滤为空集。
 * @param query 请求 query。
 * @returns 去重后的成员 ID 列表；未提供为空数组。
 */
export function parseMemberIds(query: Query): string[] {
  const raw = query.memberIds;
  if (raw === undefined) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") {
      throw new ApiError(400, "INVALID_REQUEST", "memberIds 非法");
    }
    for (const part of value.split(",")) {
      const memberId = part.trim();
      if (memberId === "") continue;
      if (!UUID_PATTERN.test(memberId)) {
        throw new ApiError(400, "INVALID_REQUEST", "memberIds 含非法成员 ID");
      }
      if (seen.has(memberId)) continue;
      seen.add(memberId);
      out.push(memberId);
    }
  }
  return out;
}

/**
 * 分享域不接受 memberIds（05 §6.12）：只要请求带了该参数就 400，
 * 避免成员借此探测其他成员的任务范围。
 * @param query 请求 query。
 */
export function assertNoMemberIds(query: Query): void {
  if (Object.prototype.hasOwnProperty.call(query, "memberIds")) {
    throw new ApiError(400, "INVALID_REQUEST", "成员看板不接受 memberIds");
  }
}
