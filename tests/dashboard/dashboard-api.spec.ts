// @vitest-environment node
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DashboardDueDistribution, DashboardSummary, DashboardTasks, Importance } from "@ztask/shared";
import {
  createFolder,
  createMember,
  createMemberAccessApp,
  createSubtask,
  createTask,
  deleteTask,
  exchangeCookie,
  seedShareLink,
  tmpDataDir,
} from "../member-access/support/share-fixtures.js";

/**
 * 看板统计服务端契约（issue #21 / 05 §2.2 §5.1–5.2 §6.12–6.13、02 §7）：
 * 三桶边界、任务夹后代、成员过滤、软删除、分享域范围、due 四桶与时区、响应形状。
 *
 * 固定时钟 `2026-05-09T16:30:00Z`：上海已是 2026-05-10，UTC 仍是 05-09。
 * 跨日断言依赖这一点（05-17 在上海口径是 diff=7 → week，UTC 口径会变成 month）。
 */
const FIXED_NOW = new Date("2026-05-09T16:30:00.000Z");
const FIXED_ISO = FIXED_NOW.toISOString();
const TIME_ZONE = "Asia/Shanghai";
/** 上海「今天」；仅用于说明，不直接参与查询。 */
const SHANGHAI_TODAY = "2026-05-10";
const UNKNOWN_FOLDER_ID = "00000000-0000-4000-8000-000000000000";

const ZERO_IMPORTANCE = { high: 0, mid: 0, low: 0 } as const;

let dataDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  // 只伪造 Date，保留真实 I/O 与定时器；看板服务用 clock()/Intl 求「今天」。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  dataDir = tmpDataDir();
  app = await createMemberAccessApp(dataDir, { timeZone: TIME_ZONE });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
  vi.useRealTimers();
});

/** 管理端 summary。 */
async function adminSummary(folderId: string, extra = ""): Promise<DashboardSummary> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/admin/dashboard/summary?folderId=${folderId}${extra}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as DashboardSummary;
}

/** 管理端 due-distribution。 */
async function adminDue(
  folderId: string,
  bucket: string,
  extra = "",
): Promise<DashboardDueDistribution> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/admin/dashboard/due-distribution?folderId=${folderId}&bucket=${bucket}${extra}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as DashboardDueDistribution;
}

/** 管理端任务明细。 */
async function adminTasks(folderId: string, bucket: string, extra = ""): Promise<DashboardTasks> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/admin/dashboard/tasks?folderId=${folderId}&bucket=${bucket}${extra}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as DashboardTasks;
}

/** 分享域 summary（带会话 Cookie）。 */
async function shareSummary(cookie: string, folderId: string, extra = ""): Promise<DashboardSummary> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/share/dashboard/summary?folderId=${folderId}${extra}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as DashboardSummary;
}

/** 分享域 due-distribution（带会话 Cookie）。 */
async function shareDue(
  cookie: string,
  folderId: string,
  bucket: string,
  extra = "",
): Promise<DashboardDueDistribution> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/share/dashboard/due-distribution?folderId=${folderId}&bucket=${bucket}${extra}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as DashboardDueDistribution;
}

/** 分享域任务明细（带会话 Cookie）。 */
async function shareTasks(
  cookie: string,
  folderId: string,
  bucket: string,
  extra = "",
): Promise<DashboardTasks> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/share/dashboard/tasks?folderId=${folderId}&bucket=${bucket}${extra}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as DashboardTasks;
}

function totalOf(summary: DashboardSummary): number {
  return summary.buckets.done.total + summary.buckets.gt50.total + summary.buckets.lt50.total;
}

function dueTotals(distribution: DashboardDueDistribution): Record<string, number> {
  return Object.fromEntries(distribution.buckets.map((bucket) => [bucket.key, bucket.total]));
}

describe("管理员看板 summary：三桶与重要度", () => {
  it("按 0/50/51/99/100 边界分入 lt50/gt50/done，并给出 high/mid/low 计数", async () => {
    const folderId = await createFolder(app, "边界");
    await createTask(app, { folderId, description: "0%", ownerIds: [await createMember(app, "甲")], progress: 0, importance: "low" });
    const owner = await createMember(app, "乙");
    await createTask(app, { folderId, description: "50%", ownerIds: [owner], progress: 50, importance: "high" });
    await createTask(app, { folderId, description: "51%", ownerIds: [owner], progress: 51, importance: "mid" });
    await createTask(app, { folderId, description: "99%", ownerIds: [owner], progress: 99, importance: "high" });
    await createTask(app, { folderId, description: "100%", ownerIds: [owner], progress: 100, importance: "low" });

    const summary = await adminSummary(folderId);

    expect(summary.buckets.done).toEqual({ total: 1, importance: { high: 0, mid: 0, low: 1 } });
    expect(summary.buckets.gt50).toEqual({ total: 2, importance: { high: 1, mid: 1, low: 0 } });
    expect(summary.buckets.lt50).toEqual({ total: 2, importance: { high: 1, mid: 0, low: 1 } });
    expect(totalOf(summary)).toBe(5);
  });
});

describe("管理员看板 summary：任务夹范围", () => {
  it("统计 folderId 及全部后代；不影响兄弟夹；未知/空任务夹是空集而不是 404", async () => {
    const root = await createFolder(app, "根");
    const child = await createFolder(app, "子", root);
    const grandchild = await createFolder(app, "孙", child);
    const sibling = await createFolder(app, "兄弟", root);
    const empty = await createFolder(app, "空夹");
    const owner = await createMember(app, "陈晨");

    await createTask(app, { folderId: root, description: "根任务", ownerIds: [owner] });
    await createTask(app, { folderId: child, description: "子任务", ownerIds: [owner] });
    await createTask(app, { folderId: grandchild, description: "孙任务", ownerIds: [owner] });
    await createTask(app, { folderId: sibling, description: "兄弟任务", ownerIds: [owner] });

    expect(totalOf(await adminSummary(root))).toBe(4);
    expect(totalOf(await adminSummary(child))).toBe(2);
    expect(totalOf(await adminSummary(grandchild))).toBe(1);
    expect(totalOf(await adminSummary(sibling))).toBe(1);

    const unknown = await adminSummary(UNKNOWN_FOLDER_ID);
    expect(unknown.buckets).toEqual({
      done: { total: 0, importance: { ...ZERO_IMPORTANCE } },
      gt50: { total: 0, importance: { ...ZERO_IMPORTANCE } },
      lt50: { total: 0, importance: { ...ZERO_IMPORTANCE } },
    });
    expect(totalOf(await adminSummary(empty))).toBe(0);
  });
});

describe("管理员看板 summary：成员过滤", () => {
  it("空选择=全部；只认有效 owner；多成员 OR；归档 owner 不再命中", async () => {
    const folderId = await createFolder(app, "成员过滤");
    const memberA = await createMember(app, "陈晨");
    const memberB = await createMember(app, "林悦");
    const memberC = await createMember(app, "周舟");

    await createTask(app, { folderId, description: "A 负责", ownerIds: [memberA] });
    await createTask(app, { folderId, description: "B 负责", ownerIds: [memberB] });
    await createTask(app, { folderId, description: "A+B 负责", ownerIds: [memberA, memberB] });
    await createTask(app, { folderId, description: "A 负责/C 协作", ownerIds: [memberA], collaboratorIds: [memberC] });
    const subtaskParent = await createTask(app, { folderId, description: "B 负责/A 小任务", ownerIds: [memberB] });
    await createSubtask(app, {
      folderId,
      parentId: subtaskParent.id,
      description: "A 的小任务",
      ownerId: memberA,
    });

    expect(totalOf(await adminSummary(folderId))).toBe(5);
    expect(totalOf(await adminSummary(folderId, `&memberIds=${memberA}`))).toBe(3);
    expect(totalOf(await adminSummary(folderId, `&memberIds=${memberB}`))).toBe(3);
    // 仅小任务被分配的成员在管理员过滤里不算 owner。
    expect(totalOf(await adminSummary(folderId, `&memberIds=${memberC}`))).toBe(0);

    // 重复参数与逗号分隔等价，scope 回显去重后的选择。
    const repeated = await adminSummary(folderId, `&memberIds=${memberA}&memberIds=${memberB}`);
    const comma = await adminSummary(folderId, `&memberIds=${memberA},${memberB}`);
    expect(totalOf(repeated)).toBe(5);
    expect(totalOf(comma)).toBe(5);
    expect(repeated.scope.memberIds).toEqual([memberA, memberB]);
    expect(comma.scope.memberIds).toEqual([memberA, memberB]);
    expect((await adminSummary(folderId, `&memberIds=${memberA},${memberA}`)).scope.memberIds).toEqual([memberA]);

    // 归档 B：B 的 owner 身份不再生效；空选择仍是全部；A 的选择不受影响。
    const archived = await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${memberB}` });
    expect(archived.statusCode).toBe(204);

    expect(totalOf(await adminSummary(folderId, `&memberIds=${memberB}`))).toBe(0);
    expect(totalOf(await adminSummary(folderId, `&memberIds=${memberA},${memberB}`))).toBe(3);
    expect(totalOf(await adminSummary(folderId, `&memberIds=${memberA}`))).toBe(3);
    expect(totalOf(await adminSummary(folderId))).toBe(5);
  });
});

describe("管理员看板 summary：软删除", () => {
  it("软删除主任务不计入统计", async () => {
    const folderId = await createFolder(app, "软删除");
    const owner = await createMember(app, "陈晨");
    await createTask(app, { folderId, description: "保留 1", ownerIds: [owner] });
    const removed = await createTask(app, { folderId, description: "删除", ownerIds: [owner] });
    await createTask(app, { folderId, description: "保留 2", ownerIds: [owner] });
    await deleteTask(app, removed.id, removed.version);

    const summary = await adminSummary(folderId);
    expect(totalOf(summary)).toBe(2);
    expect(summary.buckets.lt50.total).toBe(2);
  });
});

describe("分享域看板", () => {
  it("统计团队全部任务并与任务夹范围求交；memberIds 按 owner 口径筛选", async () => {
    const folderId = await createFolder(app, "分享看板");
    const otherFolder = await createFolder(app, "其他夹");
    const memberA = await createMember(app, "陈晨");
    const memberB = await createMember(app, "林悦");

    await createTask(app, { folderId, description: "A 负责", ownerIds: [memberA], progress: 100, importance: "high", dueDate: SHANGHAI_TODAY });
    await createTask(app, { folderId, description: "B 负责", ownerIds: [memberB], progress: 100, importance: "high" });
    await createTask(app, {
      folderId,
      description: "B 负责/A 协作",
      ownerIds: [memberB],
      collaboratorIds: [memberA],
      progress: 51,
      importance: "mid",
    });
    const subtaskParent = await createTask(app, { folderId, description: "B 负责/A 小任务", ownerIds: [memberB], importance: "low" });
    await createSubtask(app, { folderId, parentId: subtaskParent.id, description: "A 的小任务", ownerId: memberA });
    await createTask(app, { folderId: otherFolder, description: "A 在别的夹", ownerIds: [memberA], progress: 100 });

    const { token: tokenA } = await seedShareLink({ dataDir, memberId: memberA });
    const { token: tokenB } = await seedShareLink({ dataDir, memberId: memberB });
    const cookieA = await exchangeCookie(app, tokenA);
    const cookieB = await exchangeCookie(app, tokenB);

    // 无会话：401，且不因 memberIds 参数变成 400（先认证再解析）。
    const anonymous = await app.inject({
      method: "GET",
      url: `/api/v1/share/dashboard/summary?folderId=${folderId}&memberIds=${memberB}`,
    });
    expect(anonymous.statusCode).toBe(401);
    expect((anonymous.json() as { error: { code: string } }).error.code).toBe("SHARE_SESSION_REQUIRED");

    // 全员可见：A、B 看到同一份团队任务统计。
    const summaryA = await shareSummary(cookieA, folderId);
    expect(summaryA.scope).toEqual({ folderId, memberIds: [] });
    expect(summaryA.buckets.done.total).toBe(2);
    expect(summaryA.buckets.gt50.total).toBe(1);
    expect(summaryA.buckets.lt50.total).toBe(1);
    expect(totalOf(summaryA)).toBe(4);

    const summaryB = await shareSummary(cookieB, folderId);
    expect(summaryB.buckets.done.total).toBe(2);
    expect(summaryB.buckets.gt50.total).toBe(1);
    expect(summaryB.buckets.lt50.total).toBe(1);
    expect(totalOf(summaryB)).toBe(4);

    // 其他任务夹里的相关任务仍属于该成员，但被 folderId 范围排除。
    expect(totalOf(await shareSummary(cookieA, otherFolder))).toBe(1);

    const dueA = await shareDue(cookieA, folderId, "done");
    expect(dueTotals(dueA)).toEqual({ overdue: 0, week: 1, month: 0, later: 0, unscheduled: 1 });

    // memberIds 在团队全部任务范围内按 owner 口径筛选。
    const onlyA = await shareSummary(cookieA, folderId, `&memberIds=${memberA}`);
    expect(totalOf(onlyA)).toBe(1); // A 作为 owner 的任务只有「A 负责」
    expect(onlyA.scope.memberIds).toEqual([memberA]);

    const onlyB = await shareSummary(cookieA, folderId, `&memberIds=${memberB}`);
    expect(totalOf(onlyB)).toBe(3); // B 作为 owner 的三项

    const emptySelection = await shareSummary(cookieA, folderId, "&memberIds=");
    expect(totalOf(emptySelection)).toBe(4);
    expect(emptySelection.scope.memberIds).toEqual([]);

    // 全员可见后，任意在册成员都可作为筛选条件；没有 owner 命中时是合法空集。
    const memberC = await createMember(app, "赵敏");
    const probe = await app.inject({
      method: "GET",
      url: `/api/v1/share/dashboard/summary?folderId=${folderId}&memberIds=${memberC}`,
      headers: { cookie: cookieA },
    });
    expect(probe.statusCode).toBe(200);
    expect(totalOf(probe.json() as never)).toBe(0);

    const probeDue = await app.inject({
      method: "GET",
      url: `/api/v1/share/dashboard/due-distribution?folderId=${folderId}&bucket=done&memberIds=${memberC}`,
      headers: { cookie: cookieA },
    });
    expect(probeDue.statusCode).toBe(200);
  });
});

describe("看板任务明细", () => {
  it("按统计桶返回紧凑行，游标只描述位置并支持续页", async () => {
    const folderId = await createFolder(app, "明细");
    const owner = await createMember(app, "陈晨");
    const descriptions: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const description = `进行中 ${index + 1}`;
      descriptions.push(description);
      await createTask(app, {
        folderId,
        description,
        ownerIds: [owner],
        progress: 60 + index,
        importance: index % 2 === 0 ? "high" : "mid",
        dueDate: SHANGHAI_TODAY,
      });
    }
    await createTask(app, { folderId, description: "已完成", ownerIds: [owner], progress: 100 });
    await createTask(app, { folderId, description: "未开始", ownerIds: [owner], progress: 0 });
    const removed = await createTask(app, { folderId, description: "已删除进行中", ownerIds: [owner], progress: 70 });
    await deleteTask(app, removed.id, removed.version);

    const first = await adminTasks(folderId, "gt50");
    expect(first.bucket).toBe("gt50");
    expect(first.total).toBe(6);
    expect(first.pageSize).toBe(5);
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.items[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        description: expect.any(String),
        importance: expect.stringMatching(/high|mid/),
        owners: [expect.objectContaining({ id: owner, name: "陈晨" })],
        progress: expect.any(Number),
        dueDate: SHANGHAI_TODAY,
      }),
    );
    expect(first.items.some((task) => task.description === "已完成")).toBe(false);
    expect(first.items.some((task) => task.description === "未开始")).toBe(false);
    expect(first.items.some((task) => task.description === "已删除进行中")).toBe(false);

    const second = await adminTasks(
      folderId,
      "gt50",
      `&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.total).toBe(6);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((task) => task.description).sort()).toEqual([...descriptions].sort());
  });

  it("未知任务夹是空集，非法 cursor 是 400", async () => {
    const folderId = await createFolder(app, "空明细");
    expect(await adminTasks(folderId, "done")).toEqual({
      bucket: "done",
      total: 0,
      pageSize: 5,
      items: [],
      nextCursor: null,
    });
    expect((await adminTasks(UNKNOWN_FOLDER_ID, "done")).total).toBe(0);

    const invalid = await app.inject({
      method: "GET",
      url: `/api/v1/admin/dashboard/tasks?folderId=${folderId}&bucket=done&cursor=not-a-cursor`,
    });
    expect(invalid.statusCode).toBe(400);
    expect((invalid.json() as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
  });

  it("分享域返回团队全部任务，memberIds 按 owner 口径筛选", async () => {
    const folderId = await createFolder(app, "分享明细");
    const memberA = await createMember(app, "陈晨");
    const memberB = await createMember(app, "林悦");
    const ownA = await createTask(app, {
      folderId,
      description: "A 进行中",
      ownerIds: [memberA],
      progress: 70,
      importance: "high",
    });
    const ownB = await createTask(app, {
      folderId,
      description: "B 进行中",
      ownerIds: [memberB],
      progress: 80,
      importance: "mid",
    });
    await createTask(app, { folderId, description: "A 完成", ownerIds: [memberA], progress: 100 });

    const { token } = await seedShareLink({ dataDir, memberId: memberA });
    const cookie = await exchangeCookie(app, token);

    // 全员可见：A 的会话也返回团队全部 gt50 任务，不只 A 相关的任务。
    const tasksA = await shareTasks(cookie, folderId, "gt50");
    expect(tasksA.total).toBe(2);
    expect(tasksA.items.map((task) => task.id)).toEqual(expect.arrayContaining([ownA.id, ownB.id]));
    expect((await shareTasks(cookie, folderId, "done")).total).toBe(1);

    // memberIds 在团队全部任务范围内按 owner 口径筛选。
    expect((await shareTasks(cookie, folderId, "gt50", `&memberIds=${memberA}`)).total).toBe(1);
    expect((await shareTasks(cookie, folderId, "gt50", `&memberIds=${memberB}`)).total).toBe(1);

    // 全员可见后任意在册成员都可作为筛选条件；没有 owner 命中时是合法空集。
    const memberC = await createMember(app, "赵敏");
    const probe = await app.inject({
      method: "GET",
      url: `/api/v1/share/dashboard/tasks?folderId=${folderId}&bucket=gt50&memberIds=${memberC}`,
      headers: { cookie },
    });
    expect(probe.statusCode).toBe(200);
    expect((probe.json() as DashboardTasks).total).toBe(0);
  });
});

describe("dueDate 写入校验（05 §1 / 06 §3）", () => {
  it("形状合法但不存在的日期 2026-02-31 写入 400，不进入统计", async () => {
    const folderId = await createFolder(app, "非法日期");
    const memberId = await createMember(app, "陈晨");
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tasks",
      payload: {
        folderId,
        parentId: null,
        description: "非法日期",
        ownerIds: [memberId],
        dueDate: "2026-02-31",
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect((invalid.json() as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");

    const summary = await adminSummary(folderId);
    expect(totalOf(summary)).toBe(0);
  });
});

describe("预计完成分布：五桶与时区", () => {
  it("按 manifest 时区今天分 overdue/week/month/later，null 进入未排期桶，空桶仍返回", async () => {
    const folderId = await createFolder(app, "分布");
    const owner = await createMember(app, "陈晨");

    const dated: Array<{ dueDate: string; importance: Importance }> = [
      { dueDate: "2026-05-09", importance: "high" }, // 昨天 → overdue
      { dueDate: SHANGHAI_TODAY, importance: "mid" }, // 今天 → week
      { dueDate: "2026-05-17", importance: "low" }, // 上海口径 diff=7 → week（UTC 会是 8/month）
      { dueDate: "2026-05-18", importance: "high" }, // diff=8 → month
      { dueDate: "2026-06-09", importance: "mid" }, // diff=30 → month
      { dueDate: "2026-06-10", importance: "low" }, // diff=31 → later
    ];
    for (const entry of dated) {
      await createTask(app, { folderId, description: entry.dueDate, ownerIds: [owner], dueDate: entry.dueDate, importance: entry.importance });
    }
    // 未排期进入独立 unscheduled 桶（02 §7.6）。
    await createTask(app, { folderId, description: "未排期", ownerIds: [owner], dueDate: null, importance: "high" });
    // 不同统计桶的已排期任务不应混入 lt50 分布。
    await createTask(app, { folderId, description: "已完成逾期", ownerIds: [owner], progress: 100, dueDate: "2026-05-09", importance: "high" });

    const lt50 = await adminDue(folderId, "lt50");
    expect(lt50.bucket).toBe("lt50");
    expect(lt50.asOf).toBe(FIXED_ISO);
    // 固定五桶顺序：空桶不省略；null 进入 unscheduled。
    expect(lt50.buckets).toEqual([
      { key: "overdue", total: 1, importance: { high: 1, mid: 0, low: 0 } },
      { key: "week", total: 2, importance: { high: 0, mid: 1, low: 1 } },
      { key: "month", total: 2, importance: { high: 1, mid: 1, low: 0 } },
      { key: "later", total: 1, importance: { high: 0, mid: 0, low: 1 } },
      { key: "unscheduled", total: 1, importance: { high: 1, mid: 0, low: 0 } },
    ]);

    const done = await adminDue(folderId, "done");
    expect(dueTotals(done)).toEqual({ overdue: 1, week: 0, month: 0, later: 0, unscheduled: 0 });

    const gt50 = await adminDue(folderId, "gt50");
    expect(gt50.buckets).toEqual([
      { key: "overdue", total: 0, importance: { ...ZERO_IMPORTANCE } },
      { key: "week", total: 0, importance: { ...ZERO_IMPORTANCE } },
      { key: "month", total: 0, importance: { ...ZERO_IMPORTANCE } },
      { key: "later", total: 0, importance: { ...ZERO_IMPORTANCE } },
      { key: "unscheduled", total: 0, importance: { ...ZERO_IMPORTANCE } },
    ]);
  });
});

describe("看板响应形状与参数校验", () => {
  it("scope/asOf/buckets 与 bucket/asOf/buckets 的固定形状", async () => {
    const folderId = await createFolder(app, "形状");
    const memberA = await createMember(app, "陈晨");
    await createTask(app, { folderId, description: "完成", ownerIds: [memberA], progress: 100, importance: "high" });

    const summary = await adminSummary(folderId);
    expect(summary).toEqual({
      scope: { folderId, memberIds: [] },
      asOf: FIXED_ISO,
      buckets: {
        done: { total: 1, importance: { high: 1, mid: 0, low: 0 } },
        gt50: { total: 0, importance: { ...ZERO_IMPORTANCE } },
        lt50: { total: 0, importance: { ...ZERO_IMPORTANCE } },
      },
    });
    expect(Object.keys(summary.buckets)).toEqual(["done", "gt50", "lt50"]);

    const filtered = await adminSummary(folderId, `&memberIds=${memberA}`);
    expect(filtered.scope.memberIds).toEqual([memberA]);
    expect((await adminSummary(folderId, `&memberIds=${memberA}&memberIds=${memberA}`)).scope.memberIds).toEqual([memberA]);

    const distribution = await adminDue(folderId, "done");
    expect(distribution.bucket).toBe("done");
    expect(distribution.asOf).toBe(FIXED_ISO);
    expect(distribution.buckets.map((bucket) => bucket.key)).toEqual(["overdue", "week", "month", "later", "unscheduled"]);
    for (const bucket of distribution.buckets) {
      expect(bucket).toHaveProperty("total");
      // 未排期任务会落在 unscheduled；其余桶保持零计数。
      expect(bucket.importance).toEqual({
        high: bucket.key === "unscheduled" ? 1 : 0,
        mid: 0,
        low: 0,
      });
    }
  });

  it("缺失/非法参数返回 400 INVALID_REQUEST", async () => {
    const folderId = await createFolder(app, "校验");
    const cases: string[] = [
      "/api/v1/admin/dashboard/summary",
      "/api/v1/admin/dashboard/summary?folderId=",
      `/api/v1/admin/dashboard/due-distribution?folderId=${folderId}`,
      `/api/v1/admin/dashboard/due-distribution?folderId=${folderId}&bucket=big`,
      "/api/v1/admin/dashboard/due-distribution?bucket=done",
      `/api/v1/admin/dashboard/summary?folderId=${folderId}&memberIds=not-a-uuid`,
    ];
    for (const url of cases) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(400);
      expect((response.json() as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
    }
  });
});
