import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ApiError } from "@ztask/shared";
import type { AdminMemberShareLink, AdminShareLinkIssued, AdminShareLinkState } from "@ztask/shared";
import { createEntityStore } from "../../storage/entity-store.js";
import type { EntityStore } from "../../storage/entity-store.js";
import { destroySessionsForMember, type ShareLinkFile } from "./share-auth.js";

/**
 * 分享链接生命周期服务（07 §7、06 §4.3）。
 *
 * 安全不变量：
 * - 64 字符 base64url token 来自 CSPRNG（32 字节），只存 SHA-256 十六进制摘要；
 * - 完整 URL 只在 generate/rotate 当次响应出现，绝不写入 `share-links/<memberId>.json`；
 * - 每成员一个文件，从路径上保证「最多一条当前链接」，重置直接原子替换 id/tokenHash；
 * - 轮换/吊销后删除该成员会话文件；即使删除失败，`resolveShareSession` 的
 *   shareLinkId/status 校验仍会拒绝残留会话（06 §5）。
 */

/** 分享域对链接服务的依赖：只有 LAN running 才能生成 URL（07 §3.3）。 */
export interface ShareNetworkState {
  isRunning(): boolean;
  shareBaseUrl(): string | null;
}

/** ShareLinkService 装配项。 */
export interface ShareLinkServiceOptions {
  dataDir: string;
  /** 可注入时钟；缺省系统时间。 */
  clock?: () => Date;
  network: ShareNetworkState;
}

/** 管理端分享链接生命周期接口（05 §4.5–4.8）。 */
export interface ShareLinkService {
  /** 为尚无 active 链接的成员生成；已有 active 返回 409，LAN 未运行返回 409。 */
  generate(memberId: string): Promise<AdminShareLinkIssued>;
  /** 原子替换 id/tokenHash 并删除旧会话；旧 URL/旧 Cookie 立即失效。 */
  rotate(memberId: string): Promise<AdminShareLinkIssued>;
  /** 吊销链接并删除会话；文件不存在或已吊销时幂等。 */
  revoke(memberId: string): Promise<void>;
  /** 脱敏状态；从未生成时 status=none。 */
  get(memberId: string): Promise<AdminShareLinkState>;
  /** 成员列表/详情用的汇总；无文件为 null，损坏文件也按 null 处理。 */
  summary(memberId: string): Promise<AdminMemberShareLink | null>;
}

/** 成员记录只需读取归档字段（06 §4.1）。 */
interface MemberRecord {
  id: string;
  archivedAt: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 分享 token 熵：32 字节（04 §8）。 */
const TOKEN_BYTES = 32;

/** `/#/s/<token>` 是前端 hash 路由；token 必须留在 fragment，不进入服务端日志。 */
const SHARE_PATH_PREFIX = "/#/s/";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * 创建分享链接服务。
 * @param options 数据目录、时钟与 LAN 状态依赖。
 * @returns ShareLinkService。
 */
export function createShareLinkService(options: ShareLinkServiceOptions): ShareLinkService {
  const clock = options.clock ?? (() => new Date());
  const linkStore: EntityStore<ShareLinkFile> = createEntityStore<ShareLinkFile>({ dataDir: options.dataDir, subdir: "share-links" });
  const memberStore: EntityStore<MemberRecord> = createEntityStore<MemberRecord>({ dataDir: options.dataDir, subdir: "members" });

  // 07 §2.3：share-link 按 memberId 入队，避免同成员并发生成/轮换互相覆盖。
  const tails = new Map<string, Promise<unknown>>();
  function serial<T>(memberId: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(memberId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(memberId, settled);
    void settled.then(() => {
      if (tails.get(memberId) === settled) tails.delete(memberId);
    });
    return run;
  }

  function assertMemberId(memberId: string): void {
    // 非 UUID 无法定位成员，按不存在处理（05 §7：不泄露资源是否存在）。
    if (!UUID_PATTERN.test(memberId)) throw new ApiError(404, "NOT_FOUND", "成员不存在");
  }

  /** 生成/轮换要求成员存在且未归档；归档成员不能再获新链接。 */
  async function requireActiveMember(memberId: string): Promise<MemberRecord> {
    assertMemberId(memberId);
    const member = await memberStore.get(memberId);
    if (member === null || member.archivedAt !== null) throw new ApiError(404, "NOT_FOUND", "成员不存在");
    return member;
  }

  /** 吊销/查询只要求成员存在；已归档成员仍需幂等清理。 */
  async function requireExistingMember(memberId: string): Promise<MemberRecord> {
    assertMemberId(memberId);
    const member = await memberStore.get(memberId);
    if (member === null) throw new ApiError(404, "NOT_FOUND", "成员不存在");
    return member;
  }

  /** 05 §4.5：LAN 未 running 时不得分发指向 127.0.0.1 的不可达 URL。 */
  function requireShareBaseUrl(): string {
    const base = options.network.shareBaseUrl();
    if (!options.network.isRunning() || base === null || base.trim() === "") {
      throw new ApiError(409, "LAN_SHARE_DISABLED", "局域网分享未开启，请先在网络设置中开启");
    }
    return base.replace(/\/+$/, "");
  }

  /** 06 §4.3 + 07 §7：新链接始终写新 id/tokenHash，任何状态都不复用旧 token。 */
  function newLink(memberId: string, now: string): { file: ShareLinkFile; token: string } {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    return {
      token,
      file: {
        formatVersion: 1,
        id: randomUUID(),
        memberId,
        tokenHash: sha256Hex(token),
        status: "active",
        createdAt: now,
        revokedAt: null,
        lastUsedAt: null,
      },
    };
  }

  function toIssued(file: ShareLinkFile, token: string, baseUrl: string): AdminShareLinkIssued {
    return {
      id: file.id,
      status: "active",
      url: `${baseUrl}${SHARE_PATH_PREFIX}${token}`,
      createdAt: file.createdAt,
    };
  }

  return {
    async generate(memberId) {
      return await serial(memberId, async () => {
        await requireActiveMember(memberId);
        const existing = await linkStore.get(memberId);
        if (existing !== null && existing.status === "active") {
          throw new ApiError(409, "ACTIVE_SHARE_LINK_EXISTS", "该成员已有生效中的分享链接，请使用重置");
        }
        const baseUrl = requireShareBaseUrl();
        const now = clock().toISOString();
        const { file, token } = newLink(memberId, now);
        await linkStore.put(memberId, file);
        return toIssued(file, token, baseUrl);
      });
    },

    async rotate(memberId) {
      return await serial(memberId, async () => {
        await requireActiveMember(memberId);
        const baseUrl = requireShareBaseUrl();
        const now = clock().toISOString();
        // reset 语义（07 §7）：先删旧会话，再替换链接行（外键要求旧 session 不悬挂）。
        // 新 id + 新 tokenHash 使旧链接/旧会话立即失效。
        const { file, token } = newLink(memberId, now);
        await destroySessionsForMember(options.dataDir, memberId);
        await linkStore.put(memberId, file);
        return toIssued(file, token, baseUrl);
      });
    },

    async revoke(memberId) {
      await serial(memberId, async () => {
        await requireExistingMember(memberId);
        const existing = await linkStore.get(memberId);
        if (existing === null) return;
        if (existing.status !== "revoked") {
          await linkStore.put(memberId, {
            ...existing,
            status: "revoked",
            revokedAt: clock().toISOString(),
          });
        }
        // 已吊销也重复清理：幂等且能清掉旧版本残留会话。
        await destroySessionsForMember(options.dataDir, memberId);
      });
    },

    async get(memberId) {
      await requireExistingMember(memberId);
      const link = await linkStore.get(memberId);
      if (link === null) return { status: "none" };
      return {
        status: link.status,
        createdAt: link.createdAt,
        revokedAt: link.revokedAt,
        lastUsedAt: link.lastUsedAt,
      };
    },

    async summary(memberId) {
      if (!UUID_PATTERN.test(memberId)) return null;
      try {
        const link = await linkStore.get(memberId);
        if (link === null) return null;
        return {
          status: link.status,
          createdAt: link.createdAt,
          revokedAt: link.revokedAt,
          lastUsedAt: link.lastUsedAt,
        };
      } catch {
        // 成员列表不能因单个损坏链接文件整体 500；管理端会显示为无链接并可在分享端点看到错误。
        return null;
      }
    },
  };
}
