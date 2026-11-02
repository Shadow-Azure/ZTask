// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import TrackerPage from "../../apps/web/src/pages/TrackerPage.vue";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";

async function mountTracker(props: { access?: "admin" | "readonly" }, query: Record<string, string> = {}) {
  const router = createAppRouter();
  await router.push({ path: "/tracker", query });
  await router.isReady();
  const wrapper = mount(TrackerPage, {
    props,
    global: {
      plugins: [router, [VueQueryPlugin, { queryClient: createAppQueryClient() }]],
    },
  });
  await nextTick();
  return { wrapper, router };
}

describe("TrackerPage 结构与权限体验", () => {
  it("admin：树侧 + 拖柄 + 面板齐备，含新建控件与真实任务夹树", async () => {
    const { wrapper } = await mountTracker({ access: "admin" });
    expect(wrapper.find(".tree-side").exists()).toBe(true);
    expect(wrapper.find(".folder-tree").exists()).toBe(true);
    expect(wrapper.find('[role="separator"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("＋ 新建任务夹");
    expect(wrapper.text()).toContain("＋ 新建任务");
  });

  it("tab 深链：?tab=dash 切到看板占位", async () => {
    const { wrapper } = await mountTracker({ access: "admin" }, { tab: "dash" });
    expect(wrapper.text()).toContain("情况看板统计与历史变化将在 m5 接入");
    expect(wrapper.find('[role="tab"][aria-selected="true"]').text()).toBe("情况看板");
    wrapper.unmount();
  });

  it("只读模式：无新建控件且显示只读标识", async () => {
    const { wrapper } = await mountTracker({ access: "readonly" });
    expect(wrapper.text()).not.toContain("＋ 新建任务夹");
    expect(wrapper.text()).not.toContain("＋ 新建任务");
    expect(wrapper.text()).toContain("只读视图");
  });

  it("树宽偏好持久化进 localStorage（仅布局键）", async () => {
    localStorage.clear();
    const { wrapper } = await mountTracker({ access: "admin" });
    const resizer = wrapper.find('[role="separator"]');
    await resizer.trigger("keydown", { key: "ArrowRight" });
    await nextTick();
    const stored = localStorage.getItem("ztask:pref:treeWidth");
    expect(stored).not.toBeNull();
    expect(Number(stored)).toBeGreaterThanOrEqual(220);
    wrapper.unmount();
  });
});
