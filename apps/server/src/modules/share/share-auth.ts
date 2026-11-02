import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createEntityStore, type EntityStore } from "../../storage/entity-store.js";
import type { MemberSummary } from "@ztask/shared";

/** 会话有效期：30 天（06 §5 expiresAt）。 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 会话 Cookie 名；值形如 `<sessionId>.<verifier>`。 */
export const SHARE_COOKIE_NAME = "ztask_share_session";

/** share-links/<memberId>.json 的持久化形态（06 §4.3）；raw token 不落盘。 */
export interface ShareLinkFile {
  formatVersion: number;
  id: string;
  memberId: string;
  tokenHash: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** auth-sessions/<sessionId>.json 的持久化形态（06 §5）；只存 verifierHash。 */
export interface SessionFile {
  formatVersion: number;
  sessionId: string;
  memberId: string;
  shareLinkId: string;
  verifierHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

/** 已解析的成员 principal：每次请求都重新校验，不是信任凭证。 */
export interface MemberPrincipal {
  memberId: string;
  sessionId: string;
  shareLinkId: string;
  member: MemberSummary;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function linkStore(dataDir: string): EntityStore<ShareLinkFile> {
  return createEntityStore<ShareLinkFile>({ dataDir, subdir: "share-links" });
}

function sessionDir(dataDir: string): string {
  return join(dataDir, "auth-sessions");
}

function memberSummaryFile(file: { id: string; name: string; role: string; color: string }): MemberSummary {
  return { id: file.id, name: file.name, role: file.role, color: file.color };
}

/**
 * 铸发（或重置）成员的 active 分享链接：CSPRNG 生成 32 字节 token（Base64URL），
 * 只落 tokenHash（06 §4.3 / 04 §8）。raw token 仅在返回值中出现一次，供管理员分发。
 * @param options 装配项。
 * @param options.dataDir 数据目录。
 * @param options.memberId 目标成员。
 * @param options.clock 可注入时钟。
 * @returns 完整 raw token（Base64URL）。
 */
export async function mintShareLink(options: { dataDir: string; memberId: string; clock?: () => Date }): Promise<string> {
  const store = linkStore(options.dataDir);
  const now = (options.clock ?? (() => new Date()))().toISOString();
  const token = randomBytes(32).toString("base64url");
  const existing = await store.get(options.memberId);
  const file: ShareLinkFile = {
    formatVersion: 1,
    id: existing?.id ?? randomUUID(),
    memberId: options.memberId,
    tokenHash: sha256(token),
    status: "active",
    createdAt: existing?.createdAt ?? now,
    revokedAt: null,
    lastUsedAt: existing?.lastUsedAt ?? null,
  };
  await store.put(options.memberId, file);
  return token;
}

/**
 * Cookie 值：`<sessionId>.<verifier>`；HttpOnly + SameSite=Strict + Path=/api/v1/share。
 * @param sessionId 会话 ID。
 * @param verifier 高熵校验器（明文，仅进 Cookie）。
 * @returns Set-Cookie 属性串。
 */
export function serializeSessionCookie(sessionId: string, verifier: string): string {
  const value = `${sessionId}.${verifier}`;
  return `${SHARE_COOKIE_NAME}=${value}; Path=/api/v1/share; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

/** 注销/失效时的 Cookie 清除属性串（Max-Age=0）。
 * @returns Set-Cookie 清除串。
 */
export function clearSessionCookie(): string {
  return `${SHARE_COOKIE_NAME}=; Path=/api/v1/share; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/**
 * 令牌换取会话（07 §3.2）：SHA-256 后匹配 active link → 成员未归档 →
 * 铸发 sessionId + 高熵 verifier（只存 verifierHash）→ 原子写会话文件。
 * @param options 装配项。
 * @param options.dataDir 数据目录。
 * @param token 分享 raw token。
 * @returns 成员摘要与 Set-Cookie 值；token 无效/成员已归档为 null。
 */
export async function exchangeShareToken(options: { dataDir: string; token: string; clock?: () => Date }): Promise<{ member: MemberSummary; cookie: string } | null> {
  const token = options.token.trim();
  if (token.length < 16 || token.length > 256) return null;
  const tokenHash = sha256(token);
  const store = linkStore(options.dataDir);
  const links = await store.list();
  const link = links.map((entry) => entry.value).find((value) => value.status === "active" && constantTimeEqual(value.tokenHash, tokenHash));
  if (!link) return null;

  const members = createEntityStore<{ id: string; name: string; role: string; color: string; archivedAt: string | null }>({
    dataDir: options.dataDir,
    subdir: "members",
  });
  const member = await members.get(link.memberId);
  if (!member || member.archivedAt !== null) return null;

  const sessionId = randomUUID();
  const verifier = randomBytes(32).toString("base64url");
  const now = (options.clock ?? (() => new Date()))();
  const session: SessionFile = {
    formatVersion: 1,
    sessionId,
    memberId: member.id,
    shareLinkId: link.id,
    verifierHash: sha256(verifier),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    lastSeenAt: now.toISOString(),
  };
  const { writeJsonAtomic } = await import("../../storage/atomic-json.js");
  await writeJsonAtomic(join(sessionDir(options.dataDir), `${sessionId}.json`), session);

  return { member: memberSummaryFile(member), cookie: serializeSessionCookie(sessionId, verifier) };
}

/**
 * 解析并校验会话（每请求执行）：sessionId 定位文件 → 常量时间校验 verifierHash →
 * 未过期 → 成员未归档 → shareLinkId 仍是当前 active link（残留会话兜底失效）。
 * @param options 装配项。
 * @param options.dataDir 数据目录。
 * @param options.cookieHeader 请求的 Cookie 头（可缺失）。
 * @returns 成员 principal；无效为 null。
 */
export async function resolveShareSession(options: { dataDir: string; cookieHeader: string | undefined }): Promise<MemberPrincipal | null> {
  const header = options.cookieHeader;
  if (!header) return null;
  const pair = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SHARE_COOKIE_NAME}=`));
  if (!pair) return null;
  const value = pair.slice(SHARE_COOKIE_NAME.length + 1);
  const dotIndex = value.indexOf(".");
  if (dotIndex <= 0) return null;
  const sessionId = value.slice(0, dotIndex);
  const verifier = value.slice(dotIndex + 1);
  if (!UUID_PATTERN.test(sessionId)) return null;

  let session: SessionFile;
  try {
    session = JSON.parse(await readFile(join(sessionDir(options.dataDir), `${sessionId}.json`), "utf8")) as SessionFile;
  } catch {
    return null;
  }
  if (!constantTimeEqual(sha256(verifier), session.verifierHash)) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;

  const members = createEntityStore<{ id: string; name: string; role: string; color: string; archivedAt: string | null }>({
    dataDir: options.dataDir,
    subdir: "members",
  });
  const member = await members.get(session.memberId);
  if (!member || member.archivedAt !== null) return null;

  const links = await linkStore(options.dataDir).list();
  const link = links.map((entry) => entry.value).find((value) => value.id === session.shareLinkId);
  if (!link || link.status !== "active") return null;

  return {
    memberId: member.id,
    sessionId,
    shareLinkId: link.id,
    member: memberSummaryFile(member),
  };
}

/**
 * 注销：删除会话文件（幂等）；Cookie 清除值由 clearSessionCookie 提供。
 * @param dataDir 数据目录。
 * @param sessionId 会话 ID。
 */
export async function destroySession(dataDir: string, sessionId: string): Promise<void> {
  if (!UUID_PATTERN.test(sessionId)) return;
  await unlink(join(sessionDir(dataDir), `${sessionId}.json`)).catch(() => undefined);
}

async function listSessionFiles(dataDir: string): Promise<string[]> {
  try {
    return await readdir(sessionDir(dataDir));
  } catch {
    return [];
  }
}

/**
 * 删除某成员的全部会话（链接重置/吊销时的清理动作，06 §4.3）。
 * @param dataDir 数据目录。
 * @param memberId 成员 ID。
 */
export async function destroyMemberSessions(dataDir: string, memberId: string): Promise<void> {
  for (const name of await listSessionFiles(dataDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const session = JSON.parse(await readFile(join(sessionDir(dataDir), name), "utf8")) as { memberId?: string };
      if (session.memberId === memberId) await unlink(join(sessionDir(dataDir), name));
    } catch {
      // 损坏会话文件一并清理
      await unlink(join(sessionDir(dataDir), name)).catch(() => undefined);
    }
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { sessionDir as authSessionsDir, UUID_PATTERN as SHARE_UUID_PATTERN };

/**
 * 测试/工具助手：直接用 dataDir + token 换取会话 Cookie（不经 HTTP）。
 * @param options 装配项。
 * @param options.dataDir 数据目录。
 * @param token 分享 raw token。
 * @returns Cookie 与成员摘要；无效为 null。
 */
export async function requestShareSession(options: { dataDir: string }, token: string): Promise<{ cookie: string; member: MemberSummary } | null> {
  return exchangeShareToken({ dataDir: options.dataDir, token });
}
