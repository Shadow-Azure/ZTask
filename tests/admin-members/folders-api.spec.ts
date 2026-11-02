// @vitest-environment node
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, initStore } from "@ztask/server";
import type { FastifyInstance } from "fastify";

let dataDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dataDir = path.join("/tmp", `ztask-folders-api-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe("POST /admin/folders", () => {
  it("根夹创建：201 返回 Folder，position 从 0 递增", async () => {
    const first = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "2026 Q4 迭代", parentId: null } });
    expect(first.statusCode).toBe(201);
    const folder = first.json();
    expect(folder.name).toBe("2026 Q4 迭代");
    expect(folder.parentId).toBeNull();
    expect(folder.position).toBe(0);

    const second = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "数据平台", parentId: null } });
    expect(second.json().position).toBe(1);
  });

  it("子夹创建：父夹必须存在，否则 422", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/admin/folders",
      payload: { name: "孤儿", parentId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(missing.statusCode).toBe(422);
  });

  it("空/纯空白名称返回 400", async () => {
    const blank = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "   ", parentId: null } });
    expect(blank.statusCode).toBe(400);
  });

  it("非法 parentId 格式返回 400", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "x", parentId: "../evil" } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("GET /admin/folders/tree", () => {
  it("按 position 排序的嵌套树；无任务时 counts 为 0/0", async () => {
    const parent = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "客户增量构", parentId: null } });
    const parentId = parent.json().id;
    await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "数据平台", parentId } });

    const tree = await app.inject({ method: "GET", url: "/api/v1/admin/folders/tree" });
    expect(tree.statusCode).toBe(200);
    const nodes = tree.json().tree as Array<{ id: string; name: string; children: Array<{ name: string }>; counts: { done: number; todo: number }; tasks: unknown[] }>;
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.name).toBe("客户增量构");
    expect(nodes[0]!.children.map((c) => c.name)).toEqual(["数据平台"]);
    expect(nodes[0]!.counts).toEqual({ done: 0, todo: 0 });
    expect(nodes[0]!.tasks).toEqual([]);
  });

  it("重命名后树内名称更新", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "旧名", parentId: null } });
    const id = created.json().id;
    const renamed = await app.inject({ method: "PATCH", url: `/api/v1/admin/folders/${id}`, payload: { name: "新名" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("新名");

    const tree = await app.inject({ method: "GET", url: "/api/v1/admin/folders/tree" });
    expect(tree.json().tree[0]!.name).toBe("新名");
  });

  it("重命名不存在的夹返回 404；空白名返回 400", async () => {
    const missing = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/folders/11111111-1111-4111-8111-111111111111",
      payload: { name: "x" },
    });
    expect(missing.statusCode).toBe(404);
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "y", parentId: null } });
    const blank = await app.inject({ method: "PATCH", url: `/api/v1/admin/folders/${created.json().id}`, payload: { name: "" } });
    expect(blank.statusCode).toBe(400);
  });
});

describe("文件夹删除约束（05 §3.3 / 06 §4.2：首版不开放删除）", () => {
  it("DELETE 返回 405（方法未开放）", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "z", parentId: null } });
    const removed = await app.inject({ method: "DELETE", url: `/api/v1/admin/folders/${created.json().id}` });
    expect([404, 405]).toContain(removed.statusCode);
  });
});
