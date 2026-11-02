import type {
  DashboardDueDistribution,
  DashboardSummary,
  DueBucket,
  DueBucketKey,
  ImportanceCount,
  ProgressBucket,
} from "@ztask/shared";
import { createFolderService } from "../folders/folder-service.js";
import { createMemberService } from "../members/member-service.js";
import { isRelated, listTaskAggregates } from "../share/share-scope.js";
import type { TaskAggregate } from "../../storage/task-types.js";
import { ApiError } from "@ztask/shared";

/** 统计桶键（05 §5.1–5.2）：done=100、gt50=51–99、lt50=0–50。 */
export type DashboardBucketKey = "done" | "gt50" | "lt50";

/**
 * 看板查询范围（05 §5.1–5.2/§6.12–6.13）：
 * - folderId 必填，统计该任务夹及全部后代；
 * - memberIds 仅管理员使用，只保留有效 owner 命中所选成员的任务；空 = 全部；
 * - shareMemberId 存在时先按 isRelated 限定到该成员相关任务，再与任务夹范围求交。
 */
export interface DashboardScopeInput {
  folderId: string;
  memberIds?: string[];
  shareMemberId?: string;
}

/** 看板服务：管理员与分享域共用同一口径（#21）。 */
export interface DashboardService {
  summary(input: DashboardScopeInput): Promise<DashboardSummary>;
  dueDistribution(input: DashboardScopeInput & { bucket: DashboardBucketKey }): Promise<DashboardDueDistribution>;
}

/** 看板服务装配项：数据目录、manifest 时区与可注入时钟。 */
export interface DashboardServiceDeps {
  dataDir: string;
  /** 团队时区（manifest.timeZone），用于求「今天」；非法时区由 Intl 抛出。 */
  timeZone: string;
  clock?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 固定分布顺序（05 §5.2）：空桶也必须出现在响应里。 */
export const DUE_BUCKET_KEYS: readonly DueBucketKey[] = ["overdue", "week", "month", "later", "unscheduled"];

const DUE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 统计桶固定顺序（05 §5.1），同时供 query 校验复用。 */
export const DASHBOARD_BUCKET_KEYS: readonly DashboardBucketKey[] = ["done", "gt50", "lt50"];

function emptyImportance(): ImportanceCount {
  return { high: 0, mid: 0, low: 0 };
}

function emptyProgressBucket(): ProgressBucket {
  return { total: 0, importance: emptyImportance() };
}

/**
 * 进度桶判定（05 §5.1 / 02 §7）：三桶互斥，done 只认 100。
 * @param progress 主任务进度 0–100。
 * @returns 桶键。
 */
function progressBucketOf(progress: number): DashboardBucketKey {
  if (progress === 100) return "done";
  if (progress >= 51) return "gt50";
  return "lt50";
}

/**
 * 把 `YYYY-MM-DD` 解析为 UTC 零点毫秒；非法日期（含 2 月 31 日这类溢出）返回 null。
 * @param date YYYY-MM-DD。
 * @returns UTC 毫秒或 null。
 */
function utcDayOf(date: string): number | null {
  const match = DUE_DATE_PATTERN.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const parsed = new Date(ms);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return ms;
}

/**
 * 以 manifest 时区取「今天」的 YYYY-MM-DD（05 §5.2 / 02 §7）。
 * 使用 Intl 的 en-CA 输出（ISO 顺序），再取各段拼装，避免依赖区域格式细节。
 * @param now 当前时刻。
 * @param timeZone IANA 时区。
 * @returns YYYY-MM-DD。
 */
function todayInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day"): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * 预计完成时间桶（05 §5.2）：逾期 diff<0、一周内 0–7、一月内 8–30、一月后 >30。
 * @param diff 到期日与今天（均为 UTC 零点）的天数差。
 * @returns 分布桶键。
 */
function dueBucketOf(diff: number): DueBucketKey {
  if (diff < 0) return "overdue";
  if (diff <= 7) return "week";
  if (diff <= 30) return "month";
  return "later";
}

/**
 * 创建看板服务（#21）：管理员看板与成员分享域看板共用同一实现，只有范围来源不同。
 *
 * 口径（05 §5.1–5.2、§6.12–6.13，02 §7）：
 * - 只统计未软删除的主任务，小任务不重复计数；
 * - 范围 = folderId 及全部后代任务夹；未知/空 folderId 得到空集，不 404；
 * - 管理员 memberIds 非空时只保留「未归档成员作为主任务 owner」命中所选集合的任务；
 * - 分享域先按 isRelated(aggregate, memberId) 限定，再与任务夹范围求交；
 * - dueDate=null 不进入预计完成分布（DTO 无未排期桶），且固定返回四桶。
 * @param deps 数据目录、manifest 时区与时钟。
 * @returns 看板服务。
 */
export function createDashboardService(deps: DashboardServiceDeps): DashboardService {
  const clock = deps.clock ?? (() => new Date());
  const { service: folderService } = createFolderService({ dataDir: deps.dataDir });
  const { store: memberStore } = createMemberService({ dataDir: deps.dataDir });

  /**
   * folderId 及其全部后代任务夹 ID；folderId 不存在时返回 null（未知任务夹 = 空集，
   * 与 05 §5.1「未知/空 folderId 不 404」一致）。
   */
  async function folderScope(folderId: string): Promise<Set<string> | null> {
    const folders = await folderService.list();
    if (!folders.some((folder) => folder.id === folderId)) return null;
    const childrenOf = new Map<string, string[]>();
    for (const folder of folders) {
      if (folder.parentId === null) continue;
      const children = childrenOf.get(folder.parentId) ?? [];
      children.push(folder.id);
      childrenOf.set(folder.parentId, children);
    }
    const scope = new Set<string>([folderId]);
    const frontier = [folderId];
    for (let index = 0; index < frontier.length; index += 1) {
      for (const child of childrenOf.get(frontier[index]!) ?? []) {
        if (scope.has(child)) continue;
        scope.add(child);
        frontier.push(child);
      }
    }
    return scope;
  }

  /** 在册（未归档）成员集合；归档成员即使仍是 owner 也不参与成员筛选。 */
  async function activeMemberIds(): Promise<Set<string>> {
    const members = await memberStore.list();
    return new Set(members.filter((entry) => entry.value.archivedAt === null).map((entry) => entry.id));
  }

  /**
   * 读取看板范围内的主任务聚合（三个口径叠加，顺序不影响结果）。
   * @param input 范围输入。
   * @returns 未软删除且命中的主任务聚合。
   */
  async function scopedAggregates(input: DashboardScopeInput): Promise<TaskAggregate[]> {
    const scope = await folderScope(input.folderId);
    if (scope === null) return [];
    let items = (await listTaskAggregates(deps.dataDir)).filter(
      (aggregate) => aggregate.task.deletedAt === null && scope.has(aggregate.task.folderId),
    );
    if (input.shareMemberId !== undefined) {
      const memberId = input.shareMemberId;
      items = items.filter((aggregate) => isRelated(aggregate, memberId).related);
    }
    const selected = input.memberIds ?? [];
    if (selected.length > 0) {
      const active = await activeMemberIds();
      const wanted = new Set(selected.filter((memberId) => active.has(memberId)));
      if (input.shareMemberId !== undefined) {
        // 05 §6.12：成员域筛选只能缩小范围。可见成员集合来自「该成员相关任务」的
        // 任意分配（owner/collaborator/小任务 owner），筛选之后再按 owner 口径统计；
        // 选到可见的协作者会得到空集（合法的缩小），选到不可见成员才 400。
        const visibleMembers = new Set(
          items.flatMap((aggregate) => aggregate.assignments.map((assignment) => assignment.memberId)),
        );
        for (const memberId of selected) {
          if (!visibleMembers.has(memberId)) {
            throw new ApiError(400, "INVALID_REQUEST", "成员筛选超出当前可见范围");
          }
        }
      }
      items = items.filter((aggregate) =>
        aggregate.assignments.some(
          (assignment) =>
            assignment.taskId === aggregate.taskId &&
            assignment.kind === "owner" &&
            wanted.has(assignment.memberId),
        ),
      );
    }
    return items;
  }

  return {
    async summary(input): Promise<DashboardSummary> {
      const now = clock();
      const items = await scopedAggregates(input);
      const buckets: Record<DashboardBucketKey, ProgressBucket> = {
        done: emptyProgressBucket(),
        gt50: emptyProgressBucket(),
        lt50: emptyProgressBucket(),
      };
      for (const aggregate of items) {
        const bucket = buckets[progressBucketOf(aggregate.task.progress)];
        bucket.total += 1;
        bucket.importance[aggregate.task.importance] += 1;
      }
      return {
        scope: { folderId: input.folderId, memberIds: [...new Set(input.memberIds ?? [])] },
        asOf: now.toISOString(),
        buckets: {
          done: buckets.done,
          gt50: buckets.gt50,
          lt50: buckets.lt50,
        },
      };
    },

    async dueDistribution(input): Promise<DashboardDueDistribution> {
      const now = clock();
      const items = await scopedAggregates(input);
      const today = todayInTimeZone(now, deps.timeZone);
      const todayDay = utcDayOf(today);
      const byKey = new Map<DueBucketKey, DueBucket>(
        DUE_BUCKET_KEYS.map((key) => [key, { key, total: 0, importance: emptyImportance() }]),
      );
      for (const aggregate of items) {
        if (progressBucketOf(aggregate.task.progress) !== input.bucket) continue;
        const dueDate = aggregate.task.dueDate;
        // 02 §7.6：dueDate=null 进入独立「未排期」桶，保证三卡总数与柱合计一致。
        if (dueDate === null) {
          const bucket = byKey.get("unscheduled")!;
          bucket.total += 1;
          bucket.importance[aggregate.task.importance] += 1;
          continue;
        }
        const dueDay = utcDayOf(dueDate);
        if (dueDay === null || todayDay === null) continue;
        const bucket = byKey.get(dueBucketOf(Math.round((dueDay - todayDay) / DAY_MS)))!;
        bucket.total += 1;
        bucket.importance[aggregate.task.importance] += 1;
      }
      return {
        bucket: input.bucket,
        asOf: now.toISOString(),
        // 固定四桶顺序（05 §5.2）：空桶 total=0，不因没有任务而省略。
        buckets: DUE_BUCKET_KEYS.map((key) => byKey.get(key)!),
      };
    },
  };
}
