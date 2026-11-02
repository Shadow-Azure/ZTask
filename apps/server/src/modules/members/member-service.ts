import { randomUUID } from "node:crypto";
import { ApiError } from "@ztask/shared";
import type { AdminMember, AdminMemberShareLink } from "@ztask/shared";
import { createEntityStore } from "../../storage/entity-store.js";
import type { EntityStore } from "../../storage/entity-store.js";
import type { TaskAggregate } from "../../storage/task-types.js";

/** members/<id>.json 的持久化形态（06 §4.1）。 */
export interface MemberFile {
  formatVersion: number;
  id: string;
  name: string;
  role: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/**
 * 成员服务对分享链接的依赖（只暴露所需两件事）：
 * - summary：填 `AdminMember.shareLink`（05 §2.3/§4.1）；
 * - revoke：归档前先吊销链接并删除会话（07 §7.1）。
 * 用结构化接口而不是导入 ShareLinkService 具体类型，避免成员模块反向依赖分享路由层。
 */
export interface ShareLinkSummarySource {
  summary(memberId: string): Promise<AdminMemberShareLink | null>;
  revoke(memberId: string): Promise<void>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 原型成员色板：新建成员按顺序轮转默认色。 */
const COLOR_PALETTE = ["#2f6fe0", "#1f9d6b", "#d97b1c", "#8a55c9", "#d63c3c", "#5a6372"];

/** 成员服务装配项：数据目录、可注入时钟与分享链接汇总来源。 */
export interface MemberServiceDeps {
  dataDir: string;
  clock?: () => Date;
  /** 缺省时 shareLink 恒为 null、归档不触碰链接（保持无分享模块的装配可用）。 */
  shareLinks?: ShareLinkSummarySource;
}

/** 成员服务：创建/更新/归档/列表（05 §4.1–4.4）；分享链接属 m4。 */
export interface MemberService {
  create(input: { name: string; role?: string; color?: string }): Promise<AdminMember>;
  update(id: string, input: { name?: string; role?: string; color?: string }): Promise<AdminMember>;
  /** 归档（DELETE 端点语义，05 §4.4）：不重写任务聚合。 */
  archive(id: string): Promise<void>;
  list(aggregates: TaskAggregate[]): Promise<AdminMember[]>;
}

/**
 * 创建成员服务；归档只改成员文件，绝不重写任务聚合（06 §4.1）。
 * @param deps 数据目录、时钟与分享链接汇总来源（缺省时 shareLink=null）。
 * @returns 服务与底层实体存储。
 */
export function createMemberService(deps: MemberServiceDeps): {
  service: MemberService;
  store: EntityStore<MemberFile>;
} {
  const store = createEntityStore<MemberFile>({ dataDir: deps.dataDir, subdir: "members" });
  const clock = deps.clock ?? (() => new Date());
  let created = 0;
  function assertName(name: string | undefined): string | undefined {
    if (name === undefined) return undefined;
    const trimmed = name.trim();
    if (!trimmed) throw new ApiError(400, "INVALID_REQUEST", "成员姓名不能为空");
    return trimmed;
  }

  function assertId(id: string): void {
    if (!UUID_PATTERN.test(id)) {
      throw new ApiError(400, "INVALID_REQUEST", "成员 ID 非法（须为 UUID）");
    }
  }

  /**
   * 成员 DTO（05 §2.3）：分享链接由 ShareLinkService.summary 汇总为脱敏态，
   * 只含 status/createdAt/revokedAt/lastUsedAt，绝不包含 raw token 或 URL。
   * @param file 成员文件。
   * @param aggregates 用于主任务计数的聚合列表。
   * @returns AdminMember。
   */
  async function toDto(file: MemberFile, aggregates: TaskAggregate[]): Promise<AdminMember> {
    const archived = file.archivedAt !== null;
    let owned = 0;
    let collaborated = 0;
    if (!archived) {
      for (const aggregate of aggregates) {
        if (aggregate.task.deletedAt !== null) continue;
        for (const assignment of aggregate.assignments) {
          if (assignment.taskId !== aggregate.taskId || assignment.memberId !== file.id) continue;
          if (assignment.kind === "owner") owned += 1;
          else collaborated += 1;
        }
      }
    }
    const shareLink = deps.shareLinks === undefined ? null : await deps.shareLinks.summary(file.id);
    return {
      id: file.id,
      name: file.name,
      role: file.role,
      color: file.color,
      archivedAt: file.archivedAt,
      counts: { owned, collaborated },
      shareLink,
    };
  }

  const service: MemberService = {
    async create(input): Promise<AdminMember> {
      const name = assertName(input.name);
      if (!name) throw new ApiError(400, "INVALID_REQUEST", "成员姓名不能为空");
      const now = clock().toISOString();
      const file: MemberFile = {
        formatVersion: 1,
        id: randomUUID(),
        name,
        role: input.role?.trim() ?? "",
        color: input.color?.trim() || COLOR_PALETTE[created % COLOR_PALETTE.length]!,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      created += 1;
      await store.put(file.id, file);
      return await toDto(file, []);
    },

    async update(id, input): Promise<AdminMember> {
      assertId(id);
      const existing = await store.get(id);
      if (!existing) throw new ApiError(404, "NOT_FOUND", "成员不存在");
      const name = assertName(input.name);
      const updated: MemberFile = {
        ...existing,
        name: name ?? existing.name,
        role: input.role !== undefined ? input.role.trim() : existing.role,
        color: input.color !== undefined && input.color.trim() !== "" ? input.color.trim() : existing.color,
        updatedAt: clock().toISOString(),
      };
      await store.put(id, updated);
      const aggregates: TaskAggregate[] = [];
      return await toDto(updated, aggregates);
    },

    async archive(id): Promise<void> {
      assertId(id);
      const existing = await store.get(id);
      if (!existing) throw new ApiError(404, "NOT_FOUND", "成员不存在");
      // 07 §7.1：先吊销链接并删除会话，再写 archivedAt。
      // 吊销失败则不归档（成员仍 active，最多链接已失效），不会产生越权残留。
      await deps.shareLinks?.revoke(id);
      if (existing.archivedAt === null) {
        await store.put(id, { ...existing, archivedAt: clock().toISOString(), updatedAt: clock().toISOString() });
      }
    },

    async list(aggregates): Promise<AdminMember[]> {
      const members = await store.list();
      const items = await Promise.all(members.map(async (entry) => await toDto(entry.value, aggregates)));
      return items.sort(
        (a, b) => (a.archivedAt === null ? -1 : 1) - (b.archivedAt === null ? -1 : 1) || a.name.localeCompare(b.name, "zh"),
      );
    },
  };

  return { service, store };
}

export { UUID_PATTERN as MEMBER_UUID_PATTERN };
