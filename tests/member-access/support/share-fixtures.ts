import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Importance } from "@ztask/shared";
import { buildApp, initStore, writeJsonAtomic } from "@ztask/server";

/**
 * 成员分享域测试夹具（06 §4.3 / §5）。
 *
 * 生产代码不再暴露 mint 能力（分享链接管理属 #20），因此测试直接原子写
 * `share-links/<memberId>.json` 造 active 链接，并用 `POST /share/session` 换 Cookie。
 */

/** share-links/<memberId>.json 的测试种子形态，与 share-auth.ts 的 ShareLinkFile 对齐。 */
export interface ShareLinkSeed {
  formatVersion: number;
  id: string;
  memberId: string;
  tokenHash: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** auth-sessions/<sessionId>.json 的测试读取形态，与 share-auth.ts 的 SessionFile 对齐。 */
export interface SessionSeed {
  formatVersion: number;
  sessionId: string;
  memberId: string;
  shareLinkId: string;
  verifierHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

/** 与生产一致的 token 摘要（sha256 hex）。 */
export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 与生产同熵的分享 token（32 字节 Base64URL）。 */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 每个用例独立的临时数据目录。 */
export function tmpDataDir(): string {
  return path.join("/tmp", `ztask-member-access-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/**
 * 启动带 store 的测试 app（与管理端共享同一装配）。
 * @param dataDir 临时数据目录。
 * @param options timeZone 仅在 manifest 首建时生效（#21 看板时区用例）；
 *   clock 同时注入 TaskStore（revision recordedAt）与看板/历史服务（now）。
 * @returns 未监听的 Fastify 实例。
 */
export async function createMemberAccessApp(
  dataDir: string,
  options: { timeZone?: string; clock?: () => Date } = {},
): Promise<FastifyInstance> {
  await mkdir(dataDir, { recursive: true });
  const store = await initStore({
    dataDir,
    applicationVersion: "0.1.0",
    ...(options.timeZone !== undefined ? { timeZone: options.timeZone } : {}),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
  });
  return await buildApp(
    { host: "127.0.0.1", port: 0, dataDir, staticRoot: null },
    { store, ...(options.clock !== undefined ? { clock: options.clock } : {}) },
  );
}

/**
 * 直接原子写 active share-link（06 §4.3）；生产侧铸造属 #20。
 * @param options 装配项。
 * @param options.dataDir 数据目录。
 * @param options.memberId 目标成员。
 * @param options.token 期望 token；缺省生成新 token。
 * @param options.clock 可注入时钟。
 * @param options.lastUsedAt 覆盖 lastUsedAt（节流测试用）。
 * @returns raw token 与落盘实体。
 */
export async function seedShareLink(options: {
  dataDir: string;
  memberId: string;
  token?: string;
  clock?: () => Date;
  lastUsedAt?: string | null;
}): Promise<{ token: string; link: ShareLinkSeed }> {
  const token = options.token ?? newToken();
  const now = (options.clock ?? (() => new Date()))().toISOString();
  const link: ShareLinkSeed = {
    formatVersion: 1,
    id: randomUUID(),
    memberId: options.memberId,
    tokenHash: sha256(token),
    status: "active",
    createdAt: now,
    revokedAt: null,
    lastUsedAt: options.lastUsedAt ?? null,
  };
  await writeJsonAtomic(path.join(options.dataDir, "share-links", `${options.memberId}.json`), link);
  return { token, link };
}

/** 读取 share-link 当前落盘内容。 */
export async function readShareLink(dataDir: string, memberId: string): Promise<ShareLinkSeed> {
  return JSON.parse(await readFile(path.join(dataDir, "share-links", `${memberId}.json`), "utf8")) as ShareLinkSeed;
}

/** 读取会话文件当前落盘内容。 */
export async function readSessionFile(dataDir: string, sessionId: string): Promise<SessionSeed> {
  return JSON.parse(await readFile(path.join(dataDir, "auth-sessions", `${sessionId}.json`), "utf8")) as SessionSeed;
}

/** 原地改写会话文件（过期/心跳测试用，走原子写保持与生产一致）。 */
export async function updateSessionFile(dataDir: string, sessionId: string, patch: Partial<SessionSeed>): Promise<void> {
  const current = await readSessionFile(dataDir, sessionId);
  await writeJsonAtomic(path.join(dataDir, "auth-sessions", `${sessionId}.json`), { ...current, ...patch });
}

/** 从 Cookie 头值中取出 sessionId（`ztask_share_session=<sessionId>.<verifier>`）。 */
export function sessionIdOf(cookie: string): string {
  const value = cookie.split(";")[0]!.trim();
  const pair = value.startsWith("ztask_share_session=") ? value.slice("ztask_share_session=".length) : value;
  const sessionId = pair.split(".")[0];
  if (!sessionId) throw new Error(`invalid share cookie: ${cookie}`);
  return sessionId;
}

/**
 * 用 token 走 POST /share/session 换 Cookie（只保留 name=value 部分）。
 * @param app 测试实例。
 * @param token 分享 token。
 * @param remoteAddress 可选客户端地址（限流用例）。
 * @returns 可直接放进 headers.cookie 的会话 Cookie。
 */
export async function exchangeCookie(app: FastifyInstance, token: string, remoteAddress?: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/share/session",
    payload: { token },
    ...(remoteAddress ? { remoteAddress } : {}),
  });
  if (response.statusCode !== 201) {
    throw new Error(`token exchange failed: ${response.statusCode} ${response.body}`);
  }
  const header = response.headers["set-cookie"];
  const setCookie = Array.isArray(header) ? header[0] : header;
  if (!setCookie) throw new Error("missing Set-Cookie on token exchange");
  return setCookie.split(";")[0]!;
}

/** 管理端：创建任务夹。 */
export async function createFolder(app: FastifyInstance, name: string, parentId: string | null = null): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name, parentId } });
  if (response.statusCode !== 201) throw new Error(`createFolder failed: ${response.statusCode} ${response.body}`);
  return response.json().id as string;
}

/** 管理端：创建成员。 */
export async function createMember(app: FastifyInstance, name: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name } });
  if (response.statusCode !== 201) throw new Error(`createMember failed: ${response.statusCode} ${response.body}`);
  return response.json().id as string;
}

/** 管理端：创建主任务，返回 id 与 version。 */
export async function createTask(
  app: FastifyInstance,
  input: {
    folderId: string;
    description: string;
    ownerIds: string[];
    collaboratorIds?: string[];
    progress?: number;
    importance?: Importance;
    dueDate?: string | null;
  },
): Promise<{ id: string; version: number }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/admin/tasks",
    payload: {
      folderId: input.folderId,
      parentId: null,
      description: input.description,
      ownerIds: input.ownerIds,
      collaboratorIds: input.collaboratorIds ?? [],
      progress: input.progress ?? 0,
      detail: `${input.description}详情`,
      importance: input.importance ?? "mid",
      dueDate: input.dueDate ?? null,
    },
  });
  if (response.statusCode !== 201) throw new Error(`createTask failed: ${response.statusCode} ${response.body}`);
  const body = response.json() as { id: string; version: number };
  return { id: body.id, version: body.version };
}

/** 管理端：创建小任务，返回小任务 id 与父任务最新 version。 */
export async function createSubtask(
  app: FastifyInstance,
  input: { folderId: string; parentId: string; description: string; ownerId: string; progress?: number },
): Promise<{ id: string; parentVersion: number }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/admin/tasks",
    payload: {
      folderId: input.folderId,
      parentId: input.parentId,
      description: input.description,
      ownerIds: [input.ownerId],
      progress: input.progress ?? 0,
      detail: `${input.description}详情`,
      importance: "mid",
      dueDate: null,
    },
  });
  if (response.statusCode !== 201) throw new Error(`createSubtask failed: ${response.statusCode} ${response.body}`);
  const body = response.json() as { task: { id: string }; parent: { version: number } };
  return { id: body.task.id, parentVersion: body.parent.version };
}

/** 管理端：软删除主任务或小任务（05 §3.9）。 */
export async function deleteTask(app: FastifyInstance, id: string, version: number): Promise<void> {
  const response = await app.inject({ method: "DELETE", url: `/api/v1/admin/tasks/${id}?version=${version}` });
  if (response.statusCode !== 204) throw new Error(`deleteTask failed: ${response.statusCode} ${response.body}`);
}
