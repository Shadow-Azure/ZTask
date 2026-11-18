// @vitest-environment node
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, initStore, readTaskAggregate } from "@ztask/server";
import type { FastifyInstance } from "fastify";

let dataDir: string;
let app: FastifyInstance;

const TASK_1 = "11111111-1111-4111-8111-111111111111";
const FOLDER_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

beforeEach(async () => {
  dataDir = path.join("/tmp", `ztask-members-api-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const store = await initStore({ dataDir, applicationVersion: "0.1.0" });
  app = await buildApp(
    { host: "127.0.0.1", port: 0, dataDir, staticRoot: null },
    { store },
  );
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function seedTaskWithAssignments(ownerId: string, collaboratorId: string): Promise<void> {
  const store = await initStore({ dataDir, applicationVersion: "0.1.0" });
  await store.folders.put(FOLDER_ID, { id: FOLDER_ID, parentId: null, name: "任务夹", position: 0 });
  await store.tasks.createAggregate({
    taskId: TASK_1,
    task: {
      folderId: FOLDER_ID,
      parentId: null,
      description: "种子任务",
      progress: 40,
      detailText: "",
      planText: "",
      importance: "mid",
      dueDate: null,
      createdAt: "2026-11-02T01:00:00.000Z",
      deletedAt: null,
    },
    subtasks: [],
    assignments: [
      { taskId: TASK_1, memberId: ownerId, kind: "owner" },
      { taskId: TASK_1, memberId: collaboratorId, kind: "collaborator" },
    ],
    actor: { kind: "admin", memberId: null, name: "管理员" },
  });
}

async function createMember(name: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name } });
  return response.json().id as string;
}

describe("POST /admin/members", () => {
  it("创建成员：201，默认色板与空角色，shareLink=null", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name: "陈晨", role: "前端工程师" } });
    expect(response.statusCode).toBe(201);
    const member = response.json();
    expect(member.name).toBe("陈晨");
    expect(member.role).toBe("前端工程师");
    expect(member.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(member.archivedAt).toBeNull();
    expect(member.isAdmin).toBe(false);
    expect(member.shareLink).toBeNull();
    expect(member.counts).toEqual({ owned: 0, collaborated: 0 });
  });

  it("空名称返回 400", async () => {
    const blank = await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name: "  " } });
    expect(blank.statusCode).toBe(400);
  });
});

describe("GET /admin/members", () => {
  it("返回全部成员与主任务计数（负责中/协作中）", async () => {
    const chenId = await createMember("陈晨");
    const linId = await createMember("林悦");
    await seedTaskWithAssignments(chenId, linId);

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/members" });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as Array<{ name: string; counts: { owned: number; collaborated: number } }>;
    const chen = items.find((m) => m.name === "陈晨");
    const lin = items.find((m) => m.name === "林悦");
    expect(chen?.counts).toEqual({ owned: 1, collaborated: 0 });
    expect(lin?.counts).toEqual({ owned: 0, collaborated: 1 });
  });
});

describe("PATCH /admin/members/{id}", () => {
  it("管理员权限：默认 false，可打开与关闭并持久化到列表", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name: "陈晨" } });
    const id = created.json().id as string;
    expect(created.json().isAdmin).toBe(false);

    const enabled = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/members/${id}`,
      payload: { isAdmin: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().isAdmin).toBe(true);

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/members" });
    expect((list.json() as { items: Array<{ id: string; isAdmin: boolean }> }).items.find((item) => item.id === id)?.isAdmin).toBe(true);

    const disabled = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/members/${id}`,
      payload: { isAdmin: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().isAdmin).toBe(false);
  });

  it("部分更新姓名/角色/颜色", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name: "陈晨" } });
    const id = created.json().id;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/members/${id}`,
      payload: { role: "前端负责人", color: "#8a55c9" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().name).toBe("陈晨");
    expect(patched.json().role).toBe("前端负责人");
    expect(patched.json().color).toBe("#8a55c9");
  });

  it("成员不存在返回 404", async () => {
    const missing = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/members/11111111-1111-4111-8111-111111111111",
      payload: { name: "x" },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("DELETE /admin/members/{id}（归档语义）", () => {
  it("归档：archivedAt 置位；任务聚合不被重写；列表仍可见（归档态）", async () => {
    const id = await createMember("陈晨");
    const collaboratorId = await createMember("林悦");
    await seedTaskWithAssignments(id, collaboratorId);

    const removed = await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${id}` });
    expect(removed.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/members" });
    const items = list.json().items as Array<{ id: string; archivedAt: string | null; counts: { owned: number } }>;
    const archived = items.find((m) => m.id === id);
    expect(archived?.archivedAt).not.toBeNull();
    // 归档后计数按"有效分配"归零（06 §4.1：待分配）
    expect(archived?.counts.owned).toBe(0);

    // 任务聚合中的 assignment 保留（不级联重写）
    const aggregate = await readTaskAggregate(dataDir, TASK_1);
    expect(aggregate?.assignments.some((a) => a.memberId === id)).toBe(true);
  });

  it("成员不存在返回 404", async () => {
    const missing = await app.inject({ method: "DELETE", url: "/api/v1/admin/members/11111111-1111-4111-8111-111111111111" });
    expect(missing.statusCode).toBe(404);
  });
});
