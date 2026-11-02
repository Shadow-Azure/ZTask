import { ApiError } from "@ztask/shared";
import { DASHBOARD_BUCKET_KEYS, type DashboardBucketKey } from "./dashboard-service.js";

/** Fastify 解析后的 query（重复参数会变成数组）。 */
type Query = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 历史查询模式（05 §5.3）。 */
export type ChangesMode = "default" | "custom";

/** 通过校验的历史查询参数。 */
export interface ChangesParams {
  mode: ChangesMode;
  startDate?: string;
  endDate?: string;
}

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
  return value.trim();
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
 * 严格校验 `YYYY-MM-DD`：形状合法且日历上真实存在（拒绝 2026-02-31 / 2026-13-01）。
 * @param value 日期字符串。
 * @returns 是否为合法日期。
 */
function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  );
}

/** 读取单值 query；重复参数或空串一律 400。 */
function singleValue(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "INVALID_REQUEST", `${name} 非法`);
  }
  return value.trim();
}

/**
 * 解析 `GET .../dashboard/changes` 的区间参数（05 §5.3）：
 * - mode 缺省 default，只接受 default|custom；
 * - custom 必须同时传 startDate/endDate，且为真实存在的 YYYY-MM-DD；
 * - startDate 不得晚于 endDate（按日历日比较）；
 * - default 模式下忽略日期参数（区间由服务端按 manifest 时区计算）。
 * 任一不满足返回 400 INVALID_REQUEST。
 * @param query 请求 query。
 * @returns 校验后的 mode 与日期。
 */
export function parseChangesParams(query: Query): ChangesParams {
  const rawMode = query.mode;
  let mode: ChangesMode = "default";
  if (rawMode !== undefined) {
    if (rawMode !== "default" && rawMode !== "custom") {
      throw new ApiError(400, "INVALID_REQUEST", "mode 须为 default 或 custom");
    }
    mode = rawMode;
  }
  if (mode === "default") return { mode };

  const startDate = singleValue(query.startDate, "startDate");
  const endDate = singleValue(query.endDate, "endDate");
  if (startDate === undefined || endDate === undefined) {
    throw new ApiError(400, "INVALID_REQUEST", "custom 模式必须传 startDate 与 endDate");
  }
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
    throw new ApiError(400, "INVALID_REQUEST", "startDate/endDate 须为 YYYY-MM-DD");
  }
  if (startDate > endDate) {
    throw new ApiError(400, "INVALID_REQUEST", "startDate 不能晚于 endDate");
  }
  return { mode, startDate, endDate };
}
