import { randomUUID } from "node:crypto";
import { ApiError } from "@ztask/shared";
import type { Importance, Subtask, Task } from "@ztask/shared";
import { canonicalJson } from "../../storage/checksum.js";
import { createTaskStore, readTaskAggregate, type TaskStore } from "../../storage/task-store.js";
import type { TaskAggregate } from "../../storage/task-types.js";
import { createFolderService } from "../folders/folder-service.js";
import { createMemberService, type MemberFile } from "../members/member-service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMPORTANCES: Importance[] = ["high", "mid", "low"];

type Draft = Pick<TaskAggregate, "task" | "subtasks" | "assignments">;
type ChangeKind = "progress" | "detail" | "update" | "delete" | "subtask";

/** 任务服务装配项：数据目录与可注入时钟。 */
export interface TaskServiceDeps {
  dataDir: string;
  clock?: () => Date;
}

/** 任务服务：列表/创建/读取/更新/编辑器/软删除（05 §3.4–3.9、07 §5）。 */
export interface TaskService {
  list(input: { folderId: string; includeDescendants?: boolean; q?: string; importance?: string; cursor?: string }): Promise<{ items: Task[]; nextCursor: string | null }>;
  create(input: Record<string, unknown>): Promise<Task | { task: Subtask; parent: Task }>;
  get(id: string): Promise<Task | { task: Subtask; parent: Task }>;
  patch(id: string, input: Record<string, unknown>): Promise<Task | { task: Subtask; parent: Task }>;
  saveEditor(id: string, input: Record<string, unknown>): Promise<Task>;
  remove(id: string, version: number): Promise<void>;
}

function assertUuid(value: unknown, what: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ApiError(400, "INVALID_REQUEST", `${what} 非法（须为 UUID）`);
  }
  return value;
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

/** 应用 mutation 前后的变化检测：无有效变化不制造 revision（06 §7.1）。 */
function prepare(aggregate: TaskAggregate, apply: (draft: Draft) => void): { draft: Draft; changed: boolean } {
  const original: Draft = { task: aggregate.task, subtasks: aggregate.subtasks, assignments: aggregate.assignments };
  const draft: Draft = structuredClone(original);
  apply(draft);
  const changed = canonicalJson(draft) !== canonicalJson(original);
  return { draft, changed };
}

/**
 * 创建任务服务：写路径全部经任务队列与聚合提交协议（06 §8.2），
 * 读路径直读 current 文件保证新鲜；成员/任务夹校验内聚在服务层。
 * @param deps 数据目录与时钟。
 * @returns 服务与底层任务存储。
 */
export function createTaskService(deps: TaskServiceDeps): { service: TaskService; store: TaskStore } {
  const clock = deps.clock ?? (() => new Date());
  const taskStore = createTaskStore({ dataDir: deps.dataDir, clock });
  const { service: memberService, store: memberStore } = createMemberService({ dataDir: deps.dataDir, clock });
  const { service: folderService } = createFolderService({ dataDir: deps.dataDir, clock });

  async function memberMap(): Promise<Map<string, MemberFile>> {
    const map = new Map<string, MemberFile>();
    for (const entry of await memberStore.list()) map.set(entry.id, entry.value);
    return map;
  }

  function toTask(aggregate: TaskAggregate, members: Map<string, MemberFile>): Task {
    const summary = (id: string): { id: string; name: string; role: string; color: string } => {
      const file = members.get(id);
      return { id, name: file?.name ?? "待分配", role: file?.role ?? "", color: file?.color ?? "#9aa2ae" };
    };
    return {
      id: aggregate.taskId,
      folderId: aggregate.task.folderId,
      parentId: null,
      description: aggregate.task.description,
      owners: aggregate.assignments.filter((a) => a.taskId === aggregate.taskId && a.kind === "owner").map((a) => summary(a.memberId)),
      collaborators: aggregate.assignments.filter((a) => a.taskId === aggregate.taskId && a.kind === "collaborator").map((a) => summary(a.memberId)),
      progress: aggregate.task.progress,
      detail: aggregate.task.detailText,
      importance: aggregate.task.importance,
      dueDate: aggregate.task.dueDate,
      version: aggregate.taskVersion,
      createdAt: aggregate.task.createdAt,
      updatedAt: aggregate.updatedAt,
      subtasks: aggregate.subtasks
        .filter((sub) => sub.deletedAt === null)
        .map((sub) => ({
          id: sub.id,
          parentId: aggregate.taskId,
          description: sub.description,
          owner: summary(aggregate.assignments.find((a) => a.taskId === sub.id && a.kind === "owner")?.memberId ?? sub.id),
          progress: sub.progress,
          importance: sub.importance,
          dueDate: sub.dueDate,
          version: aggregate.taskVersion,
        })),
    };
  }

  async function activeMemberIds(): Promise<Set<string>> {
    const active = new Set<string>();
    for (const member of await memberService.list(await allAggregates())) {
      if (member.archivedAt === null) active.add(member.id);
    }
    return active;
  }

  function assertMembersActiveSync(ids: unknown, what: string, active: Set<string>): string[] {
    if (!Array.isArray(ids)) throw new ApiError(400, "INVALID_REQUEST", `${what} 须为字符串数组`);
    for (const id of ids) {
      if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new ApiError(400, "INVALID_REQUEST", `${what} 含非法成员 ID`);
      if (!active.has(id)) throw new ApiError(422, "INVALID_REQUEST", "成员不存在或已归档，不可分配");
    }
    return ids as string[];
  }

  async function allAggregates(): Promise<TaskAggregate[]> {
    const aggregates: TaskAggregate[] = [];
    for (const taskId of await taskStore.listTaskIds()) {
      const aggregate = await readTaskAggregate(deps.dataDir, taskId);
      if (aggregate) aggregates.push(aggregate);
    }
    return aggregates;
  }

  async function descendantsOf(folderId: string): Promise<string[]> {
    const folders = await folderService.list();
    const out = [folderId];
    let frontier = [folderId];
    while (frontier.length > 0) {
      const next = folders.filter((f) => f.parentId !== null && frontier.includes(f.parentId)).map((f) => f.id);
      out.push(...next);
      frontier = next;
    }
    return out;
  }

  /**
   * 解析任意任务 ID（主任务直读；小任务扫描各聚合的 subtasks）。
   * @returns 聚合与 isMain；找不到为 null。
   */
  async function resolveAggregate(id: string): Promise<{ aggregate: TaskAggregate; isMain: boolean } | null> {
    const direct = await readTaskAggregate(deps.dataDir, id);
    if (direct) return { aggregate: direct, isMain: true };
    for (const aggregate of await allAggregates()) {
      if (aggregate.subtasks.some((sub) => sub.id === id && sub.deletedAt === null)) {
        return { aggregate, isMain: false };
      }
    }
    return null;
  }

  function validateDraft(draft: Draft, mainTaskId: string): void {
    if (draft.task.description.trim() === "") throw new ApiError(400, "INVALID_REQUEST", "任务描述不能为空");
    const mainOwners = draft.assignments.filter((a) => a.taskId === mainTaskId && a.kind === "owner");
    if (mainOwners.length === 0 && draft.task.deletedAt === null) {
      throw new ApiError(422, "INVALID_REQUEST", "主任务至少需要一个有效 owner");
    }
    const seen = new Set<string>();
    for (const assignment of draft.assignments) {
      const key = `${assignment.taskId}:${assignment.memberId}`;
      if (seen.has(key)) throw new ApiError(422, "ASSIGNMENT_ROLE_CONFLICT", "同一 (任务, 成员) 只能出现一次分配");
      seen.add(key);
    }
    for (const sub of draft.subtasks) {
      if (sub.progress < 0 || sub.progress > 100) throw new ApiError(400, "INVALID_REQUEST", "小任务 progress 须为 0–100");
      const owners = draft.assignments.filter((a) => a.taskId === sub.id && a.kind === "owner");
      if (owners.length > 1) throw new ApiError(422, "ASSIGNMENT_ROLE_CONFLICT", "小任务至多一个 owner");
      if (draft.assignments.some((a) => a.taskId === sub.id && a.kind === "collaborator")) {
        throw new ApiError(422, "ASSIGNMENT_ROLE_CONFLICT", "小任务不开放协作人员");
      }
    }
  }

  /** 队列内提交：无有效变化直接返回现态；changeKind 由 apply 期间经 kindRef 解析。 */
  async function commitDraft(
    aggregate: TaskAggregate,
    input: { expectedVersion: number; changeKindRef: { current: ChangeKind }; apply: (draft: Draft) => void },
  ): Promise<Task> {
    const { draft, changed } = prepare(aggregate, input.apply);
    const members = await memberMap();
    if (!changed) return toTask(aggregate, members);
    const result = await taskStore.commit(aggregate.taskId, {
      expectedVersion: input.expectedVersion,
      changeKind: input.changeKindRef.current,
      actor: { kind: "admin", memberId: null, name: "管理员" },
      mutate: (mutable) => {
        mutable.task = draft.task;
        mutable.subtasks = draft.subtasks;
        mutable.assignments = draft.assignments;
      },
    });
    return toTask(result, await memberMap());
  }

  const service: TaskService = {
    async list(input) {
      const folderId = assertUuid(input.folderId, "folderId");
      const scope = input.includeDescendants === false ? [folderId] : await descendantsOf(folderId);
      const members = await memberMap();
      let items: Task[] = [];
      for (const aggregate of await allAggregates()) {
        if (aggregate.task.deletedAt !== null) continue;
        if (!scope.includes(aggregate.task.folderId)) continue;
        if (input.importance && aggregate.task.importance !== input.importance) continue;
        if (input.q && !aggregate.task.description.includes(input.q)) continue;
        items.push(toTask(aggregate, members));
      }
      items = items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
      if (input.cursor) {
        let decoded: string;
        try {
          decoded = Buffer.from(input.cursor, "base64url").toString("utf8");
        } catch {
          throw new ApiError(400, "INVALID_REQUEST", "cursor 非法");
        }
        const index = items.findIndex((task) => task.id === decoded);
        if (index >= 0) items = items.slice(index + 1);
      }
      const pageLimit = 50;
      let nextCursor: string | null = null;
      if (items.length > pageLimit) {
        items = items.slice(0, pageLimit);
        nextCursor = Buffer.from(items[items.length - 1]!.id).toString("base64url");
      }
      return { items, nextCursor };
    },

    async create(input) {
      const folderId = assertUuid(input.folderId, "folderId");
      if ((await folderService.list()).every((folder) => folder.id !== folderId)) {
        throw new ApiError(422, "INVALID_REQUEST", "任务夹不存在");
      }
      const description = assertDescription(input.description);
      const progress = input.progress === undefined ? 0 : assertProgress(input.progress);
      const importance = assertImportance(input.importance ?? "mid");
      const dueDate = assertDueDate(input.dueDate);
      const detail = typeof input.detail === "string" ? input.detail : "";

      if (input.parentId === null || input.parentId === undefined) {
        const activeMembers = await activeMemberIds();
        const ownerIds = assertMembersActiveSync(input.ownerIds, "ownerIds", activeMembers);
        if (ownerIds.length === 0) throw new ApiError(422, "INVALID_REQUEST", "主任务至少需要一个有效 owner");
        const collaboratorIds = assertMembersActiveSync(input.collaboratorIds ?? [], "collaboratorIds", activeMembers);
        const now = clock().toISOString();
        const taskId = randomUUID();
        const aggregate = await taskStore.createAggregate({
          taskId,
          task: {
            folderId,
            parentId: null,
            description,
            progress,
            detailText: detail,
            importance,
            dueDate,
            createdAt: now,
            deletedAt: null,
          },
          subtasks: [],
          assignments: [
            ...ownerIds.map((memberId: string) => ({ taskId, memberId, kind: "owner" as const })),
            ...collaboratorIds.map((memberId: string) => ({ taskId, memberId, kind: "collaborator" as const })),
          ],
          actor: { kind: "admin", memberId: null, name: "管理员" },
        });
        return toTask(aggregate, await memberMap());
      }

      const parentId = assertUuid(input.parentId, "parentId");
      const resolved = await resolveAggregate(parentId);
      if (!resolved || resolved.aggregate.task.deletedAt !== null) throw new ApiError(404, "NOT_FOUND", "父任务不存在");
      if (!resolved.isMain) throw new ApiError(422, "TASK_DEPTH_EXCEEDED", "小任务下不能再创建小任务");
      const parent = resolved.aggregate;
      const activeMembers = await activeMemberIds();
      const ownerIds = assertMembersActiveSync(input.ownerIds, "ownerIds", activeMembers);
      if (ownerIds.length !== 1) throw new ApiError(422, "INVALID_REQUEST", "小任务需要恰好一个 owner");

      const subId = randomUUID();
      const updated = await commitDraft(parent, {
        expectedVersion: parent.taskVersion,
        changeKindRef: { current: "subtask" },
        apply: (draft) => {
          draft.subtasks.push({
            id: subId,
            parentId,
            folderId: parent.task.folderId,
            description,
            progress,
            importance,
            dueDate,
            createdAt: clock().toISOString(),
            deletedAt: null,
          });
          draft.assignments.push({ taskId: subId, memberId: ownerIds[0]!, kind: "owner" });
          validateDraft(draft, parentId);
        },
      });
      const subtaskDto = updated.subtasks.find((s) => s.id === subId)!;
      return { task: subtaskDto, parent: updated };
    },

    async get(id) {
      assertUuid(id, "id");
      const resolved = await resolveAggregate(id);
      if (!resolved || resolved.aggregate.task.deletedAt !== null) throw new ApiError(404, "NOT_FOUND", "任务不存在");
      const members = await memberMap();
      if (resolved.isMain) return toTask(resolved.aggregate, members);
      const parent = toTask(resolved.aggregate, members);
      const subtaskDto = parent.subtasks.find((s) => s.id === id);
      if (!subtaskDto) throw new ApiError(404, "NOT_FOUND", "任务不存在");
      return { task: subtaskDto, parent };
    },

    async patch(id, input) {
      assertUuid(id, "id");
      const resolved = await resolveAggregate(id);
      if (!resolved || resolved.aggregate.task.deletedAt !== null) throw new ApiError(404, "NOT_FOUND", "任务不存在");
      const aggregate = resolved.aggregate;
      const version = input.version;
      if (typeof version !== "number") throw new ApiError(400, "INVALID_REQUEST", "version 必填");
      const isMain = aggregate.taskId === id;
      const allowed = isMain
        ? ["description", "ownerIds", "collaboratorIds", "progress", "detail", "importance", "dueDate"]
        : ["description", "ownerId", "progress", "importance", "dueDate"];
      for (const key of Object.keys(input)) {
        if (key !== "version" && !allowed.includes(key)) {
          throw new ApiError(400, "INVALID_REQUEST", isMain ? `字段不可更新：${key}` : `小任务不接受字段：${key}`);
        }
      }

      const activeMembers = await activeMemberIds();
      const changeKindRef = { current: "update" as ChangeKind };
      const updated = await commitDraft(aggregate, {
        expectedVersion: version,
        changeKindRef,
        apply: (draft) => {
          if (isMain) {
            if (input.description !== undefined) draft.task.description = assertDescription(input.description);
            if (input.progress !== undefined) {
              draft.task.progress = assertProgress(input.progress);
              changeKindRef.current = "progress";
            }
            if (input.detail !== undefined) {
              draft.task.detailText = String(input.detail);
              changeKindRef.current = "detail";
            }
            if (input.importance !== undefined) draft.task.importance = assertImportance(input.importance);
            if (input.dueDate !== undefined) draft.task.dueDate = assertDueDate(input.dueDate);
            if (input.ownerIds !== undefined || input.collaboratorIds !== undefined) {
              const currentOwners = draft.assignments.filter((a) => a.taskId === id && a.kind === "owner").map((a) => a.memberId);
              const currentCollabs = draft.assignments.filter((a) => a.taskId === id && a.kind === "collaborator").map((a) => a.memberId);
              const ownerIds = input.ownerIds !== undefined ? assertMembersActiveSync(input.ownerIds, "ownerIds", activeMembers) : currentOwners;
              const collaboratorIds = input.collaboratorIds !== undefined ? assertMembersActiveSync(input.collaboratorIds, "collaboratorIds", activeMembers) : currentCollabs;
              if (ownerIds.length === 0) throw new ApiError(422, "INVALID_REQUEST", "主任务至少需要一个有效 owner");
              draft.assignments = draft.assignments.filter((a) => a.taskId !== id);
              for (const memberId of ownerIds) draft.assignments.push({ taskId: id, memberId, kind: "owner" });
              for (const memberId of collaboratorIds) draft.assignments.push({ taskId: id, memberId, kind: "collaborator" });
            }
          } else {
            const sub = draft.subtasks.find((s) => s.id === id);
            if (!sub) throw new ApiError(404, "NOT_FOUND", "小任务不存在");
            if (input.description !== undefined) sub.description = assertDescription(input.description);
            if (input.progress !== undefined) {
              sub.progress = assertProgress(input.progress);
              changeKindRef.current = "progress";
            }
            if (input.importance !== undefined) sub.importance = assertImportance(input.importance);
            if (input.dueDate !== undefined) sub.dueDate = assertDueDate(input.dueDate);
            if (input.ownerId !== undefined) {
              const ownerId = assertMembersActiveSync([input.ownerId], "ownerId", activeMembers)[0]!;
              draft.assignments = draft.assignments.filter((a) => a.taskId !== id);
              draft.assignments.push({ taskId: id, memberId: ownerId, kind: "owner" });
            }
            validateDraft(draft, aggregate.taskId);
          }
        },
      });

      if (isMain) return updated;
      const subtaskDto = updated.subtasks.find((s) => s.id === id);
      if (!subtaskDto) throw new ApiError(404, "NOT_FOUND", "小任务不存在");
      return { task: subtaskDto, parent: updated };
    },

    async saveEditor(id, input) {
      assertUuid(id, "id");
      const resolved = await resolveAggregate(id);
      if (!resolved || !resolved.isMain || resolved.aggregate.task.deletedAt !== null) throw new ApiError(404, "NOT_FOUND", "任务不存在");
      const aggregate = resolved.aggregate;
      const version = input.version;
      if (typeof version !== "number") throw new ApiError(400, "INVALID_REQUEST", "version 必填");
      const editor = input.task as Record<string, unknown> | undefined;
      if (!editor) throw new ApiError(400, "INVALID_REQUEST", "task 编辑意图必填");
      const subtasks = (input.subtasks ?? {}) as {
        create?: Array<Record<string, unknown>>;
        update?: Array<Record<string, unknown>>;
        deleteIds?: string[];
      };

      const activeMembers = await activeMemberIds();
      const changeKindRef = { current: "update" as ChangeKind };
      const updated = await commitDraft(aggregate, {
        expectedVersion: version,
        changeKindRef,
        apply: (draft) => {
          draft.task.description = assertDescription(editor.description);
          draft.task.progress = assertProgress(editor.progress);
          draft.task.detailText = typeof editor.detail === "string" ? editor.detail : "";
          draft.task.importance = assertImportance(editor.importance);
          draft.task.dueDate = assertDueDate(editor.dueDate);
          const ownerIds = assertMembersActiveSync(editor.ownerIds, "ownerIds", activeMembers);
          if (ownerIds.length === 0) throw new ApiError(422, "INVALID_REQUEST", "主任务至少需要一个有效 owner");
          const collaboratorIds = assertMembersActiveSync(editor.collaboratorIds ?? [], "collaboratorIds", activeMembers);
          draft.assignments = draft.assignments.filter((a) => a.taskId !== id);
          for (const memberId of ownerIds) draft.assignments.push({ taskId: id, memberId, kind: "owner" });
          for (const memberId of collaboratorIds) draft.assignments.push({ taskId: id, memberId, kind: "collaborator" });

          const existingIds = new Set(draft.subtasks.map((s) => s.id));
          if ((subtasks.create?.length ?? 0) + (subtasks.update?.length ?? 0) + (subtasks.deleteIds?.length ?? 0) > 0) {
            changeKindRef.current = "subtask";
          }
          for (const deleteId of subtasks.deleteIds ?? []) {
            if (typeof deleteId !== "string" || !existingIds.has(deleteId)) {
              throw new ApiError(404, "NOT_FOUND", `小任务不存在：${String(deleteId)}`);
            }
            draft.subtasks = draft.subtasks.filter((s) => s.id !== deleteId);
            draft.assignments = draft.assignments.filter((a) => a.taskId !== deleteId);
          }
          for (const update of subtasks.update ?? []) {
            const subId = assertUuid(update.id, "小任务 ID");
            const sub = draft.subtasks.find((s) => s.id === subId);
            if (!sub) throw new ApiError(404, "NOT_FOUND", `小任务不存在：${subId}`);
            sub.description = assertDescription(update.description);
            sub.progress = assertProgress(update.progress);
            sub.importance = assertImportance(update.importance);
            sub.dueDate = assertDueDate(update.dueDate);
            const ownerId = assertMembersActiveSync([update.ownerId], "小任务 owner", activeMembers)[0]!;
            draft.assignments = draft.assignments.filter((a) => a.taskId !== subId);
            draft.assignments.push({ taskId: subId, memberId: ownerId, kind: "owner" });
          }
          for (const create of subtasks.create ?? []) {
            const subId = randomUUID();
            draft.subtasks.push({
              id: subId,
              parentId: id,
              folderId: draft.task.folderId,
              description: assertDescription(create.description),
              progress: assertProgress(create.progress ?? 0),
              importance: assertImportance(create.importance ?? "mid"),
              dueDate: assertDueDate(create.dueDate),
              createdAt: clock().toISOString(),
              deletedAt: null,
            });
            const ownerId = assertMembersActiveSync([create.ownerId], "小任务 owner", activeMembers)[0]!;
            draft.assignments.push({ taskId: subId, memberId: ownerId, kind: "owner" });
          }
          validateDraft(draft, id);
        },
      });
      return updated;
    },

    async remove(id, version) {
      assertUuid(id, "id");
      const resolved = await resolveAggregate(id);
      if (!resolved || resolved.aggregate.task.deletedAt !== null) throw new ApiError(404, "NOT_FOUND", "任务不存在");
      const aggregate = resolved.aggregate;
      await commitDraft(aggregate, {
        expectedVersion: version,
        changeKindRef: { current: "delete" },
        apply: (draft) => {
          const now = clock().toISOString();
          if (resolved.isMain) {
            draft.task.deletedAt = now;
            for (const sub of draft.subtasks) sub.deletedAt = now;
          } else {
            const sub = draft.subtasks.find((s) => s.id === id);
            if (!sub) throw new ApiError(404, "NOT_FOUND", "小任务不存在");
            sub.deletedAt = now;
            draft.assignments = draft.assignments.filter((a) => a.taskId !== id);
          }
        },
      });
    },
  };

  return { service, store: taskStore };
}
