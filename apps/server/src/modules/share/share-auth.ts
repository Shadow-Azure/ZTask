import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createEntityStore, type EntityStore } from "../../storage/entity-store.js";
import type { MemberSummary } from "@ztask/shared";

/** 会话有效期：30 天（06 §5 expiresAt）。 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * lastUsedAt / lastSeenAt 的节流窗口（07 §3.2 第 3 步、06 §5）：
 * 同一窗口内的重复请求不再原子替换文件，避免每次请求都产生一次写盘。
 */
const TOUCH_THROTTLE_MS = 60 * 1000;

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

function sessionStore(dataDir: string): EntityStore<SessionFile> {
  return createEntityStore<SessionFile>({ dataDir, subdir: "auth-sessions" });
}

function sessionDir(dataDir: string): string {
  return join(dataDir, "auth-sessions");
}

function memberSummaryFile(file: { id: string; name: string; role: string; color: string }): MemberSummary {
  return { id: file.id, name: file.name, role: file.role, color: file.color };
}

/**
 * 节流判定：时间戳为空、损坏或距 now 已超过 TOUCH_THROTTLE_MS 时需要写回。
 * @param lastTouchedAt 上次写回时间（RFC 3339，可缺失）。
 * @param nowMs 当前毫秒时间戳。
 * @returns 是否需要更新持久化时间戳。
 */
function needsTouch(lastTouchedAt: string | null, nowMs: number): boolean {
  if (lastTouchedAt === null) return true;
  const last = new Date(lastTouchedAt).getTime();
  return !Number.isFinite(last) || nowMs - last > TOUCH_THROTTLE_MS;
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
 * 铸发 sessionId + 高熵 verifier（只存 verifierHash）→ 原子写会话文件 →
 * 节流更新 link.lastUsedAt（null 或超过窗口才写，保留其余字段）。
 * @param options 装配项。
 * @param options.dataDir 数据目录。
 * @param options.token 分享 raw token。
 * @param options.clock 可注入时钟（测试过期/节流窗口）。
 * @returns 成员摘要与 Set-Cookie 值；token 无效/成员已归档为 null。
 */
export async function exchangeShareToken(options: { dataDir: string; token: string; clock?: () => Date }): Promise<{ member: MemberSummary; cookie: string } | null> {
  const token = options.token.trim();
  if (token.length < 16 || token.length > 256) return null;
  const tokenHash = sha256(token);
  const store = linkStore(options.dataDir);
  const links = await store.list();
  const link = links
    .map((entry) => entry.value)
    .find((value) => value.status === "active" && typeof value.tokenHash === "string" && constantTimeEqual(value.tokenHash, tokenHash));
  // 损坏链接（tokenHash 缺失或 memberId 非 UUID）按无效处理，不把存储错误暴露给前端。
  if (!link || !UUID_PATTERN.test(link.memberId)) return null;

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
  await sessionStore(options.dataDir).put(sessionId, session);

  // 07 §3.2 第 3 步：节流写 lastUsedAt；展开旧实体保留 id/tokenHash/status/createdAt。
  if (needsTouch(link.lastUsedAt, now.getTime())) {
    await store.put(link.memberId, { ...link, lastUsedAt: now.toISOString() });
  }

  return { member: memberSummaryFile(member), cookie: serializeSessionCookie(sessionId, verifier) };
}

/**
 * 解析并校验会话（每请求执行）：sessionId 定位文件 → 常量时间校验 verifierHash →
 * 未过期 → 成员未归档 → shareLinkId 仍是当前 active link（残留会话兜底失效）；
 * 通过后按 TOUCH_THROTTLE_MS 节流更新 lastSeenAt（06 §5）。
 * @param options 装配项。
 * @param options.dataDir 数据目录。
 * @param options.cookieHeader 请求的 Cookie 头（可缺失）。
 * @param options.clock 可注入时钟（测试过期/节流窗口）。
 * @returns 成员 principal；无效为 null。
 */
export async function resolveShareSession(options: { dataDir: string; cookieHeader: string | undefined; clock?: () => Date }): Promise<MemberPrincipal | null> {
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

  let session: SessionFile | null;
  try {
    session = await sessionStore(options.dataDir).get(sessionId);
  } catch {
    // 损坏或不可读的会话文件按未登录处理，不向前端泄露存储错误（05 §7）。
    return null;
  }
  if (!session || session.sessionId !== sessionId) return null;
  // 字段缺失/类型不符的损坏会话按未登录处理，避免 NaN 过期判断或哈希比较抛错。
  if (
    typeof session.memberId !== "string" ||
    typeof session.shareLinkId !== "string" ||
    typeof session.verifierHash !== "string" ||
    typeof session.expiresAt !== "string" ||
    typeof session.lastSeenAt !== "string"
  ) {
    return null;
  }
  if (!constantTimeEqual(sha256(verifier), session.verifierHash)) return null;
  if (!UUID_PATTERN.test(session.memberId)) return null;

  const now = (options.clock ?? (() => new Date()))();
  if (new Date(session.expiresAt).getTime() <= now.getTime()) return null;

  const members = createEntityStore<{ id: string; name: string; role: string; color: string; archivedAt: string | null }>({
    dataDir: options.dataDir,
    subdir: "members",
  });
  const member = await members.get(session.memberId);
  if (!member || member.archivedAt !== null) return null;

  const links = await linkStore(options.dataDir).list();
  const link = links.map((entry) => entry.value).find((value) => value.id === session.shareLinkId);
  if (!link || link.status !== "active") return null;

  // 06 §5 的心跳语义：只节流更新 lastSeenAt，心跳写失败不影响本请求。
  if (needsTouch(session.lastSeenAt, now.getTime())) {
    try {
      await sessionStore(options.dataDir).put(sessionId, { ...session, lastSeenAt: now.toISOString() });
    } catch {
      // 只读请求不因心跳落盘失败而失败
    }
  }

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

