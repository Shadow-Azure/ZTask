import {
  ApiError,
  type DashboardChanges,
  type MemberSummary,
  type TaskChange,
  type TaskChangeSnapshot,
} from "@ztask/shared";
import { createFolderService } from "../folders/folder-service.js";
import { createMemberService, type MemberFile } from "../members/member-service.js";
import { listTaskAggregates } from "../share/share-scope.js";
import { createTaskStore, type TaskStore } from "../../storage/task-store.js";
import type { RevisionLine, TaskAggregate } from "../../storage/task-types.js";

/** 时间段查询模式（05 §5.3）：default 由服务端按 manifest 时区算昨天至今，custom 用显式日期。 */
export type ChangesMode = "default" | "custom";

/**
 * 历史查询输入（05 §5.3/§6.14）：
 * - folderId 必填，范围含全部后代任务夹与软删除任务；
 * - memberIds 按 after 快照 owner 过滤；空 = 全部；
 */
export interface ChangesInput {
  folderId: string;
  memberIds?: string[];
  mode: ChangesMode;
  /** custom 必填，YYYY-MM-DD。 */
  startDate?: string;
  /** custom 必填，YYYY-MM-DD；解析为次日 00:00 以包含结束日全天。 */
  endDate?: string;
}

/** 时间段历史服务（05 §5.3/§6.14）：管理员与分享域共用同一实现，只差范围来源。 */
export interface HistoryService {
  changes(input: ChangesInput): Promise<DashboardChanges>;
}

/** 历史服务装配项：数据目录、manifest 时区与可注入时钟。 */
export interface HistoryServiceDeps {
  dataDir: string;
  /** 团队时区（manifest.timeZone），用于把本地日期边界反解为 UTC 瞬间。 */
  timeZone: string;
  clock?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** 时区偏移的最大范围（UTC−12…UTC+14），用于搜索区间与边界回退。 */
const MAX_OFFSET_MS = 26 * HOUR_MS;

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 无 owner 或成员文件缺失时的展示摘要；与 share-scope 的「待分配」同口径。 */
const UNASSIGNED_NAME = "待分配";
const UNASSIGNED_COLOR = "#9aa2ae";

/** 解析后的日历日期（不带时区）；monthIndex 为 0–11，与 Date.UTC 一致。 */
interface CalendarDate {
  year: number;
  monthIndex: number;
  day: number;
}

/** 解析后的 `[start,end)` UTC 毫秒边界。 */
interface ResolvedRange {
  start: number;
  end: number;
}

/** 单个候选任务的边界快照（before 可为 null）。 */
interface Candidate {
  aggregate: TaskAggregate;
  before: RevisionLine | null;
  after: RevisionLine;
}

/**
 * 严格解析 `YYYY-MM-DD`：形状合法且日历上真实存在（拒绝 2026-02-31）。
 * @param value 日期字符串。
 * @returns 日历日期；非法为 null。
 */
function parseCalendarDate(value: string): CalendarDate | null {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const parsed = new Date(ms);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return { year, monthIndex: month - 1, day };
}

/**
 * 日历日期加减天数；用 UTC 日历算术，不受任何时区/DST 影响。
 * @param date 起始日期。
 * @param days 偏移天数（可负）。
 * @returns 新日历日期。
 */
function shiftCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.monthIndex, date.day) + days * DAY_MS);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/** 日历日期按 UTC 解释时的毫秒值；仅用于比较同一天的先后。 */
function calendarDayMs(date: CalendarDate): number {
  return Date.UTC(date.year, date.monthIndex, date.day);
}

/**
 * 创建时间区间解析器与历史扫描器（05 §5.3、06 §7.3、07 §8.2）。
 *
 * 窗口语义固定为 `[start,end)`：`before` 取 `recordedAt < start` 的最后一条，
 * `after` 取 `recordedAt < end` 的最后一条；同一毫秒以 taskVersion 大者为准。
 * 服务端只返回完整快照，不做 diff。
 * @param deps 数据目录、manifest 时区与可选时钟。
 * @returns 历史服务。
 */
export function createHistoryService(deps: HistoryServiceDeps): HistoryService {
  const clock = deps.clock ?? (() => new Date());
  const { service: folderService } = createFolderService({ dataDir: deps.dataDir });
  const { store: memberStore } = createMemberService({ dataDir: deps.dataDir });
  const taskStore: TaskStore = createTaskStore({ dataDir: deps.dataDir });

  // 只创建一次 formatter：每次请求会做数次日历换算，重复构造 Intl 实例没有意义。
  // hourCycle=h23 避免部分区域把午夜格式化成 24 点；en-US 保证公历与拉丁数字。
  // manifest 里若被手工写成非法 IANA 值，Intl 会抛 RangeError；回退 UTC 而不是让服务起不来。
  const formatterOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  } as const;
  let effectiveTimeZone = deps.timeZone;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: deps.timeZone, ...formatterOptions });
  } catch {
    effectiveTimeZone = "UTC";
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...formatterOptions });
  }

  /** 读取某 UTC 瞬间在目标时区的年/月/日。 */
  function calendarDateInZone(instantMs: number): CalendarDate {
    const parts = formatter.formatToParts(new Date(instantMs));
    const value = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");
    return { year: value("year"), monthIndex: value("month") - 1, day: value("day") };
  }

  /** 某 UTC 瞬间在目标时区的「墙上时间」按 UTC 解释后的毫秒值（精确到秒）。 */
  function wallClockMs(instantMs: number): number {
    const parts = formatter.formatToParts(new Date(instantMs));
    const value = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");
    return Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    );
  }

  /** 某 UTC 瞬间的时区偏移（本地墙上时间 − UTC）；DST 期间随瞬间变化。 */
  function offsetMsAt(instantMs: number): number {
    return wallClockMs(instantMs) - instantMs;
  }

  /**
   * 把目标时区的本地 00:00 反解为 UTC 瞬间。
   *
   * 常规做法是用「偏移量迭代」：把目标墙上时间当作 UTC，减去该处的时区偏移，
   * 再用新瞬间的偏移修正，直到收敛。这里额外从 −26h/0/+26h 三个探针各推一次，
   * 收集所有「墙上时间恰好等于目标 00:00」的解：
   * - 秋季回拨导致本地 00:00 出现两次时取**最早**的一次（当天第一毫秒），
   *   保证窗口不会漏掉回拨前的那一小时；
   * - 春季跳表导致本地 00:00 不存在时（如 America/Santiago 2026-09-06），
   *   在 `[target−26h, target+26h]` 内二分查找「墙上时间首次 ≥ target」的瞬间，
   *   即该日第一个真实存在的 UTC 毫秒；结果确定，不依赖振荡方向。
   *
   * 无论是否存在 DST 边界，返回值都是确定的 UTC 瞬间，不会抛错。
   * @param date 目标时区的日历日期。
   * @returns 该日 00:00 对应的 UTC 毫秒。
   */
  function localMidnightUtc(date: CalendarDate): number {
    const target = calendarDayMs(date);
    const candidates = new Set<number>();
    for (const probe of [target - MAX_OFFSET_MS, target, target + MAX_OFFSET_MS]) {
      let instant = target - offsetMsAt(probe);
      if (wallClockMs(instant) === target) candidates.add(instant);
      // 再迭代一次，覆盖探针落在 DST 另一侧的常见情形。
      instant = target - offsetMsAt(instant);
      if (wallClockMs(instant) === target) candidates.add(instant);
    }
    if (candidates.size > 0) return Math.min(...candidates);

    let low = target - MAX_OFFSET_MS;
    let high = target + MAX_OFFSET_MS;
    // high 的墙上时间必然 ≥ target（偏移最多 +14h），low 必然 < target（最少 −12h）；
    // 仅当目标午夜被 DST 跳过时才会走到这里。
    while (high - low > 1) {
      const mid = low + Math.floor((high - low) / 2);
      if (wallClockMs(mid) >= target) high = mid;
      else low = mid;
    }
    return high;
  }

  /**
   * 解析查询区间（05 §5.3）：
   * - default：manifest 时区「昨天 00:00」→ now；
   * - custom：startDate 00:00 → endDate 次日 00:00（含结束日全天）。
   * @param input 查询输入。
   * @param nowMs 当前时刻（注入时钟）。
   * @returns UTC 毫秒边界。
   */
  function resolveRange(input: ChangesInput, nowMs: number): ResolvedRange {
    if (input.mode === "default") {
      const yesterday = shiftCalendarDays(calendarDateInZone(nowMs), -1);
      return { start: localMidnightUtc(yesterday), end: nowMs };
    }
    if (input.mode !== "custom") {
      throw new ApiError(400, "INVALID_REQUEST", "mode 须为 default 或 custom");
    }
    const startDate = input.startDate === undefined ? null : parseCalendarDate(input.startDate);
    const endDate = input.endDate === undefined ? null : parseCalendarDate(input.endDate);
    if (!startDate || !endDate) {
      throw new ApiError(400, "INVALID_REQUEST", "custom 模式必须传合法的 startDate 与 endDate");
    }
    if (calendarDayMs(startDate) > calendarDayMs(endDate)) {
      throw new ApiError(400, "INVALID_REQUEST", "startDate 不能晚于 endDate");
    }
    return {
      start: localMidnightUtc(startDate),
      end: localMidnightUtc(shiftCalendarDays(endDate, 1)),
    };
  }

  /**
   * folderId 及其全部后代任务夹；未知 folderId 返回 null（空集，不 404，与看板一致）。
   * @param folderId 根任务夹。
   * @returns 任务夹 ID 集合或 null。
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

  /** 在册（未归档）成员集合：成员筛选只会命中这些成员。 */
  async function activeMemberIds(): Promise<Set<string>> {
    const members = await memberStore.list();
    return new Set(members.filter((entry) => entry.value.archivedAt === null).map((entry) => entry.id));
  }

  /** 成员档案映射（归档成员文件仍在，历史 owner 名称因此可读）。 */
  async function memberMap(): Promise<Map<string, MemberFile>> {
    const map = new Map<string, MemberFile>();
    for (const entry of await memberStore.list()) map.set(entry.id, entry.value);
    return map;
  }

  /**
   * 同毫秒决胜：recordedAt 更大者胜；相同则 taskVersion 大者胜（06 §7.3）。
   * @param line 新读到的 revision。
   * @param current 当前候选。
   * @returns line 是否应取代 current。
   */
  function isNewerRevision(line: RevisionLine, current: RevisionLine | null): boolean {
    if (current === null) return true;
    const lineMs = Date.parse(line.recordedAt);
    const currentMs = Date.parse(current.recordedAt);
    if (lineMs !== currentMs) return lineMs > currentMs;
    return line.taskVersion > current.taskVersion;
  }

  /**
   * 流式扫描单个任务的 revisions，一次求出 before（<start）与 after（<end）的最后快照。
   * @param taskId 主任务 ID。
   * @param start 区间起点（毫秒，开区间）。
   * @param end 区间终点（毫秒，开区间）。
   * @returns 边界快照。
   */
  async function scanBoundaries(taskId: string, start: number, end: number): Promise<{ before: RevisionLine | null; after: RevisionLine | null }> {
    let before: RevisionLine | null = null;
    let after: RevisionLine | null = null;
    await taskStore.readRevisions(taskId, (line) => {
      const recordedAt = Date.parse(line.recordedAt);
      if (!Number.isFinite(recordedAt)) return;
      if (recordedAt < start && isNewerRevision(line, before)) before = line;
      if (recordedAt < end && isNewerRevision(line, after)) after = line;
    });
    return { before, after };
  }

  /** 快照中的主任务 owner 列表（历史 owner 口径，不看 current）。 */
  function ownerIdsOf(line: RevisionLine, taskId: string): string[] {
    return line.snapshot.assignments
      .filter((assignment) => assignment.taskId === taskId && assignment.kind === "owner")
      .map((assignment) => assignment.memberId);
  }

  /**
   * 变化分类（05 §5.3、06 §7.3，对齐原型 1546）：
   * - after 是删除 revision → deleted（created-then-deleted 也归 deleted，不为 created）；
   * - before 为 null → created（不伪造旧状态）；
   * - 其余只有 progress/detailText 变化才算 updated，分配/重要度变化忽略；
   * - progress 与 detailText 都未变 → 不进入结果。
   * @param before 起始快照。
   * @param after 结束快照。
   * @returns changeKind 或 null（无有效变化）。
   */
  function changeKindOf(before: RevisionLine | null, after: RevisionLine): TaskChange["changeKind"] | null {
    // 同一 revision：窗口开始前就已完成（含窗口前删除）的任务在后续窗口里 before===after，
    // 必须视为「本窗口无变化」，否则已删除任务会出现在之后每一个窗口。
    if (before !== null && before.taskVersion === after.taskVersion) return null;
    if (after.changeKind === "delete") return "deleted";
    if (before === null) return "created";
    if (
      before.snapshot.task.progress === after.snapshot.task.progress &&
      before.snapshot.task.detailText === after.snapshot.task.detailText
    ) {
      return null;
    }
    return "updated";
  }

  /** 把 revision 行映射为公开快照（完整 detailText，不做服务端 diff）。 */
  function toSnapshot(line: RevisionLine): TaskChangeSnapshot {
    return {
      progress: line.snapshot.task.progress,
      detail: line.snapshot.task.detailText,
      recordedAt: line.recordedAt,
    };
  }

  /** 成员摘要：归档成员保留档案中的显示名；成员文件缺失时才显示「待分配」。 */
  function memberSummary(members: Map<string, MemberFile>, memberId: string): MemberSummary {
    const file = members.get(memberId);
    if (!file) return { id: memberId, name: UNASSIGNED_NAME, role: "", color: UNASSIGNED_COLOR };
    return { id: file.id, name: file.name, role: file.role, color: file.color };
  }

  /**
   * 排序（05 §5.3）：非 currentlyDeleted 在前、已删除置底；
   * 组内 after.recordedAt 降序，再按 taskId 升序保证稳定。
   */
  function compareChanges(a: TaskChange, b: TaskChange): number {
    if (a.currentlyDeleted !== b.currentlyDeleted) return a.currentlyDeleted ? 1 : -1;
    const aMs = Date.parse(a.after.recordedAt);
    const bMs = Date.parse(b.after.recordedAt);
    if (aMs !== bMs) return bMs - aMs;
    if (a.taskId === b.taskId) return 0;
    return a.taskId < b.taskId ? -1 : 1;
  }

  return {
    async changes(input): Promise<DashboardChanges> {
      const range = resolveRange(input, clock().getTime());
      const result = (items: TaskChange[]): DashboardChanges => ({
        start: new Date(range.start).toISOString(),
        end: new Date(range.end).toISOString(),
        timeZone: effectiveTimeZone,
        items,
      });

      const scope = await folderScope(input.folderId);
      if (scope === null) return result([]);

      // 历史候选包含软删除任务（06 §9 historyTasksByFolder）：读 current.json 即可，不另建索引。
      const aggregates = (await listTaskAggregates(deps.dataDir)).filter((aggregate) =>
        scope.has(aggregate.task.folderId),
      );

      const candidates: Candidate[] = [];
      for (const aggregate of aggregates) {
        let boundaries: { before: RevisionLine | null; after: RevisionLine | null };
        try {
          boundaries = await scanBoundaries(aggregate.taskId, range.start, range.end);
        } catch {
          // 单个聚合的 revisions 损坏/缺失按无历史处理，避免整个看板 500（与 listTaskAggregates 同口径）。
          continue;
        }
        if (boundaries.after === null) continue;
        candidates.push({ aggregate, before: boundaries.before, after: boundaries.after });
      }

      const activeMembers = await activeMemberIds();
      let visible = candidates;
      const selected = [...new Set(input.memberIds ?? [])];
      if (selected.length > 0) {
        // 按 after/delete 快照的主任务 owner 过滤；归档/未知成员自然落空。
        const wanted = new Set(selected.filter((memberId) => activeMembers.has(memberId)));
        visible = visible.filter((candidate) =>
          ownerIdsOf(candidate.after, candidate.aggregate.taskId).some((memberId) => wanted.has(memberId)),
        );
      }

      const members = await memberMap();
      const items: TaskChange[] = [];
      for (const candidate of visible) {
        const changeKind = changeKindOf(candidate.before, candidate.after);
        if (changeKind === null) continue;
        const after = toSnapshot(candidate.after);
        items.push({
          taskId: candidate.aggregate.taskId,
          description: candidate.after.snapshot.task.description,
          importance: candidate.aggregate.task.importance,
          owners: ownerIdsOf(candidate.after, candidate.aggregate.taskId).map((memberId) =>
            memberSummary(members, memberId),
          ),
          before: candidate.before === null ? null : toSnapshot(candidate.before),
          after,
          changeKind,
          currentlyDeleted: candidate.aggregate.task.deletedAt !== null,
        });
      }
      items.sort(compareChanges);
      return result(items);
    },
  };
}
