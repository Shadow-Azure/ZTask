// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";
import ChangesPanel from "../../apps/web/src/features/history/ChangesPanel.vue";
import type { DashboardChanges, MemberSummary } from "@ztask/shared";

/**
 * 时间段历史面板（05 §5.3、08 §4.2–4.3，原型 636–660/1465–1560）：
 * 默认区间、自定义查询参数、边界展示、创建/删除徽章、展开折叠、空态与文本安全。
 */

const MEMBER: MemberSummary = { id: "m-a", name: "陈晨", role: "前端", color: "#2f6fe0" };
const originalFetch = globalThis.fetch;
let calls: Array<{ path: string; query: URLSearchParams }>;
let response: DashboardChanges;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function change(overrides: Partial<DashboardChanges["items"][number]> = {}): DashboardChanges["items"][number] {
  return {
    taskId: "t-1",
    description: "任务一",
    owners: [MEMBER],
    before: { progress: 40, detail: "旧详情", recordedAt: "2026-11-01T02:00:00.000Z" },
    after: { progress: 70, detail: "旧详情\n新增一行", recordedAt: "2026-11-01T06:00:00.000Z" },
    changeKind: "updated",
    currentlyDeleted: false,
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  response = {
    start: "2026-11-01T00:00:00.000Z",
    end: "2026-11-02T00:00:00.000Z",
    timeZone: "Asia/Shanghai",
    items: [
      change(),
      change({
        taskId: "t-2",
        description: "区间内创建",
        before: null,
        after: { progress: 10, detail: "新建详情", recordedAt: "2026-11-01T03:00:00.000Z" },
        changeKind: "created",
      }),
      change({
        taskId: "t-3",
        description: "当前已删除",
        before: { progress: 20, detail: "删前", recordedAt: "2026-11-01T01:00:00.000Z" },
        after: { progress: 20, detail: "删前", recordedAt: "2026-11-01T05:00:00.000Z" },
        changeKind: "deleted",
        currentlyDeleted: true,
      }),
    ],
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, query: url.searchParams });
    return jsonResponse(200, response);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountPanel(props: Partial<{ access: "admin" | "share"; folderId: string | null; memberIds: string[] }> = {}) {
  const wrapper = mount(ChangesPanel, {
    props: { access: "admin", folderId: "f-root", memberIds: [], ...props },
    global: { plugins: [[VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
  });
  await nextTick();
  return wrapper;
}

describe("ChangesPanel（05 §5.3、08 §4.2–4.3）", () => {
  it("默认查询 mode=default，展示服务端返回的时间边界", async () => {
    const wrapper = await mountPanel();
    await vi.waitFor(() => expect(wrapper.text()).toContain("任务一"));

    const call = calls.find((item) => item.path.endsWith("/admin/dashboard/changes"));
    expect(call?.query.get("mode")).toBe("default");
    expect(call?.query.get("folderId")).toBe("f-root");

    // 服务端边界按 manifest 时区渲染（上海 = UTC+8）。
    expect(wrapper.find(".range-status").text()).toContain("2026-11-01 08:00");
    expect(wrapper.find(".range-status").text()).toContain("2026-11-02 08:00");
    wrapper.unmount();
  });

  it("变化行展示创建/已删除徽章、进度变化与行级增删统计，已删除项按服务端顺序置底", async () => {
    const wrapper = await mountPanel();
    await vi.waitFor(() => expect(wrapper.findAll(".chg-row")).toHaveLength(3));

    const rows = wrapper.findAll(".chg-row");
    expect(rows[1]!.text()).toContain("区间内创建");
    expect(rows[2]!.text()).toContain("当前已删除");
    expect(rows[0]!.text()).toContain("40% → 70%");
    expect(rows[0]!.find(".dstat .a").text()).toBe("+1");
    expect(rows[0]!.find(".dstat .d").text()).toBe("−0");
    wrapper.unmount();
  });

  it("默认展开：点击行折叠，批量折叠/展开生效", async () => {
    const wrapper = await mountPanel();
    await vi.waitFor(() => expect(wrapper.findAll(".chg-item")).toHaveLength(3));
    expect(wrapper.findAll(".diff-wrap")).toHaveLength(3);

    await wrapper.findAll(".chg-row")[0]!.trigger("click");
    await nextTick();
    expect(wrapper.findAll(".diff-wrap")).toHaveLength(2);

    await wrapper.findAll(".chg-actions button").find((button) => button.text() === "全部折叠")!.trigger("click");
    await nextTick();
    expect(wrapper.findAll(".diff-wrap")).toHaveLength(0);

    await wrapper.findAll(".chg-actions button").find((button) => button.text() === "全部展开")!.trigger("click");
    await nextTick();
    expect(wrapper.findAll(".diff-wrap")).toHaveLength(3);
    wrapper.unmount();
  });

  it("自定义日期：提交 startDate/endDate，非法顺序不发请求", async () => {
    const wrapper = await mountPanel();
    await vi.waitFor(() => expect(wrapper.text()).toContain("任务一"));

    await wrapper.findAll("input[type='date']")[0]!.setValue("2026-11-03");
    await wrapper.findAll("input[type='date']")[1]!.setValue("2026-11-01");
    await wrapper.findAll("button").find((button) => button.text() === "查询")!.trigger("click");
    await nextTick();
    expect(wrapper.text()).toContain("开始日期不能晚于结束日期");
    expect(calls.filter((item) => item.query.get("mode") === "custom")).toHaveLength(0);

    await wrapper.findAll("input[type='date']")[0]!.setValue("2026-11-01");
    await wrapper.findAll("input[type='date']")[1]!.setValue("2026-11-03");
    await wrapper.findAll("button").find((button) => button.text() === "查询")!.trigger("click");
    await vi.waitFor(() => {
      const call = calls.filter((item) => item.query.get("mode") === "custom").at(-1);
      expect(call?.query.get("startDate")).toBe("2026-11-01");
      expect(call?.query.get("endDate")).toBe("2026-11-03");
    });
    wrapper.unmount();
  });

  it("空结果：展示无变化空态", async () => {
    response = { ...response, items: [] };
    const wrapper = await mountPanel();
    await vi.waitFor(() => expect(wrapper.text()).toContain("没有进展变化"));
    expect(wrapper.findAll(".chg-row")).toHaveLength(0);
    wrapper.unmount();
  });

  it("文本安全：详情里的脚本标签只作为文本渲染，不生成 DOM 节点", async () => {
    response = {
      ...response,
      items: [
        change({
          after: { progress: 70, detail: "<script>alert(1)</script>", recordedAt: "2026-11-01T06:00:00.000Z" },
        }),
      ],
    };
    const wrapper = await mountPanel();
    await vi.waitFor(() => expect(wrapper.findAll(".chg-row")).toHaveLength(1));

    expect(wrapper.find(".diff-wrap").text()).toContain("<script>alert(1)</script>");
    expect(document.querySelector(".diff-wrap script")).toBeNull();
    expect(wrapper.html()).toContain("&lt;script&gt;");
    wrapper.unmount();
  });

  it("分享域：请求 share 端点并携带成员筛选", async () => {
    const wrapper = await mountPanel({ access: "share", memberIds: ["m-a"] });
    await vi.waitFor(() => expect(wrapper.text()).toContain("任务一"));

    const call = calls.find((item) => item.path.endsWith("/share/dashboard/changes"));
    expect(call).toBeTruthy();
    expect(call?.query.get("memberIds")).toBe("m-a");
    wrapper.unmount();
  });
});
