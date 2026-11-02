// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "../../apps/web/src/App.vue";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";

async function mountAt(path: string) {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, {
    global: {
      plugins: [router, [VueQueryPlugin, { queryClient: createAppQueryClient() }]],
    },
  });
  await nextTick();
  return { wrapper, router };
}

describe("路由与访问模式（03 §2）", () => {
  it("管理壳：事项跟踪/成员管理导航齐全，跟踪页渲染管理控件", async () => {
    const { wrapper } = await mountAt("/tracker");
    const nav = wrapper.find('[aria-label="管理导航"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("事项跟踪");
    expect(nav.text()).toContain("成员管理");
    expect(wrapper.text()).toContain("＋ 新建任务夹");
    expect(wrapper.text()).toContain("＋ 新建任务");
    wrapper.unmount();
  });

  it("根路径重定向到 /tracker", async () => {
    const { router } = await mountAt("/");
    expect(router.currentRoute.value.path).toBe("/tracker");
  });

  it("成员壳：只有成员个人页/事项跟踪，绝不出现成员管理", async () => {
    const { wrapper } = await mountAt("/s/home");
    const nav = wrapper.find('[aria-label="成员导航"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("成员个人页");
    expect(nav.text()).toContain("事项跟踪");
    expect(nav.text()).not.toContain("成员管理");
    expect(wrapper.text()).not.toContain("＋ 添加成员");
    expect(wrapper.text()).toContain("你好，成员");
    wrapper.unmount();
  });

  it("成员只读跟踪页：不渲染任何新建控件", async () => {
    const { wrapper } = await mountAt("/s/tracker");
    expect(wrapper.text()).not.toContain("＋ 新建任务夹");
    expect(wrapper.text()).not.toContain("＋ 新建任务");
    expect(wrapper.text()).toContain("只读视图");
    wrapper.unmount();
  });

  it("分享令牌页：token 掩码显示，原始 token 不出现在 DOM", async () => {
    const token = "abcdef1234567890xyz";
    const { wrapper } = await mountAt(`/s/${token}`);
    expect(wrapper.text()).toContain("abcd••••0xyz");
    expect(wrapper.text()).toContain("（长度 19）");
    expect(wrapper.text()).not.toContain(token);
    wrapper.unmount();
  });

  it("失效链接页：无任何业务导航", async () => {
    const { wrapper } = await mountAt("/share-invalid");
    expect(wrapper.text()).toContain("链接已失效");
    expect(wrapper.find('[aria-label="管理导航"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="成员导航"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("未知路径重定向到 /tracker", async () => {
    const { router } = await mountAt("/no-such-page");
    expect(router.currentRoute.value.path).toBe("/tracker");
  });
});
