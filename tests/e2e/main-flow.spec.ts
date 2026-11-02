// @vitest-environment node
import { mkdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { networkInterfaces as osNetworkInterfaces } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectShareInterfaces,
  restoreFromBackup,
  serve,
  validateServeConfig,
  type BackupResult,
  type ServeHandle,
} from "@ztask/server";
import type {
  AdminShareLinkState,
  DashboardChanges,
  DashboardSummary,
  ShareHomeTasks,
  ShareSessionResponse,
  ShareTaskMutation,
  ShareTrackerTasks,
  Subtask,
  Task,
} from "@ztask/shared";
import { seedShareLink } from "../member-access/support/share-fixtures.js";

/**
 * 首版端到端验收（#23 / 09 §6 的第 1–9 项；第 10 项视觉对照由冒烟报告覆盖）。
 *
 * 真实 `serve()` + 真实端口 + fetch，不 inject：
 * 1. 启动与健康；2. 管理员建夹/成员/任务/小任务；3. 开启具体 LAN IP 后成员可访问、LAN Admin 403；
 * 4. 生成/重置/吊销链接与旧会话失效；5. 成员 owner 读写、collaborator 只读、越权 404、并发冲突；
 * 6. 成员与管理员看板/历史；7. 在线备份 API；8. 重启后持久化；9. 备份恢复出的新目录可再次启动。
 *
 * LAN 部分依赖主机存在具体非回环网卡；容器化 CI 没有网卡时退化为「直接播种 share-link」，
 * 仍覆盖成员会话/读写/看板/历史/备份/重启，只是不覆盖链接生命周期端点。
 */

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newDataDir(): Promise<string> {
  const dir = path.join("/tmp", `ztask-e2e-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

interface HttpResult<T> {
  status: number;
  body: T;
  headers: Headers;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
}

/** 发一次真实 HTTP 请求并解析 JSON（空响应体按 null 处理）。 */
async function send<T>(base: string, pathname: string, options: RequestOptions = {}): Promise<HttpResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  const response = await fetch(`${base}${pathname}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { status: response.status, body: body as T, headers: response.headers };
}

/** 断言 2xx 并返回 JSON 体；失败信息带响应原文。 */
async function call<T>(base: string, pathname: string, options: RequestOptions = {}): Promise<T> {
  const response = await send<T>(base, pathname, options);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${options.method ?? "GET"} ${pathname} → ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

function errorCode(body: unknown): string {
  return (body as { error?: { code?: string } } | null)?.error?.code ?? "";
}

/** 分享 URL 的 token 只放在 `/#/s/<token>` fragment 里（05 §4.5）。 */
function tokenFromShareUrl(url: string): string {
  const marker = "/#/s/";
  const index = url.indexOf(marker);
  if (index === -1) throw new Error(`unexpected share url: ${url}`);
  return url.slice(index + marker.length);
}

/** 用 token 走真实 POST /share/session 换 Cookie。 */
async function exchangeToken(base: string, token: string): Promise<string> {
  const response = await send<ShareSessionResponse>(base, "/api/v1/share/session", {
    method: "POST",
    body: { token },
  });
  expect(response.status).toBe(201);
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("missing set-cookie on token exchange");
  return setCookie.split(";")[0]!;
}

/** 在具体 LAN 地址上找一个空闲端口（bind 成功后立即释放）。 */
async function findFreePort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** 重启后用运行中的 LAN 入口（若恢复成功），否则退回 loopback。 */
function activeShareBase(handle: ServeHandle, loopback: string): string {
  const listener = handle.networkService.state().shareListener;
  return listener.running && listener.shareBaseUrl !== null ? listener.shareBaseUrl : loopback;
}

describe("首版主流程（真实端口 + fetch）", () => {
  it("管理端维护 → 成员读写 → 看板/历史 → 备份 → 重启持久化 → 备份恢复", async () => {
    const dataDir = await newDataDir();
    await mkdir(dataDir, { recursive: true });

    let handle: ServeHandle | null = await serve(validateServeConfig({ port: 0, dataDir }), { version: "0.1.0" });
    let base = `http://127.0.0.1:${handle.port}`;
    try {
      // ---- 1. 启动与健康 ----
      const health = await send<{ status: string; version: string; uptimeSeconds: number }>(base, "/api/v1/health");
      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({ status: "ok", version: "0.1.0" });
      expect(health.body.uptimeSeconds).toBeGreaterThanOrEqual(0);

      // ---- 2. 管理员建夹/成员/主任务/一层小任务 ----
      const rootFolder = await call<{ id: string }>(base, "/api/v1/admin/folders", {
        method: "POST",
        body: { name: "首页改版", parentId: null },
      });
      const childFolder = await call<{ id: string }>(base, "/api/v1/admin/folders", {
        method: "POST",
        body: { name: "视觉", parentId: rootFolder.id },
      });
      const memberA = await call<{ id: string }>(base, "/api/v1/admin/members", {
        method: "POST",
        body: { name: "陈晨", role: "设计" },
      });
      const memberB = await call<{ id: string }>(base, "/api/v1/admin/members", {
        method: "POST",
        body: { name: "林悦", role: "开发" },
      });
      // 只被分配小任务的成员：个人页两组都不出现，只出现在只读事项跟踪（05 §6.4）。
      const memberC = await call<{ id: string }>(base, "/api/v1/admin/members", {
        method: "POST",
        body: { name: "赵敏", role: "测试" },
      });

      const task = await call<Task>(base, "/api/v1/admin/tasks", {
        method: "POST",
        body: {
          folderId: rootFolder.id,
          parentId: null,
          description: "首页改版",
          ownerIds: [memberA.id],
          collaboratorIds: [memberB.id],
          progress: 20,
          detail: "第一版详情",
          importance: "high",
          dueDate: "2026-12-31",
        },
      });
      expect(task).toMatchObject({ description: "首页改版", progress: 20, version: 1, parentId: null });

      const subtaskCreated = await call<{ task: Subtask; parent: Task }>(base, "/api/v1/admin/tasks", {
        method: "POST",
        body: {
          folderId: rootFolder.id,
          parentId: task.id,
          description: "整理视觉稿",
          ownerIds: [memberB.id],
          progress: 0,
          importance: "mid",
          dueDate: null,
        },
      });
      expect(subtaskCreated.task.parentId).toBe(task.id);
      expect(subtaskCreated.parent.version).toBe(2);
      expect(subtaskCreated.parent.subtasks.map((entry) => entry.description)).toEqual(["整理视觉稿"]);
      // C 只被分配小任务（作为只读跟踪的可见性用例）。
      const subtaskC = await call<{ task: Subtask; parent: Task }>(base, "/api/v1/admin/tasks", {
        method: "POST",
        body: {
          folderId: rootFolder.id,
          parentId: task.id,
          description: "验证 C 的可见性",
          ownerIds: [memberC.id],
          progress: 0,
          importance: "low",
          dueDate: null,
        },
      });
      let version = subtaskC.parent.version;

      // B 独占任务：A 在任何接口都不应看到它。
      const privateTask = await call<Task>(base, "/api/v1/admin/tasks", {
        method: "POST",
        body: {
          folderId: childFolder.id,
          parentId: null,
          description: "B 独占任务",
          ownerIds: [memberB.id],
          collaboratorIds: [],
          progress: 0,
          detail: "私密详情",
          importance: "low",
          dueDate: null,
        },
      });

      // 任务夹树（管理员）包含两层。
      const tree = await call<{ tree: Array<{ id: string; children: Array<{ id: string }> }> }>(
        base,
        "/api/v1/admin/folders/tree",
      );
      expect(tree.tree.map((node) => node.id)).toContain(rootFolder.id);
      expect(tree.tree.find((node) => node.id === rootFolder.id)?.children.map((node) => node.id)).toContain(
        childFolder.id,
      );

      // ---- 3. 开启具体 LAN IP：成员可访问，Admin 仍被拒绝 ----
      const lanInterface = collectShareInterfaces(osNetworkInterfaces())[0] ?? null;
      let lanEnabled = false;
      let shareBase = base;
      if (lanInterface !== null) {
        const lanPort = await findFreePort(lanInterface.address);
        const state = await call<{ shareListener: { running: boolean; shareBaseUrl: string | null } }>(
          base,
          "/api/v1/admin/network/share-listener",
          { method: "PUT", body: { host: lanInterface.address, port: lanPort } },
        );
        expect(state.shareListener.running).toBe(true);
        expect(state.shareListener.shareBaseUrl).toBe(`http://${lanInterface.address}:${lanPort}`);
        shareBase = state.shareListener.shareBaseUrl!;
        lanEnabled = true;

        const lanHealth = await send<{ status: string }>(shareBase, "/api/v1/health");
        expect(lanHealth.status).toBe(200);
        const lanAdmin = await send<unknown>(shareBase, "/api/v1/admin/folders/tree");
        expect(lanAdmin.status).toBe(403);
        expect(errorCode(lanAdmin.body)).toBe("ADMIN_LOCAL_ONLY");
      } else {
        // 无具体网卡：直接播种链接，仍覆盖成员会话与读写链路。
        process.stderr.write("[e2e] 未发现具体局域网网卡，跳过链接生命周期端点断言\n");
      }

      // ---- 4. 生成链接（有 LAN 时走真实管理端点）----
      async function issueLink(memberId: string): Promise<string> {
        if (lanEnabled) {
          const issued = await call<{ url: string }>(base, `/api/v1/admin/members/${memberId}/share-link`, {
            method: "POST",
          });
          return tokenFromShareUrl(issued.url);
        }
        const seeded = await seedShareLink({ dataDir, memberId });
        return seeded.token;
      }

      const tokenA = await issueLink(memberA.id);
      const tokenB = await issueLink(memberB.id);
      if (lanEnabled) {
        // 脱敏状态：不回传 URL，只给状态与时间。
        const linkState = await call<AdminShareLinkState & { url?: string }>(
          base,
          `/api/v1/admin/members/${memberA.id}/share-link`,
        );
        expect(linkState.status).toBe("active");
        expect(linkState.url).toBeUndefined();
      }

      let cookieA = await exchangeToken(shareBase, tokenA);
      const cookieB = await exchangeToken(shareBase, tokenB);

      // 新会话可读自己的身份。
      const sessionA = await call<ShareSessionResponse>(shareBase, "/api/v1/share/session", { cookie: cookieA });
      expect(sessionA.member).toMatchObject({ id: memberA.id, name: "陈晨" });

      // ---- 5. 成员可见性与权限 ----
      const homeA = await call<ShareHomeTasks>(shareBase, "/api/v1/share/tasks?view=home", { cookie: cookieA });
      expect(homeA.owned.map((entry) => entry.id)).toEqual([task.id]);
      expect(homeA.collaborated).toEqual([]);

      const homeB = await call<ShareHomeTasks>(shareBase, "/api/v1/share/tasks?view=home", { cookie: cookieB });
      expect(homeB.collaborated.map((entry) => entry.id)).toEqual([task.id]);
      expect(homeB.owned.map((entry) => entry.id)).toEqual([privateTask.id]);

      // C 只被分配小任务：个人页两组都为空，但只读事项跟踪能看到父任务。
      const cookieC = await exchangeToken(shareBase, await issueLink(memberC.id));
      const homeC = await call<ShareHomeTasks>(shareBase, "/api/v1/share/tasks?view=home", { cookie: cookieC });
      expect(homeC.owned).toEqual([]);
      expect(homeC.collaborated).toEqual([]);
      const trackerC = await call<ShareTrackerTasks>(shareBase, "/api/v1/share/tasks?view=tracker", {
        cookie: cookieC,
      });
      expect(trackerC.items.map((entry) => entry.id)).toEqual([task.id]);

      const trackerA = await call<ShareTrackerTasks>(shareBase, "/api/v1/share/tasks?view=tracker", {
        cookie: cookieA,
      });
      expect(trackerA.items.map((entry) => entry.id)).toEqual([task.id]);
      const trackerB = await call<ShareTrackerTasks>(shareBase, "/api/v1/share/tasks?view=tracker", {
        cookie: cookieB,
      });
      expect(new Set(trackerB.items.map((entry) => entry.id))).toEqual(new Set([task.id, privateTask.id]));

      // A 深链 B 的独占任务 → 404，不泄露存在性。
      const forbidden = await send<unknown>(shareBase, `/api/v1/share/tasks/${privateTask.id}`, {
        cookie: cookieA,
      });
      expect(forbidden.status).toBe(404);
      expect(errorCode(forbidden.body)).toBe("TASK_NOT_FOUND");

      // collaborator 只读：写进度 403（只有 owner 能改，05 §6.6）。
      const readOnly = await send<unknown>(shareBase, `/api/v1/share/tasks/${task.id}/progress`, {
        method: "PATCH",
        cookie: cookieB,
        body: { progress: 30, version },
      });
      expect(readOnly.status).toBe(403);
      expect(errorCode(readOnly.body)).toBe("OWNER_REQUIRED");

      // owner A 保存进度与完整详情。
      const progressSaved = await call<ShareTaskMutation>(shareBase, `/api/v1/share/tasks/${task.id}/progress`, {
        method: "PATCH",
        cookie: cookieA,
        body: { progress: 60, version },
      });
      expect(progressSaved.task.progress).toBe(60);
      expect(progressSaved.revision).not.toBeNull();
      version = progressSaved.task.version;

      const detailSaved = await call<ShareTaskMutation>(shareBase, `/api/v1/share/tasks/${task.id}/detail`, {
        method: "PATCH",
        cookie: cookieA,
        body: { detail: "成员改后的完整详情\n第二行", version },
      });
      expect(detailSaved.task.detail).toContain("成员改后的完整详情");
      version = detailSaved.task.version;

      // 过期 version → 409 并带回最新可见任务。
      const conflict = await send<{ error: { code: string; details?: { current?: Task } } }>(
        shareBase,
        `/api/v1/share/tasks/${task.id}/progress`,
        { method: "PATCH", cookie: cookieA, body: { progress: 1, version: 1 } },
      );
      expect(conflict.status).toBe(409);
      expect(errorCode(conflict.body)).toBe("TASK_VERSION_CONFLICT");
      expect(conflict.body.error.details?.current).toMatchObject({ id: task.id, progress: 60 });

      // owner 创建并更新小任务。
      const subtaskByA = await call<ShareTaskMutation>(shareBase, `/api/v1/share/tasks/${task.id}/subtasks`, {
        method: "POST",
        cookie: cookieA,
        body: { version, description: "成员新增小任务", progress: 0, importance: "low", dueDate: null },
      });
      const createdSubtask = subtaskByA.task.subtasks.find((entry) => entry.description === "成员新增小任务");
      expect(createdSubtask).toBeDefined();
      version = subtaskByA.task.version;
      const subtaskUpdated = await call<ShareTaskMutation>(
        shareBase,
        `/api/v1/share/tasks/${task.id}/subtasks/${createdSubtask!.id}`,
        { method: "PATCH", cookie: cookieA, body: { version, progress: 50 } },
      );
      expect(subtaskUpdated.task.subtasks.find((entry) => entry.id === createdSubtask!.id)?.progress).toBe(50);
      version = subtaskUpdated.task.version;

      // 成员只读事项跟踪：tracker 可读，但成员不能改任务夹/成员。
      // 只有在真实 LAN 入口上才能证明「成员访问 Admin 被拒」；loopback 回退分支上本机就是管理员。
      if (lanEnabled) {
        const memberAdminProbe = await send<unknown>(shareBase, "/api/v1/admin/members");
        expect(memberAdminProbe.status).toBe(403);
      }

      // ---- 6. 看板与历史（管理员 + 成员裁剪）----
      const adminSummary = await call<DashboardSummary>(
        base,
        `/api/v1/admin/dashboard/summary?folderId=${rootFolder.id}`,
      );
      // rootFolder 范围包含后代 childFolder：主任务 60 归 gt50，B 独占任务 0 归 lt50。
      expect(adminSummary.buckets.gt50.total).toBe(1);
      expect(adminSummary.buckets.lt50.total).toBe(1);
      expect(adminSummary.buckets.done.total).toBe(0);

      const memberSummary = await call<DashboardSummary>(
        shareBase,
        `/api/v1/share/dashboard/summary?folderId=${rootFolder.id}`,
        { cookie: cookieA },
      );
      expect(memberSummary.buckets.gt50.total).toBe(1);
      expect(memberSummary.buckets.lt50.total).toBe(0);

      const dueDistribution = await call<{ buckets: Array<{ key: string; total: number }> }>(
        base,
        `/api/v1/admin/dashboard/due-distribution?folderId=${rootFolder.id}&bucket=gt50`,
      );
      expect(dueDistribution.buckets.map((bucket) => bucket.key)).toEqual([
        "overdue",
        "week",
        "month",
        "later",
        "unscheduled",
      ]);

      const adminChanges = await call<DashboardChanges>(
        base,
        `/api/v1/admin/dashboard/changes?folderId=${rootFolder.id}&mode=default`,
      );
      expect(adminChanges.timeZone).toBeTruthy();
      expect(new Set(adminChanges.items.map((entry) => entry.taskId))).toEqual(new Set([task.id, privateTask.id]));
      expect(adminChanges.items.every((entry) => entry.before === null)).toBe(true);
      expect(adminChanges.items.every((entry) => entry.changeKind === "created")).toBe(true);

      const memberChanges = await call<DashboardChanges>(
        shareBase,
        `/api/v1/share/dashboard/changes?folderId=${rootFolder.id}&mode=default`,
        { cookie: cookieA },
      );
      // A 只看到自己相关任务的变更，B 的独占任务不出现。
      expect(new Set(memberChanges.items.map((entry) => entry.taskId))).toEqual(new Set([task.id]));

      // 成员请求管理端看板：Admin 守卫在 LAN 入口直接 403（成员没有管理权限）。
      if (lanEnabled) {
        const memberAdminDashboard = await send<unknown>(
          shareBase,
          `/api/v1/admin/dashboard/changes?folderId=${rootFolder.id}&mode=default`,
          { cookie: cookieB },
        );
        expect(memberAdminDashboard.status).toBe(403);
      }

      // ---- 7. 链接重置与吊销：旧会话立即失效 ----
      let currentCookieA = cookieA;
      if (lanEnabled) {
        const rotated = await call<{ url: string }>(base, `/api/v1/admin/members/${memberA.id}/share-link/rotate`, {
          method: "POST",
        });
        const staleA = await send<unknown>(shareBase, "/api/v1/share/session", { cookie: cookieA });
        expect(staleA.status).toBe(401);
        currentCookieA = await exchangeToken(shareBase, tokenFromShareUrl(rotated.url));
        expect(
          (await call<ShareSessionResponse>(shareBase, "/api/v1/share/session", { cookie: currentCookieA })).member.id,
        ).toBe(memberA.id);

        const revoked = await send<unknown>(base, `/api/v1/admin/members/${memberB.id}/share-link`, {
          method: "DELETE",
        });
        expect(revoked.status).toBe(204);
        const staleB = await send<unknown>(shareBase, "/api/v1/share/session", { cookie: cookieB });
        expect(staleB.status).toBe(401);
      }

      // ---- 8. 在线备份 API ----
      const backup = await call<BackupResult>(base, "/api/v1/admin/maintenance/backup", { method: "POST" });
      expect(backup.report.validation.ok).toBe(true);
      // 备份后再写一次：用于验证恢复回滚到备份时间点，而不是「恢复=当前」。
      const afterBackupTask = await call<Task>(base, `/api/v1/admin/tasks/${task.id}`);
      const afterBackupWrite = await call<Task>(base, `/api/v1/admin/tasks/${task.id}`, {
        method: "PATCH",
        body: { version: afterBackupTask.version, progress: 80, detail: "备份之后的写入" },
      });
      expect(afterBackupWrite.progress).toBe(80);
      expect(backup.report.appVersion).toBe("0.1.0");
      expect(backup.report.dataDir).toBe(dataDir);
      await expect(stat(path.join(backup.backupDir, "backup.json"))).resolves.toBeTruthy();

      // ---- 9. 重启后持久化（同一数据目录）----
      await handle.close();
      handle = null;
      handle = await serve(validateServeConfig({ port: 0, dataDir }), { version: "0.1.0" });
      base = `http://127.0.0.1:${handle.port}`;
      const restartedShareBase = activeShareBase(handle, base);

      const afterRestart = await call<{ items: Task[] }>(base, `/api/v1/admin/tasks?folderId=${rootFolder.id}`);
      const restoredTask = afterRestart.items.find((entry) => entry.id === task.id);
      expect(restoredTask).toBeDefined();
      expect(restoredTask!.progress).toBe(80);
      expect(restoredTask!.detail).toContain("备份之后的写入");
      expect(afterRestart.items.find((entry) => entry.id === privateTask.id)).toBeDefined();

      // 成员会话与链接在重启后仍有效（session 文件持久化）。
      const sessionAfterRestart = await call<ShareSessionResponse>(
        restartedShareBase,
        "/api/v1/share/session",
        { cookie: currentCookieA },
      );
      expect(sessionAfterRestart.member.id).toBe(memberA.id);
      const homeAfterRestart = await call<ShareHomeTasks>(
        restartedShareBase,
        "/api/v1/share/tasks?view=home",
        { cookie: currentCookieA },
      );
      expect(homeAfterRestart.owned.map((entry) => entry.id)).toEqual([task.id]);

      // ---- 10. 备份恢复到新目录后可独立启动（09 §6 第 9 项）----
      const restoredDir = path.join(dataDir, "restored-e2e");
      const summary = await restoreFromBackup({
        backupDir: backup.backupDir,
        targetDir: restoredDir,
        applicationVersion: "0.1.0",
      });
      expect(summary).toMatchObject({ tasks: 2, folders: 2, members: 3 });
      const restoredHandle = await serve(validateServeConfig({ port: 0, dataDir: restoredDir }), {
        version: "0.1.0",
      });
      try {
        const restoredBase = `http://127.0.0.1:${restoredHandle.port}`;
        const restoredList = await call<{ items: Task[] }>(
          restoredBase,
          `/api/v1/admin/tasks?folderId=${rootFolder.id}`,
        );
        // 恢复目录回到备份时间点（60），备份后的 80 不应出现。
        expect(restoredList.items.find((entry) => entry.id === task.id)?.progress).toBe(60);
        expect(restoredList.items.map((entry) => entry.id)).toContain(privateTask.id);
      } finally {
        await restoredHandle.close();
      }
    } finally {
      if (handle !== null) await handle.close();
    }
  });
});
