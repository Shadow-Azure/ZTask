// @vitest-environment node
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildApp,
  describeInternalError,
  describeValidationError,
  initStore,
  StorageCorruptionError,
  type ZtaskStore,
} from "@ztask/server";
import type { FastifyInstance } from "fastify";

let dataDir: string;
let app: FastifyInstance;
let store: ZtaskStore;
let folderId: string;
let ownerId: string;
let mainId: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `ztask-error-report-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  store = await initStore({ dataDir, applicationVersion: "0.1.0" });
  app = await buildApp({ host: "127.0.0.1", port: 0, dataDir, staticRoot: null }, { store });
  folderId = (await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "迭代", parentId: null } })).json().id;
  ownerId = (await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name: "陈晨" } })).json().id;
  mainId = (await app.inject({
    method: "POST",
    url: "/api/v1/admin/tasks",
    payload: {
      folderId,
      parentId: null,
      description: "任务树组件重构",
      ownerIds: [ownerId],
      collaboratorIds: [],
      progress: 0,
      detail: "",
      importance: "mid",
      dueDate: null,
    },
  })).json().id;
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
  await rm(dataDir, { recursive: true, force: true });
});

/** 构造合法的编辑意图，再按需覆盖 subtasks 字段。 */
function editorPayload(version: number, subtasks: unknown): Record<string, unknown> {
  return {
    version,
    task: {
      description: "任务树组件重构（已编辑）",
      ownerIds: [ownerId],
      collaboratorIds: [],
      progress: 10,
      detail: "",
      importance: "mid",
      dueDate: null,
    },
    subtasks,
  };
}

async function currentVersion(): Promise<number> {
  return (await app.inject({ method: "GET", url: `/api/v1/admin/tasks/${mainId}` })).json().version;
}

describe("小任务保存载荷校验（不产生 500）", () => {
  it.each([
    ["subtasks 为数组", []],
    ["subtasks.create 为对象", { create: {}, update: [], deleteIds: [] }],
    ["subtasks.update 为字符串", { create: [], update: "x", deleteIds: [] }],
    ["subtasks.deleteIds 为数字", { create: [], update: [], deleteIds: 0 }],
    ["subtasks.create 含 null 条目", { create: [null], update: [], deleteIds: [] }],
    ["subtasks.update 含 null 条目", { create: [], update: [null], deleteIds: [] }],
    ["subtasks.deleteIds 含 null 条目", { create: [], update: [], deleteIds: [null] }],
  ])("%s：返回 400 可读提示且不写盘", async (_label, subtasks) => {
    const version = await currentVersion();
    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/tasks/${mainId}/editor`,
      payload: editorPayload(version, subtasks),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).toMatch(/小任务|subtasks/);
    expect(response.body).not.toContain("内部错误");
    expect(await currentVersion()).toBe(version);
  });

  it("创建主任务时非法小任务草稿同样返回 400，而不是 TypeError 500", async () => {
    const base = {
      folderId,
      parentId: null,
      description: "新建任务",
      ownerIds: [ownerId],
      collaboratorIds: [],
      progress: 0,
      detail: "",
      importance: "mid",
      dueDate: null,
    };
    const wrongList = await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: { ...base, subtasks: { create: {} } } });
    expect(wrongList.statusCode).toBe(400);
    expect(wrongList.json().error.message).toContain("subtasks.create 须为列表");

    const nullEntry = await app.inject({ method: "POST", url: "/api/v1/admin/tasks", payload: { ...base, subtasks: { create: [null] } } });
    expect(nullEntry.statusCode).toBe(400);
    expect(nullEntry.json().error.message).toContain("第 1 项须为对象");

    const missingOwner = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tasks",
      payload: { ...base, subtasks: { create: [{ description: "没有负责人", ownerId: "" }] } },
    });
    expect(missingOwner.statusCode).toBe(400);
    expect(missingOwner.json().error.message).toBe("小任务「没有负责人」缺少有效负责人，请选择负责人");
  });
});

describe("未预期异常的用户提示与日志", () => {
  async function appWithFailingCommit(error: Error): Promise<FastifyInstance> {
    const failing: ZtaskStore = {
      ...store,
      tasks: {
        ...store.tasks,
        commit: async () => {
          throw error;
        },
      },
    };
    return await buildApp({ host: "127.0.0.1", port: 0, dataDir, staticRoot: null }, { store: failing });
  }

  it("存储损坏：返回具体原因与请求编号，不出现裸“内部错误”，并在日志中记录请求编号", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingApp = await appWithFailingCommit(new StorageCorruptionError("JSONL 第 1 行损坏：/Users/private/data"));
    try {
      const response = await failingApp.inject({
        method: "PUT",
        url: `/api/v1/admin/tasks/${mainId}/editor`,
        payload: editorPayload(await currentVersion(), { create: [], update: [], deleteIds: [] }),
      });
      expect(response.statusCode, response.body).toBe(500);
      const body = response.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).toContain("保存失败");
      expect(body.error.message).toContain("数据文件校验不通过");
      expect(body.error.message).toContain(`请求编号：${body.error.requestId}`);
      expect(body.error.message).not.toContain("/Users/private");
      expect(body.error.details.cause).toBe("STORAGE_CORRUPTION");
      expect(body.error.message).not.toBe("内部错误");
      expect(log).toHaveBeenCalledWith(expect.stringContaining(body.error.requestId), expect.any(String));
    } finally {
      await failingApp.close();
    }
  });

  it("目录不可写：返回权限与磁盘提示，而不是笼统内部错误", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const eacces = Object.assign(new Error("EACCES: permission denied, open '/private/data'"), { code: "EACCES" });
    const failingApp = await appWithFailingCommit(eacces);
    try {
      const response = await failingApp.inject({
        method: "PUT",
        url: `/api/v1/admin/tasks/${mainId}/editor`,
        payload: editorPayload(await currentVersion(), { create: [], update: [], deleteIds: [] }),
      });
      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error.message).toContain("数据目录不可写");
      expect(body.error.message).toContain("EACCES");
      expect(body.error.details.cause).toBe("EACCES");
    } finally {
      await failingApp.close();
    }
  });
});

describe("错误说明工具", () => {
  it("把 AJV 英文消息翻译成字段级中文提示", () => {
    expect(
      describeValidationError({ message: "body/progress must be integer", validation: [{ instancePath: "/progress" }] } as never),
    ).toBe("小任务进度必须是 0–100 的整数。");
    expect(
      describeValidationError({ message: "must have required property 'version'", validation: [] } as never),
    ).toContain("版本");
    expect(describeValidationError({ message: "body/x must NOT have additional properties", validation: [] } as never)).toContain(
      "不支持的字段",
    );
  });

  it("内部错误说明不含数据目录路径", () => {
    const described = describeInternalError(new StorageCorruptionError("损坏：/Users/private/data/tasks/x"), "req-9");
    expect(described.message).toContain("请求编号：req-9");
    expect(described.message).not.toContain("/Users/private");
    expect(described.cause).toBe("STORAGE_CORRUPTION");
  });
});
