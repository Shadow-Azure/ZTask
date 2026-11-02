// @vitest-environment node
import path from "node:path";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { iterateJsonl, readJsonFile, type RevisionLine } from "@ztask/server";
import {
  createFolder,
  createMember,
  createMemberAccessApp,
  createSubtask as adminCreateSubtask,
  createTask,
  deleteTask,
  exchangeCookie,
  seedShareLink,
  tmpDataDir,
} from "../member-access/support/share-fixtures.js";

/**
 * #19 成员个人页写端点（05 §6.6–6.10）：真实 initStore + buildApp + 真实分享链接种子，
 * 用 `POST /share/session` 交换会话；任务由真实管理端 API 创建，避免手写聚合与提交协议脱节。
 * 断言口径：响应 = 成员可见 DTO + revision；持久化以重读 GET 详情 / current.json / revisions.jsonl 为准。
 */

interface MemberSubtaskDto {
  id: string;
  parentId: string;
  description: string;
  owner: { id: string; name: string; role: string; color: string };
  progress: number;
  importance: string;
  dueDate: string | null;
  version: number;
}

interface MemberTaskDto {
  id: string;
  description: string;
  detail: string;
  progress: number;
  importance: string;
  dueDate: string | null;
  version: number;
  updatedAt: string;
  subtasks: MemberSubtaskDto[];
}

interface MutationBody {
  task: MemberTaskDto;
  revision: { taskVersion: number; recordedAt: string; changeKind: string } | null;
}

/** 存储层聚合/快照的最小断言形状（只取本 spec 关心的字段）。 */
interface AggregateShape {
  taskVersion: number;
  task: { detailText: string; progress: number; deletedAt: string | null };
  subtasks: Array<{ id: string; parentId: string; description: string; progress: number; importance: string; dueDate: string | null; deletedAt: string | null }>;
  assignments: Array<{ taskId: string; memberId: string; kind: string }>;
}

interface RevisionShape extends RevisionLine {
  snapshot: {
    task: { detailText: string; progress: number; deletedAt: string | null };
    subtasks: AggregateShape["subtasks"];
    assignments: AggregateShape["assignments"];
  };
}

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;

let dataDir: string;
let app: FastifyInstance;
let folder: string;
let memberA: string;
let memberB: string;
let memberC: string;
let mainTask: string;
let foreignTask: string;
let foreignSubtask: string;
let subOwnedByA: string;
let subOwnedByC: string;
let deletedTask: string;
let cookieA: string;
let cookieB: string;
let cookieC: string;

async function shareWrite(
  method: "PATCH" | "POST" | "DELETE",
  url: string,
  cookie: string | null,
  payload?: Record<string, unknown>,
): Promise<InjectResponse> {
  return await app.inject({
    method,
    url,
    ...(cookie === null ? {} : { headers: { cookie } }),
    ...(payload === undefined ? {} : { payload }),
  });
}

async function shareGet(url: string, cookie: string): Promise<InjectResponse> {
  return await app.inject({ method: "GET", url, headers: { cookie } });
}

/** 重读成员可见详情（owner 口径），用于断言「真的落盘」而不只看响应。 */
async function currentTask(taskId: string, cookie: string = cookieA): Promise<MemberTaskDto> {
  const response = await shareGet(`/api/v1/share/tasks/${taskId}`, cookie);
  expect(response.statusCode, `GET /share/tasks/${taskId}`).toBe(200);
  return response.json() as MemberTaskDto;
}

async function currentAggregate(taskId: string): Promise<AggregateShape> {
  return (await readJsonFile(path.join(dataDir, "tasks", taskId, "current.json"))) as unknown as AggregateShape;
}

async function revisionLines(taskId: string): Promise<RevisionShape[]> {
  const lines: RevisionShape[] = [];
  await iterateJsonl(path.join(dataDir, "tasks", taskId, "revisions.jsonl"), (record) => {
    lines.push(record as unknown as RevisionShape);
  });
  return lines;
}

beforeEach(async () => {
  dataDir = tmpDataDir();
  app = await createMemberAccessApp(dataDir);
  folder = await createFolder(app, "迭代");

  memberA = await createMember(app, "陈晨");
  memberB = await createMember(app, "林悦");
  memberC = await createMember(app, "周舟");

  // 主任务：A owner、B collaborator、C 只是小任务被分配者（subtask-only）。
  mainTask = (await createTask(app, {
    folderId: folder,
    description: "主任务",
    ownerIds: [memberA],
    collaboratorIds: [memberB],
  })).id;
  subOwnedByA = (await adminCreateSubtask(app, {
    folderId: folder,
    parentId: mainTask,
    description: "A 的小任务",
    ownerId: memberA,
  })).id;
  subOwnedByC = (await adminCreateSubtask(app, {
    folderId: folder,
    parentId: mainTask,
    description: "C 的小任务",
    ownerId: memberC,
  })).id;

  // 另一个父任务：用于「跨父任务 subtaskId」与「无关成员」拒绝矩阵。
  foreignTask = (await createTask(app, {
    folderId: folder,
    description: "C 的主任务",
    ownerIds: [memberC],
  })).id;
  foreignSubtask = (await adminCreateSubtask(app, {
    folderId: folder,
    parentId: foreignTask,
    description: "C 主任务的小任务",
    ownerId: memberC,
  })).id;

  const deleted = await createTask(app, { folderId: folder, description: "已删除主任务", ownerIds: [memberA] });
  await deleteTask(app, deleted.id, deleted.version);
  deletedTask = deleted.id;

  cookieA = await exchangeCookie(app, (await seedShareLink({ dataDir, memberId: memberA })).token);
  cookieB = await exchangeCookie(app, (await seedShareLink({ dataDir, memberId: memberB })).token);
  cookieC = await exchangeCookie(app, (await seedShareLink({ dataDir, memberId: memberC })).token);
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("owner 写入：持久化 + revision changeKind（05 §6.6–6.10）", () => {
  it("progress：响应为成员 DTO，changeKind=progress，版本递增且 actor 是成员快照", async () => {
    const before = await currentTask(mainTask);
    const beforeLines = (await revisionLines(mainTask)).length;

    const response = await shareWrite("PATCH", `/api/v1/share/tasks/${mainTask}/progress`, cookieA, {
      progress: 40,
      version: before.version,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as MutationBody;

    expect(body.revision).not.toBeNull();
    expect(body.revision!.changeKind).toBe("progress");
    expect(body.revision!.taskVersion).toBe(before.version + 1);
    expect(body.task.id).toBe(mainTask);
    expect(body.task.version).toBe(before.version + 1);
    expect(body.task.progress).toBe(40);
    expect(body.task.updatedAt).toBe(body.revision!.recordedAt);
    // 分享域口径：owner 仍能看到 detail，但存储层的 detailText 等管理端字段不出现。
    expect(body.task.detail).toBe("主任务详情");
    expect(JSON.stringify(body)).not.toContain("detailText");

    // 持久化：重读 GET 详情。
    const after = await currentTask(mainTask);
    expect(after.version).toBe(before.version + 1);
    expect(after.progress).toBe(40);

    const lines = await revisionLines(mainTask);
    expect(lines).toHaveLength(beforeLines + 1);
    const last = lines.at(-1)!;
    expect(last.changeKind).toBe("progress");
    expect(last.taskVersion).toBe(before.version + 1);
    expect(last.actor).toEqual({ kind: "member", memberId: memberA, name: "陈晨" });
    expect(last.snapshot.task.progress).toBe(40);
  });

  it("detail：全量替换并追加含完整快照的 detail revision", async () => {
    const before = await currentTask(mainTask);

    const response = await shareWrite("PATCH", `/api/v1/share/tasks/${mainTask}/detail`, cookieA, {
      detail: "第二版详情",
      version: before.version,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as MutationBody;
    expect(body.revision!.changeKind).toBe("detail");
    expect(body.task.detail).toBe("第二版详情");
    expect(body.task.version).toBe(before.version + 1);

    expect((await currentTask(mainTask)).detail).toBe("第二版详情");

    const lines = await revisionLines(mainTask);
    expect(lines.at(-1)!.changeKind).toBe("detail");
    expect(lines.at(-1)!.snapshot.task.detailText).toBe("第二版详情");
    // 追加而非覆盖：create revision 的快照仍是旧详情。
    expect(lines.find((line) => line.taskVersion === 1)!.snapshot.task.detailText).toBe("主任务详情");
  });

  it("createSubtask：owner 强制当前成员，返回更新后的父聚合 DTO（201）", async () => {
    const before = await currentTask(mainTask);

    const response = await shareWrite("POST", `/api/v1/share/tasks/${mainTask}/subtasks`, cookieA, {
      version: before.version,
      description: "成员新建小任务",
      progress: 30,
      importance: "high",
      dueDate: "2026-03-31",
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as MutationBody;
    expect(body.revision!.changeKind).toBe("subtask");
    // 小任务写后返回父聚合 DTO（不是小任务本身），便于前端整卡替换。
    expect(body.task.id).toBe(mainTask);
    expect(body.task.version).toBe(before.version + 1);

    const created = body.task.subtasks.find((entry) => entry.description === "成员新建小任务")!;
    expect(created).toBeTruthy();
    expect(created.parentId).toBe(mainTask);
    expect(created.owner).toMatchObject({ id: memberA, name: "陈晨" });
    expect(created.progress).toBe(30);
    expect(created.importance).toBe("high");
    expect(created.dueDate).toBe("2026-03-31");

    // 持久化：GET 详情与 current.json 双重确认（小任务 + owner assignment）。
    expect((await currentTask(mainTask)).subtasks.some((entry) => entry.id === created.id)).toBe(true);
    const aggregate = await currentAggregate(mainTask);
    expect(aggregate.subtasks.find((entry) => entry.id === created.id)).toMatchObject({
      parentId: mainTask,
      description: "成员新建小任务",
      deletedAt: null,
    });
    expect(aggregate.assignments).toContainEqual({ taskId: created.id, memberId: memberA, kind: "owner" });

    const last = (await revisionLines(mainTask)).at(-1)!;
    expect(last.changeKind).toBe("subtask");
    expect(last.snapshot.subtasks.some((entry) => entry.id === created.id)).toBe(true);
  });

  it("updateSubtask：改字段不改 owner，返回父聚合 DTO", async () => {
    const before = await currentTask(mainTask);

    const response = await shareWrite(
      "PATCH",
      `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByA}`,
      cookieA,
      {
        version: before.version,
        description: "改后的小任务",
        progress: 70,
        importance: "low",
        dueDate: "2026-04-01",
      },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as MutationBody;
    expect(body.revision!.changeKind).toBe("subtask");
    expect(body.task.id).toBe(mainTask);
    expect(body.task.version).toBe(before.version + 1);

    const updated = body.task.subtasks.find((entry) => entry.id === subOwnedByA)!;
    expect(updated).toMatchObject({
      description: "改后的小任务",
      progress: 70,
      importance: "low",
      dueDate: "2026-04-01",
    });
    expect(updated.owner.id).toBe(memberA);

    expect((await currentTask(mainTask)).subtasks.find((entry) => entry.id === subOwnedByA)).toMatchObject({
      description: "改后的小任务",
      progress: 70,
    });
    const aggregate = await currentAggregate(mainTask);
    expect(aggregate.assignments).toContainEqual({ taskId: subOwnedByA, memberId: memberA, kind: "owner" });
    expect(aggregate.assignments.some((assignment) => assignment.taskId === subOwnedByA && assignment.memberId !== memberA)).toBe(false);
  });

  it("deleteSubtask：软删除保留记录并移除该小任务 assignments", async () => {
    const before = await currentTask(mainTask);

    const response = await shareWrite(
      "DELETE",
      `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByC}?version=${before.version}`,
      cookieA,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as MutationBody;
    expect(body.revision!.changeKind).toBe("subtask");
    expect(body.task.version).toBe(before.version + 1);
    expect(body.task.subtasks.some((entry) => entry.id === subOwnedByC)).toBe(false);

    expect((await currentTask(mainTask)).subtasks.some((entry) => entry.id === subOwnedByC)).toBe(false);

    // 软删除：subtask 记录仍在（deletedAt 非空），但 assignment 已移除。
    const aggregate = await currentAggregate(mainTask);
    expect(aggregate.subtasks.find((entry) => entry.id === subOwnedByC)!.deletedAt).not.toBeNull();
    expect(aggregate.assignments.some((assignment) => assignment.taskId === subOwnedByC)).toBe(false);

    const last = (await revisionLines(mainTask)).at(-1)!;
    expect(last.snapshot.subtasks.find((entry) => entry.id === subOwnedByC)!.deletedAt).not.toBeNull();
    expect(last.snapshot.assignments.some((assignment) => assignment.taskId === subOwnedByC)).toBe(false);
  });
});

describe("权限矩阵（05 §6.6–6.10 / §8）", () => {
  it("collaborator / subtask-only / 无关成员 / 匿名 / 小任务 id / 不存在任务全部拒绝且不追加 revision", async () => {
    const before = await currentTask(mainTask);
    const beforeLines = (await revisionLines(mainTask)).length;
    const beforeForeignLines = (await revisionLines(foreignTask)).length;

    const attempts: Array<{
      label: string;
      method: "PATCH" | "POST" | "DELETE";
      url: string;
      cookie: string | null;
      payload?: Record<string, unknown>;
      status: number;
      code: string;
    }> = [
      {
        label: "协作者写进度",
        method: "PATCH",
        url: `/api/v1/share/tasks/${mainTask}/progress`,
        cookie: cookieB,
        payload: { progress: 10, version: before.version },
        status: 403,
        code: "OWNER_REQUIRED",
      },
      {
        label: "协作者写详情",
        method: "PATCH",
        url: `/api/v1/share/tasks/${mainTask}/detail`,
        cookie: cookieB,
        payload: { detail: "越权", version: before.version },
        status: 403,
        code: "OWNER_REQUIRED",
      },
      {
        label: "协作者建小任务",
        method: "POST",
        url: `/api/v1/share/tasks/${mainTask}/subtasks`,
        cookie: cookieB,
        payload: { version: before.version, description: "越权小任务" },
        status: 403,
        code: "OWNER_REQUIRED",
      },
      {
        label: "协作者删小任务",
        method: "DELETE",
        url: `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByA}?version=${before.version}`,
        cookie: cookieB,
        status: 403,
        code: "OWNER_REQUIRED",
      },
      {
        label: "subtask-only 成员写详情",
        method: "PATCH",
        url: `/api/v1/share/tasks/${mainTask}/detail`,
        cookie: cookieC,
        payload: { detail: "越权", version: before.version },
        status: 403,
        code: "OWNER_REQUIRED",
      },
      {
        label: "无关成员写不可见任务",
        method: "PATCH",
        url: `/api/v1/share/tasks/${foreignTask}/progress`,
        cookie: cookieA,
        payload: { progress: 10, version: 1 },
        status: 404,
        code: "TASK_NOT_FOUND",
      },
      {
        label: "匿名写进度",
        method: "PATCH",
        url: `/api/v1/share/tasks/${mainTask}/progress`,
        cookie: null,
        payload: { progress: 10, version: before.version },
        status: 401,
        code: "SHARE_SESSION_REQUIRED",
      },
      {
        label: "小任务 id 写进度",
        method: "PATCH",
        url: `/api/v1/share/tasks/${subOwnedByA}/progress`,
        cookie: cookieA,
        payload: { progress: 10, version: before.version },
        status: 404,
        code: "TASK_NOT_FOUND",
      },
      {
        label: "小任务 id 写详情",
        method: "PATCH",
        url: `/api/v1/share/tasks/${subOwnedByA}/detail`,
        cookie: cookieA,
        payload: { detail: "x", version: before.version },
        status: 404,
        code: "TASK_NOT_FOUND",
      },
      {
        label: "不存在任务",
        method: "PATCH",
        url: `/api/v1/share/tasks/${randomUUID()}/detail`,
        cookie: cookieA,
        payload: { detail: "x", version: 1 },
        status: 404,
        code: "TASK_NOT_FOUND",
      },
      {
        label: "软删除任务",
        method: "PATCH",
        url: `/api/v1/share/tasks/${deletedTask}/detail`,
        cookie: cookieA,
        payload: { detail: "x", version: 1 },
        status: 404,
        code: "TASK_NOT_FOUND",
      },
      {
        label: "非法任务 id",
        method: "PATCH",
        url: "/api/v1/share/tasks/not-a-uuid/progress",
        cookie: cookieA,
        payload: { progress: 10, version: 1 },
        status: 404,
        code: "TASK_NOT_FOUND",
      },
    ];

    for (const attempt of attempts) {
      const response = await shareWrite(attempt.method, attempt.url, attempt.cookie, attempt.payload);
      expect(response.statusCode, attempt.label).toBe(attempt.status);
      expect(response.json().error.code, attempt.label).toBe(attempt.code);
    }

    // 被拒绝的请求绝不产生历史，也不改持久化状态。
    expect((await revisionLines(mainTask)).length).toBe(beforeLines);
    expect((await revisionLines(foreignTask)).length).toBe(beforeForeignLines);
    expect((await currentTask(mainTask)).version).toBe(before.version);
  });
});

describe("version 校验（05 §6.6–6.10 / §7）", () => {
  it("缺失 version → 400；过期 → 409 且 details.current 是最新成员可见主任务 DTO", async () => {
    const before = await currentTask(mainTask);
    const beforeLines = (await revisionLines(mainTask)).length;

    const missing = await shareWrite("PATCH", `/api/v1/share/tasks/${mainTask}/progress`, cookieA, { progress: 50 });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("INVALID_REQUEST");

    const notInteger = await shareWrite("PATCH", `/api/v1/share/tasks/${mainTask}/progress`, cookieA, {
      progress: 50,
      version: 1.5,
    });
    expect(notInteger.statusCode).toBe(400);
    expect(notInteger.json().error.code).toBe("INVALID_REQUEST");

    const stale = await shareWrite("PATCH", `/api/v1/share/tasks/${mainTask}/progress`, cookieA, {
      progress: 50,
      version: before.version + 1,
    });
    expect(stale.statusCode).toBe(409);
    const staleError = stale.json().error;
    expect(staleError.code).toBe("TASK_VERSION_CONFLICT");
    expect(staleError.details.current.id).toBe(mainTask);
    expect(staleError.details.current.version).toBe(before.version);
    expect(staleError.details.current.detail).toBe("主任务详情");

    expect((await revisionLines(mainTask)).length).toBe(beforeLines);
    expect((await currentTask(mainTask)).version).toBe(before.version);

    // 成功一次后用旧 version 重试：409 的 details.current 必须是新状态。
    const ok = await shareWrite("PATCH", `/api/v1/share/tasks/${mainTask}/progress`, cookieA, {
      progress: 55,
      version: before.version,
    });
    expect(ok.statusCode).toBe(200);

    const retry = await shareWrite("PATCH", `/api/v1/share/tasks/${mainTask}/progress`, cookieA, {
      progress: 56,
      version: before.version,
    });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.details.current.version).toBe(before.version + 1);
    expect(retry.json().error.details.current.progress).toBe(55);
  });

  it("DELETE 缺 version → 400；过期 → 409 且 details.current 完整", async () => {
    const before = await currentTask(mainTask);

    const missing = await shareWrite("DELETE", `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByA}`, cookieA);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("INVALID_REQUEST");

    const stale = await shareWrite(
      "DELETE",
      `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByA}?version=${before.version + 1}`,
      cookieA,
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("TASK_VERSION_CONFLICT");
    expect(stale.json().error.details.current.id).toBe(mainTask);
    expect(stale.json().error.details.current.version).toBe(before.version);

    // 冲突后小任务仍在、版本未变。
    expect((await currentTask(mainTask)).subtasks.some((entry) => entry.id === subOwnedByA)).toBe(true);
  });
});

describe("小任务规则（05 §6.8–6.10）", () => {
  it("创建不接受 owner/ownerId 字段（400），不产生 revision", async () => {
    const before = await currentTask(mainTask);
    const beforeLines = (await revisionLines(mainTask)).length;

    for (const payload of [
      { version: before.version, description: "带 owner", owner: memberC },
      { version: before.version, description: "带 ownerId", ownerId: memberC },
    ]) {
      const response = await shareWrite("POST", `/api/v1/share/tasks/${mainTask}/subtasks`, cookieA, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().error.code).toBe("INVALID_REQUEST");
    }

    expect((await revisionLines(mainTask)).length).toBe(beforeLines);
  });

  it("更新不接受 owner/ownerId 字段（400），非法字段值同样 400 且不写盘", async () => {
    const before = await currentTask(mainTask);
    const beforeLines = (await revisionLines(mainTask)).length;

    const ownerUpdate = await shareWrite(
      "PATCH",
      `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByA}`,
      cookieA,
      { version: before.version, ownerId: memberC },
    );
    expect(ownerUpdate.statusCode).toBe(400);
    expect(ownerUpdate.json().error.code).toBe("INVALID_REQUEST");

    const blankDescription = await shareWrite(
      "POST",
      `/api/v1/share/tasks/${mainTask}/subtasks`,
      cookieA,
      { version: before.version, description: "   " },
    );
    expect(blankDescription.statusCode).toBe(400);
    expect(blankDescription.json().error.code).toBe("INVALID_REQUEST");

    const badProgress = await shareWrite(
      "PATCH",
      `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByA}`,
      cookieA,
      { version: before.version, progress: 101 },
    );
    expect(badProgress.statusCode).toBe(400);

    expect((await revisionLines(mainTask)).length).toBe(beforeLines);
    expect((await currentTask(mainTask)).version).toBe(before.version);
    expect((await currentTask(mainTask)).subtasks.find((entry) => entry.id === subOwnedByA)!.owner.id).toBe(memberA);
  });

  it("小任务只能一层：以小任务 id 作父任务、跨父任务 subtaskId 一律 404", async () => {
    const before = await currentTask(mainTask);

    const nested = await shareWrite("POST", `/api/v1/share/tasks/${subOwnedByA}/subtasks`, cookieA, {
      version: before.version,
      description: "二层小任务",
    });
    expect(nested.statusCode).toBe(404);
    expect(nested.json().error.code).toBe("TASK_NOT_FOUND");

    const crossParentUpdate = await shareWrite(
      "PATCH",
      `/api/v1/share/tasks/${mainTask}/subtasks/${foreignSubtask}`,
      cookieA,
      { version: before.version, description: "跨父任务" },
    );
    expect(crossParentUpdate.statusCode).toBe(404);
    expect(crossParentUpdate.json().error.code).toBe("TASK_NOT_FOUND");

    const crossParentDelete = await shareWrite(
      "DELETE",
      `/api/v1/share/tasks/${mainTask}/subtasks/${foreignSubtask}?version=${before.version}`,
      cookieA,
    );
    expect(crossParentDelete.statusCode).toBe(404);
    expect(crossParentDelete.json().error.code).toBe("TASK_NOT_FOUND");

    const missingSubtask = await shareWrite(
      "PATCH",
      `/api/v1/share/tasks/${mainTask}/subtasks/${randomUUID()}`,
      cookieA,
      { version: before.version, description: "不存在" },
    );
    expect(missingSubtask.statusCode).toBe(404);
    expect(missingSubtask.json().error.code).toBe("TASK_NOT_FOUND");

    // 被拒绝的跨父任务操作不影响 foreignTask 的数据。
    expect((await currentTask(foreignTask, cookieC)).subtasks.some((entry) => entry.id === foreignSubtask)).toBe(true);
  });

  it("已软删除的小任务不能再更新/删除", async () => {
    const before = await currentTask(mainTask);
    const deleted = await shareWrite(
      "DELETE",
      `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByA}?version=${before.version}`,
      cookieA,
    );
    expect(deleted.statusCode).toBe(200);
    const versionAfterDelete = (deleted.json() as MutationBody).task.version;

    const update = await shareWrite(
      "PATCH",
      `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByA}`,
      cookieA,
      { version: versionAfterDelete, description: "复活" },
    );
    expect(update.statusCode).toBe(404);
    expect(update.json().error.code).toBe("TASK_NOT_FOUND");

    const remove = await shareWrite(
      "DELETE",
      `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByA}?version=${versionAfterDelete}`,
      cookieA,
    );
    expect(remove.statusCode).toBe(404);
    expect(remove.json().error.code).toBe("TASK_NOT_FOUND");
  });
});

describe("无有效变化不产生 revision（06 §7.1）", () => {
  it("detail 相同 / progress 相同 / 小任务空更新 → revision:null 且不追加历史", async () => {
    const before = await currentTask(mainTask);
    const beforeLines = (await revisionLines(mainTask)).length;

    const sameDetail = await shareWrite("PATCH", `/api/v1/share/tasks/${mainTask}/detail`, cookieA, {
      detail: before.detail,
      version: before.version,
    });
    expect(sameDetail.statusCode).toBe(200);
    const detailBody = sameDetail.json() as MutationBody;
    expect(detailBody.revision).toBeNull();
    expect(detailBody.task.version).toBe(before.version);

    const sameProgress = await shareWrite("PATCH", `/api/v1/share/tasks/${mainTask}/progress`, cookieA, {
      progress: before.progress,
      version: before.version,
    });
    expect(sameProgress.statusCode).toBe(200);
    const progressBody = sameProgress.json() as MutationBody;
    expect(progressBody.revision).toBeNull();
    expect(progressBody.task.version).toBe(before.version);

    const emptySubtaskUpdate = await shareWrite(
      "PATCH",
      `/api/v1/share/tasks/${mainTask}/subtasks/${subOwnedByA}`,
      cookieA,
      { version: before.version },
    );
    expect(emptySubtaskUpdate.statusCode).toBe(200);
    expect((emptySubtaskUpdate.json() as MutationBody).revision).toBeNull();

    expect((await revisionLines(mainTask)).length).toBe(beforeLines);
    expect((await currentTask(mainTask)).version).toBe(before.version);
  });
});

describe("归档成员会话不能写（#18 会话校验先于写路径）", () => {
  it("归档后旧 Cookie 401，分享链接也不能再换会话，且不追加 revision", async () => {
    const memberD = await createMember(app, "归档成员");
    const taskD = (await createTask(app, {
      folderId: folder,
      description: "归档成员的任务",
      ownerIds: [memberD],
    })).id;
    const { token } = await seedShareLink({ dataDir, memberId: memberD });
    const cookieD = await exchangeCookie(app, token);

    const before = await currentTask(taskD, cookieD);
    const writable = await shareWrite("PATCH", `/api/v1/share/tasks/${taskD}/progress`, cookieD, {
      progress: 20,
      version: before.version,
    });
    expect(writable.statusCode).toBe(200);

    const latest = await currentTask(taskD, cookieD);
    const beforeLines = (await revisionLines(taskD)).length;

    const archived = await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${memberD}` });
    expect(archived.statusCode).toBe(204);

    const blocked = await shareWrite("PATCH", `/api/v1/share/tasks/${taskD}/progress`, cookieD, {
      progress: 30,
      version: latest.version,
    });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe("SHARE_SESSION_REQUIRED");

    const exchange = await app.inject({ method: "POST", url: "/api/v1/share/session", payload: { token } });
    expect(exchange.statusCode).toBe(401);
    expect(exchange.json().error.code).toBe("SHARE_LINK_INVALID");

    expect((await revisionLines(taskD)).length).toBe(beforeLines);
  });
});
