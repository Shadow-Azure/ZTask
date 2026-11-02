// @vitest-environment node
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createFolder,
  createMember,
  createMemberAccessApp,
  createTask,
  deleteTask,
  exchangeCookie,
  seedShareLink,
  tmpDataDir,
} from "./support/share-fixtures.js";

interface TrackerTask {
  id: string;
  description: string;
  createdAt: string;
}

interface TrackerPage {
  items: TrackerTask[];
  nextCursor: string | null;
}

/** 位置游标的测试编码（与生产同构：base64url(JSON)，但用例只依赖位置语义）。 */
function positionCursor(position: { createdAt: string; taskId: string }): string {
  return Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
}

const TASK_COUNT = 55;

let dataDir: string;
let app: FastifyInstance;
let taskIds: string[];
let taskVersions: Map<string, number>;
let cookie: string;

beforeEach(async () => {
  dataDir = tmpDataDir();
  app = await createMemberAccessApp(dataDir);
  const member = await createMember(app, "陈晨");
  const folderId = await createFolder(app, "批量任务夹");

  taskIds = [];
  taskVersions = new Map();
  for (let index = 0; index < TASK_COUNT; index += 1) {
    const created = await createTask(app, {
      folderId,
      description: `批量任务 ${String(index).padStart(2, "0")}`,
      ownerIds: [member],
    });
    taskIds.push(created.id);
    taskVersions.set(created.id, created.version);
  }

  const { token } = await seedShareLink({ dataDir, memberId: member });
  cookie = await exchangeCookie(app, token);
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

function trackerUrl(cursor?: string): string {
  return cursor
    ? `/api/v1/share/tasks?view=tracker&cursor=${encodeURIComponent(cursor)}`
    : "/api/v1/share/tasks?view=tracker";
}

async function trackerPage(cursor?: string): Promise<TrackerPage> {
  const response = await app.inject({ method: "GET", url: trackerUrl(cursor), headers: { cookie } });
  expect(response.statusCode).toBe(200);
  return response.json() as TrackerPage;
}

describe("tracker cursor 分页（05 §1 / §6.4 / 07 §5.1）", () => {
  it(">50 条：首页 50 条 + opaque nextCursor，续页 5 条，不重复不丢", async () => {
    const first = await trackerPage();
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    // cursor 对客户端不透明：不暴露 taskId 编码（05 §1「opaque 最后位置标记」）。
    expect(typeof first.nextCursor).toBe("string");
    expect(first.nextCursor).not.toBe(first.items[49]!.id);

    const second = await trackerPage(first.nextCursor!);
    expect(second.items).toHaveLength(TASK_COUNT - 50);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.items, ...second.items].map((task) => task.id);
    expect(ids).toHaveLength(TASK_COUNT);
    expect(new Set(ids).size).toBe(TASK_COUNT);
    expect([...ids].sort()).toEqual([...taskIds].sort());
  });

  it("排序稳定：createdAt 升序，相同 createdAt 用 taskId 升序", async () => {
    const first = await trackerPage();
    const second = await trackerPage(first.nextCursor!);
    const all = [...first.items, ...second.items];
    const keys = all.map((task) => `${task.createdAt}|${task.id}`);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("游标项被管理员软删除后仍能续页：不 400、不重复、不丢后续项", async () => {
    const first = await trackerPage();
    const cursor = first.nextCursor!;
    const removedId = first.items[49]!.id;

    // 管理员并发软删除游标指向的那条任务。
    await deleteTask(app, removedId, taskVersions.get(removedId)!);

    const second = await trackerPage(cursor);
    expect(second.items).toHaveLength(TASK_COUNT - 50);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.items.slice(0, 49), ...second.items].map((task) => task.id);
    expect(ids).toHaveLength(TASK_COUNT - 1);
    expect(new Set(ids).size).toBe(TASK_COUNT - 1);
    expect(ids).not.toContain(removedId);
    // 不丢后续项：并集恰好是「除被删项外的全部任务」。
    expect([...ids].sort()).toEqual(taskIds.filter((id) => id !== removedId).sort());
  });

  it("同一 cursor 重复请求幂等：结果一致且不重复", async () => {
    const first = await trackerPage();
    const second = await trackerPage(first.nextCursor!);
    const replay = await trackerPage(first.nextCursor!);

    expect(replay.items.map((task) => task.id)).toEqual(second.items.map((task) => task.id));
    const ids = [...second.items, ...replay.items].map((task) => task.id);
    expect(new Set(ids).size).toBe(second.items.length);
    expect(ids).not.toContain(first.items[49]!.id);
  });

  it("游标只描述位置：游标项不在结果集内也照常续页，超出末项则返回空页", async () => {
    // 一个明显的未来位置：不应 400，而是「没有更多」。
    const future = positionCursor({ createdAt: "2999-01-01T00:00:00.000Z", taskId: randomUUID() });
    const body = await trackerPage(future);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("非法 cursor（乱码 / base64 非 JSON / 缺字段 / 字段非法）一律 400 INVALID_REQUEST", async () => {
    const invalidCursors = [
      "%%%not-base64%%%",
      Buffer.from("not json", "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ taskId: taskIds[0] }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z" }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ createdAt: "not-a-date", taskId: taskIds[0] }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z", taskId: "not-a-uuid" }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify([]), "utf8").toString("base64url"),
    ];
    for (const cursor of invalidCursors) {
      const response = await app.inject({ method: "GET", url: trackerUrl(cursor), headers: { cookie } });
      expect(response.statusCode, cursor).toBe(400);
      expect(response.json().error.code).toBe("INVALID_REQUEST");
    }
  });
});
