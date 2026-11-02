import { randomUUID } from "node:crypto";
import { ApiError, type ChangeKind, type Importance, type ShareTaskMutation } from "@ztask/shared";
import { canonicalJson } from "../../storage/checksum.js";
import { VersionConflictError } from "../../storage/errors.js";
import { createTaskStore, readTaskAggregate, type TaskStore } from "../../storage/task-store.js";
import type { SubtaskRecord, TaskAggregate } from "../../storage/task-types.js";
import { createMemberService, type MemberFile } from "../members/member-service.js";
import { isRelated, toMemberTask } from "./share-scope.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMPORTANCES: readonly Importance[] = ["high", "mid", "low"];

/** 待提交的聚合三要素；与 task-service 的 Draft 同构（06 §7.1）。 */
type Draft = Pick<TaskAggregate, "task" | "subtasks" | "assignments">;

/** PATCH `/share/tasks/{id}/progress` 的输入（05 §6.6）。 */
export interface ShareProgressInput {
  progress: number;
  version: number;
}

/** PATCH `/share/tasks/{id}/detail` 的输入（05 §6.7）。 */
export interface ShareDetailInput {
  detail: string;
  version: number;
}

/** POST `/share/tasks/{id}/subtasks` 的输入（05 §6.8）；owner 恒为当前成员，不接受 owner 字段。 */
export interface ShareSubtaskCreateInput {
  version: number;
  description: string;
  progress?: number;
  importance?: Importance;
  dueDate?: string | null;
}

/** PATCH `/share/tasks/{id}/subtasks/{subtaskId}` 的输入（05 §6.9）；同样不含 owner。 */
export interface ShareSubtaskUpdateInput {
  version: number;
  description?: string;
  progress?: number;
  importance?: Importance;
  dueDate?: string | null;
}

/** 成员写入服务装配项：数据目录与可注入时钟（06 §8.2）。 */
export interface ShareTaskWriteServiceDeps {
  dataDir: string;
  clock?: () => Date;
  /**
   * 共享任务存储（含进程内串行队列）。必须由 `buildApp` 注入 `store.tasks`，
   * 与管理端写共用同一条队列；缺省时自建仅用于独立测试装配。
   */
  taskStore?: TaskStore;
}

/**
 * 成员个人页写服务（05 §6.6–6.10）：进度、完整详情与小任务的增删改。
 *
 * 所有写路径都经 `taskStore.commit`（append revision → 原子发布 current，06 §8.2），
 * actor 固定为成员快照 `{ kind: "member", memberId, name }`，`name` 取会话里的成员名，
 * 改名/归档后历史仍可读。响应统一用分享域 `toMemberTask` 口径，绝不泄露管理端字段。
 */
export interface ShareTaskWriteService {
  saveProgress(memberId: string, name: string, taskId: string, input: ShareProgressInput): Promise<ShareTaskMutation>;
  saveDetail(memberId: string, name: string, taskId: string, input: ShareDetailInput): Promise<ShareTaskMutation>;
  createSubtask(memberId: string, name: string, taskId: string, input: ShareSubtaskCreateInput): Promise<ShareTaskMutation>;
  updateSubtask(memberId: string, name: string, taskId: string, subtaskId: string, input: ShareSubtaskUpdateInput): Promise<ShareTaskMutation>;
  deleteSubtask(memberId: string, name: string, taskId: string, subtaskId: string, version: unknown): Promise<ShareTaskMutation>;
}

/** 提交变更的公共装配项：已通过 owner/version 校验的聚合与本次 mutation。 */
interface CommitMutationOptions {
  aggregate: TaskAggregate;
  memberId: string;
  name: string;
  expectedVersion: number;
  changeKind: ChangeKind;
  apply: (draft: Draft) => void;
}

function assertDescription(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "INVALID_REQUEST", "任务描述不能为空");
  }
  return value.trim();
}

function assertProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new ApiError(400, "INVALID_REQUEST", "progress 须为 0–100 整数");
  }
  return value;
}

function assertImportance(value: unknown): Importance {
  if (typeof value !== "string" || !IMPORTANCES.includes(value as Importance)) {
    throw new ApiError(400, "INVALID_REQUEST", "importance 非法");
  }
  return value as Importance;
}

function assertDueDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, "INVALID_REQUEST", "dueDate 须为 YYYY-MM-DD 或 null");
  }
  return value;
}

/**
 * 拒绝未声明字段（schema `additionalProperties:false` 之外的纵深防御）。
 * 小任务端点据此拒绝 `owner`/`ownerId`，保证 owner 恒为当前成员（05 §6.8）。
 * @param input 请求体。
 * @param allowed 允许的字段名。
 * @param what 错误信息里的对象名。
 */
function rejectUnknownKeys(input: object, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new ApiError(400, "INVALID_REQUEST", `${what}不接受字段：${key}`);
  }
}

/**
 * 应用 mutation 前后的变化检测：无有效变化不制造 revision（06 §7.1）。
 * 语义与 task-service.prepare 一致：比较完整聚合的 canonical JSON，
 * 因此「detail 文本相同」「progress 相同」「小任务更新无任何字段」都落空。
 * @param aggregate 当前聚合。
 * @param apply 在克隆 draft 上的 mutation。
 * @returns draft 与是否发生有效变化。
 */
function prepare(aggregate: TaskAggregate, apply: (draft: Draft) => void): { draft: Draft; changed: boolean } {
  const original: Draft = { task: aggregate.task, subtasks: aggregate.subtasks, assignments: aggregate.assignments };
  const draft: Draft = structuredClone(original);
  apply(draft);
  const changed = canonicalJson(draft) !== canonicalJson(original);
  return { draft, changed };
}

/**
 * 创建成员写入服务。读路径直读 main 聚合（小任务 id 直读不到 → 404），
 * 写路径全部经任务队列与聚合提交协议（06 §8.2）。
 * @param deps 数据目录与时钟。
 * @returns 服务与底层任务存储。
 */
export function createShareTaskWriteService(deps: ShareTaskWriteServiceDeps): {
  service: ShareTaskWriteService;
  store: TaskStore;
} {
  const clock = deps.clock ?? (() => new Date());
  const taskStore = deps.taskStore ?? createTaskStore({ dataDir: deps.dataDir, clock });
  const { store: memberStore } = createMemberService({ dataDir: deps.dataDir });

  /** 成员档案映射：`toMemberTask` 的 owner 摘要来源，与 GET 端点同一口径。 */
  async function memberMap(): Promise<Map<string, MemberFile>> {
    const map = new Map<string, MemberFile>();
    for (const entry of await memberStore.list()) map.set(entry.id, entry.value);
    return map;
  }

  /**
   * 定位可写的「主任务」聚合（05 §6.6–6.10）。
   *
   * 只直读 `tasks/<id>/current.json`：小任务没有独立聚合目录，小任务 id
   * 传给 progress/detail/subtasks 都自然落到 404 TASK_NOT_FOUND，
   * 因此不需要扫描全部聚合来区分「id 是小任务」。
   * @param memberId 会话成员 ID。
   * @param taskId 路径参数 {id}。
   * @returns 通过 owner 校验的聚合。
   */
  async function requireOwnedMain(memberId: string, taskId: string): Promise<TaskAggregate> {
    if (typeof taskId !== "string" || !UUID_PATTERN.test(taskId)) {
      throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    }
    let aggregate: TaskAggregate | null;
    try {
      aggregate = await readTaskAggregate(deps.dataDir, taskId);
    } catch {
      // 损坏聚合按不可见处理，不向成员泄露存储细节（05 §7 / §8）。
      throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    }
    const current = aggregate;
    if (current === null || current.task.deletedAt !== null) {
      throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    }
    // 05 §1/§8：成员不可见任务统一 404，不泄露资源存在性；可见但非 owner
    // （collaborator / 仅小任务被分配者）才是 403 OWNER_REQUIRED（05 §6.6）。
    const relation = isRelated(current, memberId);
    if (!relation.related) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    if (relation.role !== "owner") throw new ApiError(403, "OWNER_REQUIRED", "只有任务负责人可以修改");
    return current;
  }

  /**
   * 构造 409 冲突错误：`details.current` 必须是「此刻」的成员可见主任务 DTO。
   * 重读 current 而不是复用预检前的聚合，避免并发提交后把旧快照当现状（05 §7）。
   * @param memberId 会话成员 ID。
   * @param taskId 主任务 ID。
   * @param message 冲突说明。
   * @returns 可抛出的 ApiError（details.current）。
   */
  async function conflictError(memberId: string, taskId: string, message: string): Promise<ApiError> {
    const latest = await readTaskAggregate(deps.dataDir, taskId).catch(() => null);
    const current = latest === null ? null : toMemberTask(latest, memberId, await memberMap());
    return new ApiError(409, "TASK_VERSION_CONFLICT", message, { current });
  }

  /**
   * 版本预检：必须是整数且等于当前聚合版本，否则 409（05 §6.6–6.10）。
   * 队列内还有一次复查（taskStore.commit），因此这里只负责确定性错误与快速失败。
   * @param memberId 会话成员 ID。
   * @param aggregate 当前聚合。
   * @param value 请求携带的 version。
   * @returns 校验通过的版本。
   */
  async function assertVersion(memberId: string, aggregate: TaskAggregate, value: unknown): Promise<number> {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new ApiError(400, "INVALID_REQUEST", "version 必填（整数）");
    }
    if (value !== aggregate.taskVersion) {
      throw await conflictError(memberId, aggregate.taskId, `版本冲突：期望 ${value}，当前 ${aggregate.taskVersion}`);
    }
    return value;
  }

  /**
   * 定位属于该父任务且未删除的小任务；跨父任务、软删除、非法 UUID 一律 404（05 §6.8–6.10）。
   * @param aggregate 父任务聚合。
   * @param subtaskId 小任务 ID。
   * @returns 小任务记录。
   */
  function requireSubtask(aggregate: TaskAggregate, subtaskId: string): SubtaskRecord {
    if (typeof subtaskId !== "string" || !UUID_PATTERN.test(subtaskId)) {
      throw new ApiError(404, "TASK_NOT_FOUND", "小任务不存在");
    }
    const subtask = aggregate.subtasks.find(
      (entry) => entry.id === subtaskId && entry.parentId === aggregate.taskId && entry.deletedAt === null,
    );
    if (!subtask) throw new ApiError(404, "TASK_NOT_FOUND", "小任务不存在");
    return subtask;
  }

  /**
   * 提交一次成员写入（06 §8.2 / §7.1）。
   *
   * 先算出完整 draft 并比较前后 JSON：无有效变化直接返回现态且**不 commit**，
   * 因此不会追加 revision。有变化时 actor 固定为成员快照，changeKind 由调用方给定。
   * @param options 聚合、成员身份、期望版本、变更语义与 mutation。
   * @returns 成员可见 DTO 与本次 revision（无变化为 null）。
   */
  async function commitMutation(options: CommitMutationOptions): Promise<ShareTaskMutation> {
    const { aggregate, memberId, name, expectedVersion, changeKind, apply } = options;
    const { draft, changed } = prepare(aggregate, apply);
    if (!changed) {
      return { task: toMemberTask(aggregate, memberId, await memberMap()), revision: null };
    }

    let result: TaskAggregate;
    try {
      result = await taskStore.commit(aggregate.taskId, {
        expectedVersion,
        changeKind,
        actor: { kind: "member", memberId, name },
        mutate: (mutable) => {
          // 07 §2.3：在队列内、拿到最新 current 后再复查一次 owner，
          // 防止预检之后管理员把该成员移除 owner（跨写者并发最终由共享队列串行化）。
          const stillOwner = mutable.assignments.some(
            (assignment) => assignment.taskId === aggregate.taskId && assignment.memberId === memberId && assignment.kind === "owner",
          );
          if (!stillOwner) throw new ApiError(403, "OWNER_REQUIRED", "只有任务负责人可以修改");
          mutable.task = draft.task;
          mutable.subtasks = draft.subtasks;
          mutable.assignments = draft.assignments;
        },
      });
    } catch (cause) {
      // 队列内复查发现版本已变（并发写入）：与预检同一 409 口径，details.current 为最新 DTO。
      if (cause instanceof VersionConflictError) {
        throw await conflictError(memberId, aggregate.taskId, "任务已被更新，请刷新后重试");
      }
      throw cause;
    }

    return {
      task: toMemberTask(result, memberId, await memberMap()),
      revision: {
        taskVersion: result.revisionTip.taskVersion,
        recordedAt: result.revisionTip.recordedAt,
        changeKind: result.revisionTip.changeKind,
      },
    };
  }

  const service: ShareTaskWriteService = {
    async saveProgress(memberId, name, taskId, input) {
      const aggregate = await requireOwnedMain(memberId, taskId);
      // 先校验字段（400）再校验版本（409）：非法字段不应被当成并发冲突引导用户刷新。
      const progress = assertProgress(input.progress);
      const version = await assertVersion(memberId, aggregate, input.version);
      return await commitMutation({
        aggregate,
        memberId,
        name,
        expectedVersion: version,
        changeKind: "progress",
        apply: (draft) => {
          draft.task.progress = progress;
        },
      });
    },

    async saveDetail(memberId, name, taskId, input) {
      const aggregate = await requireOwnedMain(memberId, taskId);
      if (typeof input.detail !== "string") throw new ApiError(400, "INVALID_REQUEST", "detail 须为字符串");
      const version = await assertVersion(memberId, aggregate, input.version);
      // 05 §6.7：详情是全量替换（不是追加）；内容原样保存，允许空串。
      return await commitMutation({
        aggregate,
        memberId,
        name,
        expectedVersion: version,
        changeKind: "detail",
        apply: (draft) => {
          draft.task.detailText = input.detail;
        },
      });
    },

    async createSubtask(memberId, name, taskId, input) {
      const aggregate = await requireOwnedMain(memberId, taskId);
      rejectUnknownKeys(input, ["version", "description", "progress", "importance", "dueDate"], "小任务");
      const description = assertDescription(input.description);
      const progress = input.progress === undefined ? 0 : assertProgress(input.progress);
      const importance = input.importance === undefined ? "mid" : assertImportance(input.importance);
      const dueDate = assertDueDate(input.dueDate);
      const version = await assertVersion(memberId, aggregate, input.version);
      const subtaskId = randomUUID();
      const createdAt = clock().toISOString();

      return await commitMutation({
        aggregate,
        memberId,
        name,
        expectedVersion: version,
        changeKind: "subtask",
        apply: (draft) => {
          // 05 §6.8：小任务只能一层——父任务已被 requireOwnedMain 限定为主任务。
          draft.subtasks.push({
            id: subtaskId,
            parentId: aggregate.taskId,
            folderId: draft.task.folderId,
            description,
            progress,
            importance,
            dueDate,
            createdAt,
            deletedAt: null,
          });
          // owner 强制为当前成员：请求里的任何 owner 已在上面被拒绝。
          draft.assignments.push({ taskId: subtaskId, memberId, kind: "owner" });
        },
      });
    },

    async updateSubtask(memberId, name, taskId, subtaskId, input) {
      const aggregate = await requireOwnedMain(memberId, taskId);
      rejectUnknownKeys(input, ["version", "description", "progress", "importance", "dueDate"], "小任务");
      const subtask = requireSubtask(aggregate, subtaskId);
      // 先校验全部字段再进 draft：任一非法都 400 且不产生 revision。
      const description = input.description === undefined ? undefined : assertDescription(input.description);
      const progress = input.progress === undefined ? undefined : assertProgress(input.progress);
      const importance = input.importance === undefined ? undefined : assertImportance(input.importance);
      const dueDate = input.dueDate === undefined ? undefined : assertDueDate(input.dueDate);
      const version = await assertVersion(memberId, aggregate, input.version);

      return await commitMutation({
        aggregate,
        memberId,
        name,
        expectedVersion: version,
        changeKind: "subtask",
        apply: (draft) => {
          const target = draft.subtasks.find((entry) => entry.id === subtask.id);
          // 队列内 draft 与预检聚合同版本，理论上必存在；防御性兜底避免静默丢写。
          if (!target) throw new ApiError(404, "TASK_NOT_FOUND", "小任务不存在");
          if (description !== undefined) target.description = description;
          if (progress !== undefined) target.progress = progress;
          if (importance !== undefined) target.importance = importance;
          if (dueDate !== undefined) target.dueDate = dueDate;
          // 05 §6.9：更新不能改 owner（schema 与 rejectUnknownKeys 双重拒绝）。
        },
      });
    },

    async deleteSubtask(memberId, name, taskId, subtaskId, version) {
      const aggregate = await requireOwnedMain(memberId, taskId);
      const expectedVersion = await assertVersion(memberId, aggregate, version);
      const subtask = requireSubtask(aggregate, subtaskId);
      const deletedAt = clock().toISOString();

      return await commitMutation({
        aggregate,
        memberId,
        name,
        expectedVersion,
        changeKind: "subtask",
        apply: (draft) => {
          const target = draft.subtasks.find((entry) => entry.id === subtask.id);
          if (!target) throw new ApiError(404, "TASK_NOT_FOUND", "小任务不存在");
          // 05 §6.10：软删除（保留历史快照）并移除该小任务的分配，
          // 否则被删小任务的 owner 仍会被 isRelated 判为相关任务。
          target.deletedAt = deletedAt;
          draft.assignments = draft.assignments.filter((assignment) => assignment.taskId !== subtask.id);
        },
      });
    },
  };

  return { service, store: taskStore };
}
