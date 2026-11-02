// @vitest-environment node
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DashboardChanges, Task, TaskChange } from "@ztask/shared";
import { createHistoryService } from "@ztask/server";
import {
  createFolder,
  createMember,
  createMemberAccessApp,
  createSubtask,
  createTask,
  deleteTask,
  exchangeCookie,
  seedShareLink,
  tmpDataDir,
} from "../member-access/support/share-fixtures.js";

/**
 * 时间段历史服务端契约（issue #22 / 05 §2.2 §5.3 §6.14、06 §7、07 §8.2）：
 * 默认/自定义区间、DST 边界、before/after 选择、created/updated/deleted、
 * currentlyDeleted 置底、成员裁剪与响应形状。
 *
 * 固定时钟 + 真实 initStore/buildApp + 真实分享链接；时钟同时注入 TaskStore
 * （revision recordedAt）与历史服务（now），因此时间断言完全确定。
 */
const TIME_ZONE = "Asia/Shanghai";
const DEFAULT_NOW = "2026-05-10T02:30:00.000Z";
/** 自定义区间 2026-05-08 00:00 → 2026-05-10 00:00（上海）。 */
const CUSTOM_START_DATE = "2026-05-08";
const CUSTOM_END_DATE = "2026-05-09";
const CUSTOM_START = "2026-05-07T16:00:00.000Z";
const CUSTOM_END = "2026-05-09T16:00:00.000Z";
/** 早于自定义区间起点。 */
const BEFORE_WINDOW = "2026-05-07T10:00:00.000Z";
const UNKNOWN_FOLDER_ID = "00000000-0000-4000-8000-000000000000";

let dataDir: string;
let app: FastifyInstance;
let now: Date;

function at(iso: string): void {
  now = new Date(iso);
}

beforeEach(async () => {
  now = new Date(DEFAULT_NOW);
  dataDir = tmpDataDir();
  app = await createMemberAccessApp(dataDir, { timeZone: TIME_ZONE, clock: () => new Date(now) });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

interface ChangesQuery {
  mode?: "default" | "custom";
  startDate?: string;
  endDate?: string;
  memberIds?: string[];
}

function changesPath(base: "admin" | "share", folderId: string, params: ChangesQuery): string {
  const query = new URLSearchParams({ folderId, mode: params.mode ?? "custom" });
  if (params.startDate !== undefined) query.set("startDate", params.startDate);
  if (params.endDate !== undefined) query.set("endDate", params.endDate);
  if (params.memberIds !== undefined && params.memberIds.length > 0) {
    query.set("memberIds", params.memberIds.join(","));
  }
  return `/api/v1/${base}/dashboard/changes?${query.toString()}`;
}

/** 管理端历史查询（默认 custom 2026-05-08…2026-05-09，可按需覆盖）。 */
async function adminChanges(folderId: string, params: ChangesQuery = {}): Promise<DashboardChanges> {
  const response = await app.inject({
    method: "GET",
    url: changesPath("admin", folderId, {
      mode: "custom",
      startDate: CUSTOM_START_DATE,
      endDate: CUSTOM_END_DATE,
      ...params,
    }),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as DashboardChanges;
}

/** 分享域历史查询（带成员 Cookie）。 */
async function shareChanges(
  cookie: string,
  folderId: string,
  params: ChangesQuery = {},
): Promise<DashboardChanges> {
  const response = await app.inject({
    method: "GET",
    url: changesPath("share", folderId, {
      mode: "custom",
      startDate: CUSTOM_START_DATE,
      endDate: CUSTOM_END_DATE,
      ...params,
    }),
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as DashboardChanges;
}

/** 管理端部分更新，返回最新 Task（version 用于后续提交）。 */
async function patchTask(id: string, version: number, patch: Record<string, unknown>): Promise<Task> {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/v1/admin/tasks/${id}`,
    payload: { version, ...patch },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as Task;
}

function itemOf(changes: DashboardChanges, taskId: string): TaskChange {
  const item = changes.items.find((entry) => entry.taskId === taskId);
  if (!item) throw new Error(`missing change for ${taskId}`);
  return item;
}

describe("默认区间与响应形状", () => {
  it("default = manifest 时区「昨天 00:00」至 now，并回显实际 UTC 边界", async () => {
    const folderId = await createFolder(app, "默认区间");
    const owner = await createMember(app, "陈晨");

    at("2026-05-08T10:00:00.000Z"); // 上海 05-08 18:00，早于区间起点
    const task = await createTask(app, {
      folderId,
      description: "默认区间任务",
      ownerIds: [owner],
      progress: 10,
    });
    at("2026-05-09T03:00:00.000Z"); // 上海 05-09 11:00，区间内
    await patchTask(task.id, task.version, { progress: 70, detail: "首行\n第二行" });
    at(DEFAULT_NOW);

    const changes = await adminChanges(folderId, { mode: "default" });
    // now = 上海 05-10 10:30 → 昨天 00:00 = 05-08T16:00Z。
    expect(changes).toMatchObject({
      start: "2026-05-08T16:00:00.000Z",
      end: DEFAULT_NOW,
      timeZone: TIME_ZONE,
    });
    expect(Object.keys(changes)).toEqual(["start", "end", "timeZone", "items"]);
    expect(changes.items).toHaveLength(1);
    const item = itemOf(changes, task.id);
    expect(item).toEqual({
      taskId: task.id,
      description: "默认区间任务",
      importance: "mid",
      owners: [{ id: owner, name: "陈晨", role: "", color: expect.any(String) }],
      before: {
        progress: 10,
        detail: "默认区间任务详情",
        recordedAt: "2026-05-08T10:00:00.000Z",
      },
      after: { progress: 70, detail: "首行\n第二行", recordedAt: "2026-05-09T03:00:00.000Z" },
      changeKind: "updated",
      currentlyDeleted: false,
    });
  });

  it("空区间 / 未知 folderId 返回空 items，但仍回显边界", async () => {
    const folderId = await createFolder(app, "空区间");
    const owner = await createMember(app, "陈晨");
    at(BEFORE_WINDOW);
    await createTask(app, { folderId, description: "区间外创建", ownerIds: [owner] });

    const empty = await adminChanges(folderId);
    expect(empty).toEqual({
      start: CUSTOM_START,
      end: CUSTOM_END,
      timeZone: TIME_ZONE,
      items: [],
    });

    const unknown = await adminChanges(UNKNOWN_FOLDER_ID);
    expect(unknown.items).toEqual([]);
    expect(unknown.start).toBe(CUSTOM_START);
    expect(unknown.end).toBe(CUSTOM_END);
  });
});

describe("custom 区间边界", () => {
  it("范围包含后代任务夹；end 之后创建的任务不出现", async () => {
    const root = await createFolder(app, "历史根");
    const child = await createFolder(app, "历史子夹", root);
    const owner = await createMember(app, "陈晨");

    at(BEFORE_WINDOW);
    const childTask = await createTask(app, { folderId: child, description: "子夹任务", ownerIds: [owner], progress: 10 });
    at("2026-05-08T02:00:00.000Z");
    await patchTask(childTask.id, childTask.version, { progress: 60 });
    // end（上海 05-10 00:00）之后创建：before/after 都为 null，必须跳过而非伪造 created。
    at("2026-05-10T00:00:00.000Z");
    await createTask(app, { folderId: root, description: "区间后创建", ownerIds: [owner], progress: 30 });

    expect((await adminChanges(root)).items.map((entry) => entry.taskId)).toEqual([childTask.id]);
    expect((await adminChanges(child)).items.map((entry) => entry.taskId)).toEqual([childTask.id]);
  });

  it("结束日包含全天；start 恰好等于变更时刻不漏算", async () => {
    const folderId = await createFolder(app, "边界");
    const owner = await createMember(app, "陈晨");
    at(BEFORE_WINDOW);
    const task = await createTask(app, {
      folderId,
      description: "边界任务",
      ownerIds: [owner],
      progress: 10,
    });

    // 起点 05-08 00:00（上海）恰好有变更：before 仍是区间外快照，变更本身必须进入 after。
    at(CUSTOM_START);
    await patchTask(task.id, task.version, { progress: 20 });
    // 结束日 23:59:59（上海）仍在区间内。
    at("2026-05-09T15:59:59.000Z");
    const last = await patchTask(task.id, task.version + 1, { progress: 30 });
    // 次日 00:00 恰为 end（开区间），不得进入 after。
    at(CUSTOM_END);
    await patchTask(task.id, last.version, { progress: 40 });

    const changes = await adminChanges(folderId);
    expect(changes.start).toBe(CUSTOM_START);
    expect(changes.end).toBe(CUSTOM_END);
    expect(changes.items).toHaveLength(1);
    const item = itemOf(changes, task.id);
    expect(item.before?.progress).toBe(10);
    expect(item.after.progress).toBe(30);
    expect(item.after.recordedAt).toBe("2026-05-09T15:59:59.000Z");
    expect(item.changeKind).toBe("updated");
  });

  it("before 取 <start 的最后一条、after 取 <end 的最后一条；同毫秒 taskVersion 决胜", async () => {
    const folderId = await createFolder(app, "快照选择");
    const owner = await createMember(app, "陈晨");
    at(BEFORE_WINDOW);
    const task = await createTask(app, {
      folderId,
      description: "快照选择",
      ownerIds: [owner],
      progress: 0,
    });

    // 同一毫秒两次提交：taskVersion 2 与 3，均早于 start。
    at("2026-05-07T15:59:59.000Z");
    let current = await patchTask(task.id, task.version, { progress: 30 });
    current = await patchTask(task.id, current.version, { progress: 40 });
    // 同一毫秒两次提交：taskVersion 4 与 5，均落在区间内且早于 end。
    at("2026-05-08T10:00:00.000Z");
    current = await patchTask(task.id, current.version, { progress: 50 });
    await patchTask(task.id, current.version, { progress: 60 });

    const item = itemOf(await adminChanges(folderId), task.id);
    expect(item.before).toEqual({
      progress: 40,
      detail: "快照选择详情",
      recordedAt: "2026-05-07T15:59:59.000Z",
    });
    expect(item.after).toEqual({
      progress: 60,
      detail: "快照选择详情",
      recordedAt: "2026-05-08T10:00:00.000Z",
    });
  });
});

describe("changeKind 与忽略规则", () => {
  it("区间内创建 created、创建后删除 deleted（before=null）；同值/仅分配/仅重要度变化忽略", async () => {
    const folderId = await createFolder(app, "分类");
    const ownerA = await createMember(app, "陈晨");
    const ownerB = await createMember(app, "林悦");

    at(BEFORE_WINDOW);
    const regular = await createTask(app, { folderId, description: "进度变化", ownerIds: [ownerA], progress: 10 });
    const importanceOnly = await createTask(app, { folderId, description: "仅重要度", ownerIds: [ownerA], progress: 10 });
    const assignmentOnly = await createTask(app, { folderId, description: "仅分配", ownerIds: [ownerA], progress: 10 });
    const untouched = await createTask(app, { folderId, description: "区间内无变化", ownerIds: [ownerA], progress: 10 });

    at("2026-05-08T02:00:00.000Z");
    await patchTask(regular.id, regular.version, { progress: 60 });
    at("2026-05-08T03:00:00.000Z");
    await patchTask(importanceOnly.id, importanceOnly.version, { importance: "high" });
    at("2026-05-08T04:00:00.000Z");
    await patchTask(assignmentOnly.id, assignmentOnly.version, { ownerIds: [ownerB] });

    at("2026-05-08T05:00:00.000Z");
    const created = await createTask(app, { folderId, description: "区间内创建", ownerIds: [ownerA], progress: 5 });
    at("2026-05-08T06:00:00.000Z");
    const removed = await createTask(app, { folderId, description: "创建后删除", ownerIds: [ownerA] });
    at("2026-05-08T06:30:00.000Z");
    await deleteTask(app, removed.id, removed.version);

    const changes = await adminChanges(folderId);
    expect(new Set(changes.items.map((entry) => entry.taskId))).toEqual(
      new Set([regular.id, created.id, removed.id]),
    );

    const updated = itemOf(changes, regular.id);
    expect(updated.changeKind).toBe("updated");
    expect(updated.before?.progress).toBe(10);
    expect(updated.after.progress).toBe(60);

    const createdItem = itemOf(changes, created.id);
    expect(createdItem.changeKind).toBe("created");
    expect(createdItem.before).toBeNull();
    expect(createdItem.after).toEqual({
      progress: 5,
      detail: "区间内创建详情",
      recordedAt: "2026-05-08T05:00:00.000Z",
    });

    // 区间内创建后删除：最后一次 revision 是 delete，before 仍为 null，主状态是 deleted。
    const removedItem = itemOf(changes, removed.id);
    expect(removedItem.changeKind).toBe("deleted");
    expect(removedItem.before).toBeNull();
    expect(removedItem.currentlyDeleted).toBe(true);
    expect(removedItem.after.recordedAt).toBe("2026-05-08T06:30:00.000Z");

    // 同值（importanceOnly / untouched）与仅分配变化都不产生 diff 项。
    expect(changes.items.map((entry) => entry.taskId)).not.toContain(importanceOnly.id);
    expect(changes.items.map((entry) => entry.taskId)).not.toContain(assignmentOnly.id);
    expect(changes.items.map((entry) => entry.taskId)).not.toContain(untouched.id);
  });
});

  it("窗口开始前已删除的任务不出现在后续窗口（before===after 视为无变化）", async () => {
    const folderId = await createFolder(app, "窗口前删除");
    const owner = await createMember(app, "陈晨");
    at(BEFORE_WINDOW);
    const task = await createTask(app, { folderId, description: "早删任务", ownerIds: [owner], detail: "删前" });
    at("2026-05-08T02:00:00.000Z");
    await deleteTask(app, task.id, task.version);
    at(DEFAULT_NOW);

    // 窗口 A 覆盖删除时刻 → deleted。
    const windowA = await app.inject({
      method: "GET",
      url: changesPath("admin", folderId, { mode: "custom", startDate: "2026-05-08", endDate: "2026-05-08" }),
    });
    expect(windowA.statusCode).toBe(200);
    expect((windowA.json() as DashboardChanges).items.map((item) => item.changeKind)).toEqual(["deleted"]);

    // 窗口 B 完全在删除之后 → before/after 是同一 revision，不应重复出现。
    const windowB = await app.inject({
      method: "GET",
      url: changesPath("admin", folderId, { mode: "custom", startDate: "2026-05-09", endDate: "2026-05-09" }),
    });
    expect(windowB.statusCode).toBe(200);
    expect((windowB.json() as DashboardChanges).items).toEqual([]);
  });

describe("排序", () => {
  it("currentlyDeleted 置底（updated/deleted 都可置底）；组内 after 降序再按 taskId 升序", async () => {
    const folderId = await createFolder(app, "排序");
    const owner = await createMember(app, "陈晨");

    at(BEFORE_WINDOW);
    const early = await createTask(app, { folderId, description: "较早", ownerIds: [owner], progress: 0 });
    const recent = await createTask(app, { folderId, description: "最近", ownerIds: [owner], progress: 0 });
    const tieA = await createTask(app, { folderId, description: "同刻 A", ownerIds: [owner], progress: 0 });
    const tieB = await createTask(app, { folderId, description: "同刻 B", ownerIds: [owner], progress: 0 });
    const updatedDeleted = await createTask(app, { folderId, description: "更新后删除", ownerIds: [owner], progress: 0 });

    at("2026-05-08T02:00:00.000Z");
    await patchTask(early.id, early.version, { progress: 50 });
    at("2026-05-08T08:00:00.000Z");
    await patchTask(tieA.id, tieA.version, { progress: 50 });
    await patchTask(tieB.id, tieB.version, { progress: 50 });
    at("2026-05-09T10:00:00.000Z");
    await patchTask(recent.id, recent.version, { progress: 50 });
    // 区间内有进度更新；删除发生在 end 之后 → changeKind=updated + currentlyDeleted=true。
    at("2026-05-08T05:00:00.000Z");
    const updatedDeletedTask = await patchTask(updatedDeleted.id, updatedDeleted.version, { progress: 50 });
    at("2026-05-09T20:00:00.000Z");
    await deleteTask(app, updatedDeleted.id, updatedDeletedTask.version);
    // 区间内创建并删除 → changeKind=deleted。
    at("2026-05-08T06:00:00.000Z");
    const deletedInWindow = await createTask(app, { folderId, description: "区间内删除", ownerIds: [owner] });
    at("2026-05-08T07:00:00.000Z");
    await deleteTask(app, deletedInWindow.id, deletedInWindow.version);

    at(DEFAULT_NOW);
    const changes = await adminChanges(folderId);
    const tieOrder = [tieA.id, tieB.id].sort();
    expect(changes.items.map((entry) => entry.taskId)).toEqual([
      recent.id,
      ...tieOrder,
      early.id,
      deletedInWindow.id,
      updatedDeleted.id,
    ]);
    expect(changes.items.map((entry) => entry.currentlyDeleted)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(itemOf(changes, updatedDeleted.id).changeKind).toBe("updated");
    expect(itemOf(changes, deletedInWindow.id).changeKind).toBe("deleted");
  });
});

describe("成员裁剪", () => {
  it("管理员 memberIds 按 after 快照 owner 过滤；归档成员保留名字但不再命中筛选", async () => {
    const folderId = await createFolder(app, "管理员成员过滤");
    const ownerA = await createMember(app, "陈晨");
    const ownerB = await createMember(app, "林悦");

    at(BEFORE_WINDOW);
    const moved = await createTask(app, { folderId, description: "改派给 B", ownerIds: [ownerA], progress: 10 });
    const ownedA = await createTask(app, { folderId, description: "仍是 A", ownerIds: [ownerA], progress: 10 });

    at("2026-05-08T02:00:00.000Z");
    await patchTask(moved.id, moved.version, { progress: 60, ownerIds: [ownerB] });
    at("2026-05-08T03:00:00.000Z");
    await patchTask(ownedA.id, ownedA.version, { progress: 60 });

    const all = await adminChanges(folderId);
    expect(new Set(all.items.map((entry) => entry.taskId))).toEqual(new Set([moved.id, ownedA.id]));
    // owners 取 after 快照：moved 的当前/历史 owner 是 B，不再是 A。
    expect(itemOf(all, moved.id).owners.map((entry) => entry.name)).toEqual(["林悦"]);

    const onlyA = await adminChanges(folderId, { memberIds: [ownerA] });
    expect(onlyA.items.map((entry) => entry.taskId)).toEqual([ownedA.id]);
    const onlyB = await adminChanges(folderId, { memberIds: [ownerB] });
    expect(onlyB.items.map((entry) => entry.taskId)).toEqual([moved.id]);
    const both = await adminChanges(folderId, { memberIds: [ownerA, ownerB] });
    expect(new Set(both.items.map((entry) => entry.taskId))).toEqual(new Set([moved.id, ownedA.id]));

    // 归档 B：成员文件仍在（历史 owner 名可读），但 active 过滤不再命中 B。
    const archived = await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${ownerB}` });
    expect(archived.statusCode).toBe(204);
    const afterArchive = await adminChanges(folderId);
    expect(itemOf(afterArchive, moved.id).owners.map((entry) => entry.name)).toEqual(["林悦"]);
    expect((await adminChanges(folderId, { memberIds: [ownerB] })).items).toEqual([]);
    expect((await adminChanges(folderId, { memberIds: [ownerA] })).items.map((entry) => entry.taskId)).toEqual([
      ownedA.id,
    ]);
  });

  it("仅小任务被分配者看不到父任务历史（避免泄露主任务详情）", async () => {
    const folderId = await createFolder(app, "小任务历史");
    const ownerA = await createMember(app, "陈晨");
    const ownerC = await createMember(app, "赵敏");
    at(BEFORE_WINDOW);
    const parent = await createTask(app, { folderId, description: "主任务", ownerIds: [ownerA], detail: "主任务私密详情" });
    const subtask = await createSubtask(app, { folderId, parentId: parent.id, description: "C 的小任务", ownerId: ownerC });
    // 区间内由 owner A 改动主任务进度，产生一条 A 可见、C 不可见的 updated 历史。
    at("2026-05-08T02:00:00.000Z");
    await patchTask(parent.id, subtask.parentVersion, { progress: 50 });
    at(DEFAULT_NOW);

    const { token: tokenC } = await seedShareLink({ dataDir, memberId: ownerC });
    const cookieC = await exchangeCookie(app, tokenC);
    const asC = await app.inject({
      method: "GET",
      url: changesPath("share", folderId, { mode: "custom", startDate: CUSTOM_START_DATE, endDate: CUSTOM_END_DATE }),
      headers: { cookie: cookieC },
    });
    expect(asC.statusCode).toBe(200);
    expect((asC.json() as DashboardChanges).items).toEqual([]);

    // owner A 仍能看到同一条历史。
    const { token: tokenA } = await seedShareLink({ dataDir, memberId: ownerA });
    const cookieA = await exchangeCookie(app, tokenA);
    const asA = await app.inject({
      method: "GET",
      url: changesPath("share", folderId, { mode: "custom", startDate: CUSTOM_START_DATE, endDate: CUSTOM_END_DATE }),
      headers: { cookie: cookieA },
    });
    expect(asA.statusCode).toBe(200);
    expect((asA.json() as DashboardChanges).items.map((item) => item.description)).toContain("主任务");
  });
});

describe("分享域历史", () => {
  let folderId: string;
  let memberA: string;
  let memberB: string;
  let memberC: string;
  let cookieA: string;
  let cookieB: string;
  let aOnly: { id: string; version: number };
  let bOnly: { id: string; version: number };
  let shared: { id: string; version: number };
  let aDeleted: { id: string; version: number };

  beforeEach(async () => {
    folderId = await createFolder(app, "分享历史");
    memberA = await createMember(app, "陈晨");
    memberB = await createMember(app, "林悦");
    memberC = await createMember(app, "赵敏");

    at(BEFORE_WINDOW);
    aOnly = await createTask(app, { folderId, description: "A 负责", ownerIds: [memberA], progress: 10 });
    bOnly = await createTask(app, { folderId, description: "B 负责", ownerIds: [memberB], progress: 10 });
    shared = await createTask(app, {
      folderId,
      description: "A+B 负责",
      ownerIds: [memberA, memberB],
      progress: 10,
    });
    aDeleted = await createTask(app, { folderId, description: "A 的已删除任务", ownerIds: [memberA], progress: 10 });

    at("2026-05-08T02:00:00.000Z");
    await patchTask(aOnly.id, aOnly.version, { progress: 60 });
    at("2026-05-08T03:00:00.000Z");
    await patchTask(bOnly.id, bOnly.version, { progress: 60 });
    at("2026-05-08T04:00:00.000Z");
    await patchTask(shared.id, shared.version, { progress: 60 });
    at("2026-05-08T05:00:00.000Z");
    await deleteTask(app, aDeleted.id, aDeleted.version);

    at(DEFAULT_NOW);
    const { token: tokenA } = await seedShareLink({ dataDir, memberId: memberA });
    const { token: tokenB } = await seedShareLink({ dataDir, memberId: memberB });
    cookieA = await exchangeCookie(app, tokenA);
    cookieB = await exchangeCookie(app, tokenB);
  });

  it("成员只能看当前相关任务的历史，memberIds 只能在可见范围内缩小", async () => {
    const changesA = await shareChanges(cookieA, folderId);
    // A 看不到 B 的独占任务；自己负责的软删除任务仍在历史中。
    expect(new Set(changesA.items.map((entry) => entry.taskId))).toEqual(
      new Set([aOnly.id, shared.id, aDeleted.id]),
    );
    expect(itemOf(changesA, aDeleted.id).currentlyDeleted).toBe(true);
    expect(itemOf(changesA, aDeleted.id).changeKind).toBe("deleted");

    const changesB = await shareChanges(cookieB, folderId);
    expect(new Set(changesB.items.map((entry) => entry.taskId))).toEqual(
      new Set([bOnly.id, shared.id]),
    );

    // B 出现在 A 可见任务（A+B 负责）的快照里，因此可选；结果只保留 after owner=B 的任务。
    const onlyB = await shareChanges(cookieA, folderId, { memberIds: [memberB] });
    expect(onlyB.items.map((entry) => entry.taskId)).toEqual([shared.id]);
    const onlyA = await shareChanges(cookieA, folderId, { memberIds: [memberA] });
    // shared 的 after owner 同时含 A/B，因此选 A 时也保留。
    expect(new Set(onlyA.items.map((entry) => entry.taskId))).toEqual(
      new Set([aOnly.id, shared.id, aDeleted.id]),
    );

    // 与 A 无任何共同任务的成员不可见：400，不泄露范围。
    const probe = await app.inject({
      method: "GET",
      url: changesPath("share", folderId, {
        mode: "custom",
        startDate: CUSTOM_START_DATE,
        endDate: CUSTOM_END_DATE,
        memberIds: [memberC],
      }),
      headers: { cookie: cookieA },
    });
    expect(probe.statusCode).toBe(400);
    expect((probe.json() as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
  });

  it("无会话 401；响应 no-store", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: changesPath("share", folderId, {
        mode: "custom",
        startDate: CUSTOM_START_DATE,
        endDate: CUSTOM_END_DATE,
      }),
    });
    expect(anonymous.statusCode).toBe(401);
    expect((anonymous.json() as { error: { code: string } }).error.code).toBe("SHARE_SESSION_REQUIRED");

    const response = await app.inject({
      method: "GET",
      url: changesPath("share", folderId, {
        mode: "custom",
        startDate: CUSTOM_START_DATE,
        endDate: CUSTOM_END_DATE,
      }),
      headers: { cookie: cookieA },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("参数校验", () => {
  it("非法 mode/日期/区间返回 400 INVALID_REQUEST", async () => {
    const folderId = await createFolder(app, "参数校验");
    const memberId = await createMember(app, "陈晨");
    const { token } = await seedShareLink({ dataDir, memberId });
    const cookie = await exchangeCookie(app, token);

    const invalid: Array<{ url: string; cookie?: string }> = [
      { url: "/api/v1/admin/dashboard/changes" },
      { url: "/api/v1/admin/dashboard/changes?folderId=" },
      { url: `/api/v1/admin/dashboard/changes?folderId=${folderId}&mode=weekly` },
      { url: `/api/v1/admin/dashboard/changes?folderId=${folderId}&mode=custom` },
      { url: `/api/v1/admin/dashboard/changes?folderId=${folderId}&mode=custom&startDate=2026-05-08` },
      { url: `/api/v1/admin/dashboard/changes?folderId=${folderId}&mode=custom&startDate=2026-05-08&endDate=2026-5-9` },
      { url: `/api/v1/admin/dashboard/changes?folderId=${folderId}&mode=custom&startDate=2026-02-31&endDate=2026-03-01` },
      { url: `/api/v1/admin/dashboard/changes?folderId=${folderId}&mode=custom&startDate=2026-05-10&endDate=2026-05-09` },
      {
        url: `/api/v1/admin/dashboard/changes?folderId=${folderId}&mode=custom&startDate=2026-05-08&startDate=2026-05-09&endDate=2026-05-09`,
      },
      { url: `/api/v1/share/dashboard/changes?folderId=${folderId}&mode=weekly`, cookie },
    ];
    for (const entry of invalid) {
      const response = await app.inject({
        method: "GET",
        url: entry.url,
        ...(entry.cookie === undefined ? {} : { headers: { cookie: entry.cookie } }),
      });
      expect(response.statusCode, entry.url).toBe(400);
      expect((response.json() as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
    }
  });
});

describe("时区与 DST", () => {
  it("本地 00:00 被夏令时跳过时取当天第一个有效瞬间，不抛错", async () => {
    const emptyDir = tmpDataDir();
    try {
      // America/Santiago 2026-09-06 00:00 不存在（00:00 直接跳到 01:00）。
      const service = createHistoryService({
        dataDir: emptyDir,
        timeZone: "America/Santiago",
        clock: () => new Date("2026-09-06T12:00:00.000Z"),
      });
      const custom = await service.changes({
        folderId: UNKNOWN_FOLDER_ID,
        mode: "custom",
        startDate: "2026-09-06",
        endDate: "2026-09-06",
      });
      expect(custom.start).toBe("2026-09-06T04:00:00.000Z");
      expect(custom.end).toBe("2026-09-07T03:00:00.000Z");
      expect(custom.timeZone).toBe("America/Santiago");

      const fallback = await service.changes({ folderId: UNKNOWN_FOLDER_ID, mode: "default" });
      expect(fallback.start).toBe("2026-09-05T04:00:00.000Z");
      expect(fallback.end).toBe("2026-09-06T12:00:00.000Z");
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
