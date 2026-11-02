// @vitest-environment node
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createFolder,
  createMember,
  createMemberAccessApp,
  createTask,
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

const TASK_COUNT = 55;

let dataDir: string;
let app: FastifyInstance;
let taskIds: string[];
let cookie: string;

beforeEach(async () => {
  dataDir = tmpDataDir();
  app = await createMemberAccessApp(dataDir);
  const member = await createMember(app, "陈晨");
  const folderId = await createFolder(app, "批量任务夹");

  taskIds = [];
  for (let index = 0; index < TASK_COUNT; index += 1) {
    const created = await createTask(app, {
      folderId,
      description: `批量任务 ${String(index).padStart(2, "0")}`,
      ownerIds: [member],
    });
    taskIds.push(created.id);
  }

  const { token } = await seedShareLink({ dataDir, memberId: member });
  cookie = await exchangeCookie(app, token);
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function trackerPage(cursor?: string): Promise<TrackerPage> {
  const url = cursor
    ? `/api/v1/share/tasks?view=tracker&cursor=${encodeURIComponent(cursor)}`
    : "/api/v1/share/tasks?view=tracker";
  const response = await app.inject({ method: "GET", url, headers: { cookie } });
  expect(response.statusCode).toBe(200);
  return response.json() as TrackerPage;
}

describe("tracker cursor 分页（05 §6.4）", () => {
  it(">50 条：首页 50 条 + nextCursor，续页 5 条，不重复不丢", async () => {
    const first = await trackerPage();
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    // cursor 是 base64url 的 taskId，指向本页最后一条。
    expect(Buffer.from(first.nextCursor!, "base64url").toString("utf8")).toBe(first.items[49]!.id);

    const second = await trackerPage(first.nextCursor!);
    expect(second.items).toHaveLength(TASK_COUNT - 50);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.items, ...second.items].map((task) => task.id);
    expect(ids).toHaveLength(TASK_COUNT);
    expect(new Set(ids).size).toBe(TASK_COUNT);
    expect([...ids].sort()).toEqual([...taskIds].sort());
  });

  it("排序稳定：createdAt 升序，相同 createdAt 用 taskId 升序；重复请求同一游标结果一致", async () => {
    const first = await trackerPage();
    const second = await trackerPage(first.nextCursor!);
    const all = [...first.items, ...second.items];
    const keys = all.map((task) => `${task.createdAt}|${task.id}`);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);

    const secondReplay = await trackerPage(first.nextCursor!);
    expect(secondReplay.items.map((task) => task.id)).toEqual(second.items.map((task) => task.id));
  });
});
