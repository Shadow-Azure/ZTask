// @vitest-environment node
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, createTaskStore, initStore } from "@ztask/server";
import type { FastifyInstance } from "fastify";

let dataDir: string;
let app: FastifyInstance;
let folderId: string;
let ownerA: string;
let ownerB: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `ztask-tasks-api-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const store = await initStore({ dataDir, applicationVersion: "0.1.0" });
  app = await buildApp({ host: "127.0.0.1", port: 0, dataDir, staticRoot: null }, { store });

  folderId = (await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "迭代", parentId: null } })).json().id;
  ownerA = (await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name: "陈晨" } })).json().id;
  ownerB = (await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name: "林悦" } })).json().id;
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

function createPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    folderId,
    parentId: null,
    description: "任务树组件重构",
    ownerIds: [ownerA],
    collaboratorIds: [ownerB],
    progress: 0,
    detail: "初始详情",
    importance: "high",
    dueDate: "2026-11-10",
    ...overrides,
  };
}

async function createMain(): Promise<{ id: string; version: number }> {
  const response = await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: createPayload() });
  expect(response.statusCode).toBe(201);
  const task = response.json();
  return { id: task.id, version: task.version };
}

describe("POST /admin/tasks（创建）", () => {
  it("主任务：201 返回 Task DTO，version=1，成员映射为 MemberSummary", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: createPayload() });
    const task = response.json();
    expect(task.version).toBe(1);
    expect(task.parentId).toBeNull();
    expect(task.owners).toEqual([{ id: ownerA, name: "陈晨", role: "", color: expect.any(String) }]);
    expect(task.collaborators[0]!.name).toBe("林悦");
    expect(task.subtasks).toEqual([]);
    expect(task.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("主任务可与小任务意图一次原子创建", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/admin/tasks",
      payload: createPayload({
        subtasks: {
          create: [
            { clientId: "temp-1", description: "首版小任务", ownerId: ownerA, progress: 20, importance: "high", dueDate: "2026-11-12" },
          ],
        },
      }),
    });
    expect(response.statusCode).toBe(201);
    const task = response.json();
    expect(task.version).toBe(1);
    expect(task.subtasks).toHaveLength(1);
    expect(task.subtasks[0]).toMatchObject({ description: "首版小任务", progress: 20, importance: "high", dueDate: "2026-11-12" });
    expect(task.subtasks[0].owner).toMatchObject({ id: ownerA });
  });

  it("创建小任务引用无效成员时整次创建不写入", async () => {
    const beforeCount = (await app.inject({ method: "GET", url: `/api/v1/admin/tasks?folderId=${folderId}` })).json().items.length;
    const response = await app.inject({
      method: "POST", url: "/api/v1/admin/tasks",
      payload: createPayload({
        subtasks: { create: [{ clientId: "temp-bad", description: "坏 owner", ownerId: "22222222-2222-4222-8222-222222222222" }] },
      }),
    });
    expect([400, 422]).toContain(response.statusCode);
    const after = (await app.inject({ method: "GET", url: `/api/v1/admin/tasks?folderId=${folderId}` })).json();
    expect(after.items).toHaveLength(beforeCount);
  });

  it("小任务：201 返回 { task, parent }，父聚合 version 递增", async () => {
    const main = await createMain();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tasks",
      payload: { folderId, parentId: main.id, description: "树节点拖拽交互", ownerIds: [ownerA], progress: 0, detail: "", importance: "mid", dueDate: null },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.task.parentId).toBe(main.id);
    expect(body.task.owner.id).toBe(ownerA);
    expect(body.parent.version).toBe(main.version + 1);
    expect(body.parent.subtasks.length).toBe(1);
  });

  it("小任务下再建小任务返回 422", async () => {
    const main = await createMain();
    const sub = await app.inject({
      method: "POST", url: "/api/v1/admin/tasks",
      payload: createPayload({ parentId: main.id, description: "小任务" }),
    });
    const subId = sub.json().task.id;
    const nested = await app.inject({
      method: "POST", url: "/api/v1/admin/tasks",
      payload: createPayload({ parentId: subId, description: "三层" }),
    });
    expect(nested.statusCode).toBe(422);
  });

  it("空描述/无有效 owner/归档成员引用被拒绝", async () => {
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: createPayload({ description: "  " }) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: createPayload({ ownerIds: [] }) })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: createPayload({ folderId: "11111111-1111-4111-8111-111111111111" }) })).statusCode).toBe(422);

    await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${ownerA}` });
    const archivedRef = await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: createPayload() });
    expect(archivedRef.statusCode).toBe(422);
  });

  it("progress 越界与非法重要度返回 400", async () => {
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: createPayload({ progress: 120 }) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: createPayload({ importance: "urgent" }) })).statusCode).toBe(400);
  });
});

describe("GET /admin/tasks（列表）", () => {
  it("folderId 必填；返回主任务含小任务；importance 过滤", async () => {
    await createMain();
    await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: createPayload({ description: "中重要任务", importance: "mid" }) });

    const missing = await app.inject({ method: "GET", url: "/api/v1/admin/tasks" });
    expect(missing.statusCode).toBe(400);

    const all = await app.inject({ method: "GET", url: `/api/v1/admin/tasks?folderId=${folderId}` });
    expect(all.json().items.length).toBe(2);

    const high = await app.inject({ method: "GET", url: `/api/v1/admin/tasks?folderId=${folderId}&importance=high` });
    expect(high.json().items.length).toBe(1);
    expect(high.json().items[0]!.importance).toBe("high");
  });

  it("ownerIds：主任务负责人命中保留整条任务，仅子任务负责人命中裁剪子任务", async () => {
    const mainA = await createMain();
    const subB = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tasks",
      payload: createPayload({ parentId: mainA.id, description: "由林悦负责的小任务", ownerIds: [ownerB], importance: "mid" }),
    });
    expect(subB.statusCode).toBe(201);
    const subBId = subB.json().task.id;
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/tasks",
      payload: createPayload({ description: "林悦的主任务", ownerIds: [ownerB], collaboratorIds: [], importance: "mid" }),
    });

    const byOwnerA = (
      await app.inject({ method: "GET", url: `/api/v1/admin/tasks?folderId=${folderId}&ownerIds=${ownerA}` })
    ).json();
    expect(byOwnerA.items).toHaveLength(1);
    expect(byOwnerA.items[0].id).toBe(mainA.id);
    expect(byOwnerA.items[0].subtasks).toHaveLength(1);
    expect(byOwnerA.items[0].subtasks[0].id).toBe(subBId);
    expect(byOwnerA.items[0].owners.map((owner: { id: string }) => owner.id)).toEqual([ownerA]);

    const byOwnerB = (
      await app.inject({ method: "GET", url: `/api/v1/admin/tasks?folderId=${folderId}&ownerIds=${ownerB}` })
    ).json();
    expect(byOwnerB.items).toHaveLength(2);
    const partialA = byOwnerB.items.find((task: { id: string }) => task.id === mainA.id);
    expect(partialA.subtasks).toHaveLength(1);
    expect(partialA.subtasks[0].id).toBe(subBId);
    // 主任务分配保持完整，不因裁剪子任务而丢失 owner/collaborator。
    expect(partialA.owners.map((owner: { id: string }) => owner.id)).toEqual([ownerA]);
    expect(partialA.collaborators.map((member: { id: string }) => member.id)).toEqual([ownerB]);
  });

  it("ownerIds 与 importance/q 取交集，并支持重复参数与逗号分隔", async () => {
    const mainA = await createMain();
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/tasks",
      payload: createPayload({ parentId: mainA.id, description: "由林悦负责且供搜索的小任务", ownerIds: [ownerB], importance: "mid" }),
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/tasks",
      payload: createPayload({ description: "林悦的中等任务", ownerIds: [ownerB], collaboratorIds: [], importance: "mid" }),
    });

    const combined = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/tasks?folderId=${folderId}&ownerIds=${ownerB}&importance=high&q=${encodeURIComponent("任务树")}`,
      })
    ).json();
    expect(combined.items).toHaveLength(1);
    expect(combined.items[0].id).toBe(mainA.id);
    expect(combined.items[0].subtasks).toHaveLength(1);

    const repeated = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/tasks?folderId=${folderId}&ownerIds=${ownerA}&ownerIds=${ownerB}`,
      })
    ).json();
    expect(repeated.items).toHaveLength(2);

    const comma = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/tasks?folderId=${folderId}&ownerIds=${ownerA},${ownerB}`,
      })
    ).json();
    expect(comma.items).toHaveLength(2);

    expect(
      (await app.inject({ method: "GET", url: `/api/v1/admin/tasks?folderId=${folderId}&ownerIds=not-a-uuid` })).statusCode,
    ).toBe(400);
  });

  it("ownerIds 对未知或已归档成员不命中，也不报错", async () => {
    await createMain();
    const unknown = await app.inject({
      method: "GET",
      url: `/api/v1/admin/tasks?folderId=${folderId}&ownerIds=22222222-2222-4222-8222-222222222222`,
    });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().items).toEqual([]);

    await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${ownerA}` });
    const archived = await app.inject({
      method: "GET",
      url: `/api/v1/admin/tasks?folderId=${folderId}&ownerIds=${ownerA}`,
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().items).toEqual([]);
  });

  it("搜索 q 与游标分页", async () => {
    await createMain();
    await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: createPayload({ description: "虚拟滚动优化" }) });

    const search = await app.inject({ method: "GET", url: `/api/v1/admin/tasks?folderId=${folderId}&q=${encodeURIComponent("虚拟滚动")}` });
    expect(search.json().items.length).toBe(1);
    expect(search.json().items[0]!.description).toBe("虚拟滚动优化");

    const page1 = await app.inject({ method: "GET", url: `/api/v1/admin/tasks?folderId=${folderId}` });
    expect(page1.json().nextCursor).toBeNull();
  });
});

describe("GET /admin/tasks/{id}", () => {
  it("主任务返回完整 Task；小任务返回 { task, parent }", async () => {
    const main = await createMain();
    const sub = await app.inject({
      method: "POST", url: "/api/v1/admin/tasks",
      payload: createPayload({ parentId: main.id, description: "小任务", importance: "low" }),
    });
    const subId = sub.json().task.id;

    const mainGet = await app.inject({ method: "GET", url: `/api/v1/admin/tasks/${main.id}` });
    expect(mainGet.json().description).toBe("任务树组件重构");

    const subGet = await app.inject({ method: "GET", url: `/api/v1/admin/tasks/${subId}` });
    expect(subGet.json().task.description).toBe("小任务");
    expect(subGet.json().parent.id).toBe(main.id);
  });

  it("不存在返回 404", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/v1/admin/tasks/11111111-1111-4111-8111-111111111111" });
    expect(missing.statusCode).toBe(404);
  });
});

describe("PATCH /admin/tasks/{id}", () => {
  it("主任务部分字段更新：进度变化追加 progress revision", async () => {
    const main = await createMain();
    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/admin/tasks/${main.id}`,
      payload: { version: main.version, progress: 80 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().progress).toBe(80);
    expect(patched.json().version).toBe(2);
  });

  it("小任务不接受 detail/collaboratorIds；返回 { task, parent }", async () => {
    const main = await createMain();
    const sub = await app.inject({
      method: "POST", url: "/api/v1/admin/tasks",
      payload: createPayload({ parentId: main.id, description: "小任务", importance: "low" }),
    });
    const subId = sub.json().task.id;

    const bad = await app.inject({
      method: "PATCH", url: `/api/v1/admin/tasks/${subId}`,
      payload: { version: sub.json().parent.version, detail: "不允许" },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: "PATCH", url: `/api/v1/admin/tasks/${subId}`,
      payload: { version: sub.json().parent.version, description: "改名后", progress: 60 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().task.progress).toBe(60);
  });

  it("版本过期返回 409 + 最新任务", async () => {
    const main = await createMain();
    const conflict = await app.inject({
      method: "PATCH", url: `/api/v1/admin/tasks/${main.id}`,
      payload: { version: 99, progress: 10 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("TASK_VERSION_CONFLICT");
    expect(conflict.json().error.details.current.version).toBe(1);
  });

  it("无有效变化不制造 revision（版本不变）", async () => {
    const main = await createMain();
    const same = await app.inject({
      method: "PATCH", url: `/api/v1/admin/tasks/${main.id}`,
      payload: { version: main.version, progress: 0, detail: "初始详情" },
    });
    expect(same.statusCode).toBe(200);
    expect(same.json().version).toBe(main.version);
  });
});

describe("PUT /admin/tasks/{id}/editor（原子编辑器）", () => {
  it("一次保存主任务属性 + 小任务增改删", async () => {
    const main = await createMain();
    const sub = await app.inject({
      method: "POST", url: "/api/v1/admin/tasks",
      payload: createPayload({ parentId: main.id, description: "旧小任务", importance: "low" }),
    });
    const subId = sub.json().task.id;

    const saved = await app.inject({
      method: "PUT", url: `/api/v1/admin/tasks/${main.id}/editor`,
      payload: {
        version: sub.json().parent.version,
        task: { description: "编辑后标题", ownerIds: [ownerA, ownerB], collaboratorIds: [], progress: 70, detail: "新详情", importance: "mid", dueDate: "2026-11-20" },
        subtasks: {
          create: [{ clientId: "temp-1", description: "新小任务", ownerId: ownerA, progress: 0, importance: "mid", dueDate: null }],
          update: [{ id: subId, description: "改后小任务", ownerId: ownerA, progress: 50, importance: "high", dueDate: null }],
          deleteIds: [],
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    const task = saved.json();
    expect(task.description).toBe("编辑后标题");
    expect(task.progress).toBe(70);
    expect(task.subtasks.length).toBe(2);
    expect(task.subtasks.find((s: { description: string }) => s.description === "新小任务")).toBeTruthy();
    expect(task.subtasks.find((s: { description: string }) => s.description === "改后小任务")?.progress).toBe(50);
  });

  it("不存在的小任务 ID / 归档 owner：整个聚合不写入", async () => {
    const main = await createMain();
    const before = (await app.inject({ method: "GET", url: `/api/v1/admin/tasks/${main.id}` })).json();

    const badSub = await app.inject({
      method: "PUT", url: `/api/v1/admin/tasks/${main.id}/editor`,
      payload: {
        version: before.version,
        task: { description: "x", ownerIds: [ownerA], collaboratorIds: [], progress: 0, detail: "", importance: "mid", dueDate: null },
        subtasks: { create: [], update: [{ id: "22222222-2222-4222-8222-222222222222", description: "幽灵", ownerId: ownerA, progress: 0, importance: "mid", dueDate: null }], deleteIds: [] },
      },
    });
    expect([404, 422]).toContain(badSub.statusCode);

    await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${ownerB}` });
    const badOwner = await app.inject({
      method: "PUT", url: `/api/v1/admin/tasks/${main.id}/editor`,
      payload: {
        version: before.version,
        task: { description: "x", ownerIds: [ownerB], collaboratorIds: [], progress: 0, detail: "", importance: "mid", dueDate: null },
        subtasks: { create: [], update: [], deleteIds: [] },
      },
    });
    expect(badOwner.statusCode).toBe(422);

    const after = (await app.inject({ method: "GET", url: `/api/v1/admin/tasks/${main.id}` })).json();
    expect(after).toEqual(before);
  });

  it("版本冲突 409 且携带最新任务", async () => {
    const main = await createMain();
    const conflict = await app.inject({
      method: "PUT", url: `/api/v1/admin/tasks/${main.id}/editor`,
      payload: {
        version: 42,
        task: { description: "x", ownerIds: [ownerA], collaboratorIds: [], progress: 0, detail: "", importance: "mid", dueDate: null },
        subtasks: { create: [], update: [], deleteIds: [] },
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.details.current.version).toBe(1);
  });
});

describe("DELETE /admin/tasks/{id}（软删除）", () => {
  it("主任务软删除连带小任务；历史 revision 保留", async () => {
    const main = await createMain();
    const sub = await app.inject({
      method: "POST", url: "/api/v1/admin/tasks",
      payload: createPayload({ parentId: main.id, description: "小任务", importance: "low" }),
    });

    const current = (await app.inject({ method: "GET", url: `/api/v1/admin/tasks/${main.id}` })).json();
    const removed = await app.inject({ method: "DELETE", url: `/api/v1/admin/tasks/${main.id}?version=${current.version}` });
    expect(removed.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: `/api/v1/admin/tasks?folderId=${folderId}` });
    expect(list.json().items.length).toBe(0);
    expect((await app.inject({ method: "GET", url: `/api/v1/admin/tasks/${main.id}` })).statusCode).toBe(404);

    // 历史 revision 保留（历史可查）
    const revisions: Array<{ taskVersion: number }> = [];
    await createTaskStore({ dataDir }).readRevisions(main.id, (line) => {
      revisions.push({ taskVersion: line.taskVersion });
    });
    expect(revisions.length).toBeGreaterThanOrEqual(2);
    void sub;
  });

  it("版本不匹配 409", async () => {
    const main = await createMain();
    const conflict = await app.inject({ method: "DELETE", url: `/api/v1/admin/tasks/${main.id}?version=99` });
    expect(conflict.statusCode).toBe(409);
  });

  it("两个客户端并发保存：一胜一 409，草稿可重试", async () => {
    const main = await createMain();
    const [a, b] = await Promise.allSettled([
      app.inject({ method: "PATCH", url: `/api/v1/admin/tasks/${main.id}`, payload: { version: 1, progress: 30 } }),
      app.inject({ method: "PATCH", url: `/api/v1/admin/tasks/${main.id}`, payload: { version: 1, progress: 60 } }),
    ]);
    const statuses = [a, b].map((r) => (r.status === "fulfilled" ? r.value.statusCode : 0));
    expect(statuses.filter((code) => code === 200).length).toBe(1);
    expect(statuses.filter((code) => code === 409).length).toBe(1);
  });
});
