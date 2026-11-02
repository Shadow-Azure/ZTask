// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";
import DashboardPanel from "../../apps/web/src/features/dashboard/DashboardPanel.vue";
import type { DashboardSummary, DueBucket } from "@ztask/shared";

/**
 * 情况看板组件（05 §5.1–5.2、§6.12–6.13，原型 1352–1445）：
 * 三统计卡、管理员成员筛选、点击卡片展开分布、空态与分享域无筛选。
 */

interface Call {
  path: string;
  query: string;
}

const originalFetch = globalThis.fetch;
let calls: Call[];
let summary: DashboardSummary;
let due: { bucket: string; asOf: string; buckets: DueBucket[] };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeDue(overrides: Partial<Record<"overdue" | "week" | "month" | "later", number>> = {}): DueBucket[] {
  const keys = ["overdue", "week", "month", "later"] as const;
  return keys.map((key) => ({
    key,
    total: overrides[key] ?? 0,
    importance: { high: overrides[key] ?? 0, mid: 0, low: 0 },
  }));
}

beforeEach(() => {
  calls = [];
  summary = {
    scope: { folderId: "f-root", memberIds: [] },
    asOf: "2026-11-02T00:00:00.000Z",
    buckets: {
      done: { total: 2, importance: { high: 1, mid: 1, low: 0 } },
      gt50: { total: 3, importance: { high: 0, mid: 2, low: 1 } },
      lt50: { total: 1, importance: { high: 1, mid: 0, low: 0 } },
    },
  };
  due = { bucket: "gt50", asOf: "2026-11-02T00:00:00.000Z", buckets: makeDue({ overdue: 1, week: 2 }) };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, query: url.search });
    if (url.pathname === "/api/v1/admin/members") {
      return jsonResponse(200, {
        items: [
          { id: "m-a", name: "陈晨", role: "前端", color: "#2f6fe0", archivedAt: null, counts: { owned: 0, collaborated: 0 }, shareLink: null },
          { id: "m-b", name: "林悦", role: "后端", color: "#e05a2f", archivedAt: null, counts: { owned: 0, collaborated: 0 }, shareLink: null },
          { id: "m-c", name: "旧成员", role: "测试", color: "#8a55c9", archivedAt: "2026-10-01T00:00:00.000Z", counts: { owned: 0, collaborated: 0 }, shareLink: null },
        ],
      });
    }
    if (url.pathname.endsWith("/dashboard/summary")) return jsonResponse(200, summary);
    if (url.pathname.endsWith("/dashboard/due-distribution")) return jsonResponse(200, due);
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "未知", requestId: "r" } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountPanel(props: { access: "admin" | "share"; folderId: string | null }) {
  const wrapper = mount(DashboardPanel, {
    props,
    global: { plugins: [[VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
  });
  await nextTick();
  return wrapper;
}

describe("情况看板（05 §5.1–5.2）", () => {
  it("三统计卡显示总数与高/中/低计数，管理员可见成员 chips（归档成员不出现）", async () => {
    const wrapper = await mountPanel({ access: "admin", folderId: "f-root" });
    await vi.waitFor(() => expect(wrapper.text()).toContain("已完成"));

    const cards = wrapper.findAll(".stat-card");
    expect(cards).toHaveLength(3);
    expect(cards[0]!.text()).toContain("2");
    expect(cards[0]!.text()).toContain("高");
    expect(cards[1]!.text()).toContain("3");
    expect(cards[2]!.text()).toContain("1");

    const chips = wrapper.findAll(".mchip");
    // chip 内含头像首字（aria-hidden），断言姓名而不是精确文本。
    expect(chips).toHaveLength(2);
    expect(chips[0]!.text()).toContain("陈晨");
    expect(chips[1]!.text()).toContain("林悦");
    wrapper.unmount();
  });

  it("点击卡片展开分布：请求 bucket 并渲染 4 个桶与堆叠柱", async () => {
    const wrapper = await mountPanel({ access: "admin", folderId: "f-root" });
    await vi.waitFor(() => expect(wrapper.findAll(".stat-card")).toHaveLength(3));

    await wrapper.findAll(".stat-card")[1]!.trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".chart").exists()).toBe(true));

    const dueCall = calls.find((call) => call.path.endsWith("/dashboard/due-distribution"));
    expect(dueCall?.query).toContain("bucket=gt50");
    expect(dueCall?.query).toContain("folderId=f-root");

    expect(wrapper.findAll(".chart-col")).toHaveLength(4);
    expect(wrapper.find(".chart").text()).toContain("已逾期");
    expect(wrapper.find(".chart").text()).toContain("一周内");
    expect(wrapper.find(".chart").text()).toContain("一月内");
    expect(wrapper.find(".chart").text()).toContain("一月后");
    expect(wrapper.findAll(".chart-bar .seg.high").length).toBeGreaterThan(0);

    // 再点一次收起。
    await wrapper.findAll(".stat-card")[1]!.trigger("click");
    await nextTick();
    expect(wrapper.find(".chart").exists()).toBe(false);
    wrapper.unmount();
  });

  it("成员筛选：点击 chip 后 summary 请求带 memberIds，可多选", async () => {
    const wrapper = await mountPanel({ access: "admin", folderId: "f-root" });
    await vi.waitFor(() => expect(wrapper.findAll(".mchip")).toHaveLength(2));

    await wrapper.findAll(".mchip")[0]!.trigger("click");
    await vi.waitFor(() => {
      const call = calls.filter((item) => item.path.endsWith("/dashboard/summary")).at(-1);
      expect(call?.query).toContain("memberIds=m-a");
    });

    await wrapper.findAll(".mchip")[1]!.trigger("click");
    await vi.waitFor(() => {
      const call = calls.filter((item) => item.path.endsWith("/dashboard/summary")).at(-1);
      expect(call?.query).toContain("memberIds=m-a%2Cm-b");
    });
    wrapper.unmount();
  });

  it("分享域：不渲染成员 chips，只请求 share 端点且不带 memberIds", async () => {
    const wrapper = await mountPanel({ access: "share", folderId: "f-root" });
    await vi.waitFor(() => expect(wrapper.findAll(".stat-card")).toHaveLength(3));

    expect(wrapper.findAll(".mchip")).toHaveLength(0);
    const summaryCall = calls.find((call) => call.path.endsWith("/share/dashboard/summary"));
    expect(summaryCall).toBeTruthy();
    expect(summaryCall?.query).not.toContain("memberIds");
    wrapper.unmount();
  });

  it("空集合：分布图显示原型空态文案", async () => {
    due = { bucket: "done", asOf: "2026-11-02T00:00:00.000Z", buckets: makeDue() };
    const wrapper = await mountPanel({ access: "admin", folderId: "f-root" });
    await vi.waitFor(() => expect(wrapper.findAll(".stat-card")).toHaveLength(3));

    await wrapper.findAll(".stat-card")[0]!.trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("该集合暂无任务"));
    expect(wrapper.find(".chart").exists()).toBe(false);
    wrapper.unmount();
  });

  it("未选择任务夹：显示先选择任务夹，不发看板请求", async () => {
    const wrapper = await mountPanel({ access: "admin", folderId: null });
    await nextTick();
    expect(wrapper.text()).toContain("先选择任务夹");
    expect(calls.some((call) => call.path.includes("/dashboard/"))).toBe(false);
    wrapper.unmount();
  });
});
