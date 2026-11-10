// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createAppRouter } from "../../apps/web/src/router";
import MemberTable from "../../apps/web/src/features/members/MemberTable.vue";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";

const MEMBERS = {
  items: [
    {
      id: "m-1",
      name: "陈晨",
      role: "前端工程师",
      color: "#2f6fe0",
      isAdmin: true,
      archivedAt: null,
      counts: { owned: 2, collaborated: 1 },
      shareLink: null,
    },
    {
      id: "m-2",
      name: "林悦",
      role: "",
      color: "#1f9d6b",
      isAdmin: false,
      archivedAt: "2026-11-01T00:00:00.000Z",
      counts: { owned: 0, collaborated: 0 },
      shareLink: null,
    },
  ],
};

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function mockFetch(): void {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    const url = String(input);
    if (url.includes("/admin/members") && !url.includes("/m-")) {
      return new Response(JSON.stringify(MEMBERS), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/admin/members/m-1") && init?.method === "PATCH") {
      return new Response(JSON.stringify(MEMBERS.items[0]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/admin/members/m-1") && init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function mountTable() {
  const wrapper = mount(MemberTable, {
    global: { plugins: [createAppRouter(), [VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
    attachTo: document.body,
  });
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await nextTick();
  return wrapper;
}

describe("MemberTable（features/members，原型 mem-table）", () => {
  it("渲染成员行：头像色/姓名/角色/计数；归档行带标签且无操作", async () => {
    mockFetch();
    const wrapper = await mountTable();
    expect(wrapper.text()).toContain("陈晨");
    expect(wrapper.text()).toContain("前端工程师");
    // 管理员权限徽标只出现在有权限的成员行。
    expect(wrapper.text()).toContain("管理员");
    expect(wrapper.find(".admin-tag").exists()).toBe(true);
    expect(wrapper.find(".count + .count, .col-count").exists()).toBe(true);
    // m4 #20：分享链接列不再占位，未生成时显示状态 + 生成入口（ShareLinkCell）。
    expect(wrapper.text()).toContain("未生成");
    expect(wrapper.text()).toContain("生成链接");

    const archivedRow = wrapper.find("tr.archived");
    expect(archivedRow.exists()).toBe(true);
    expect(archivedRow.text()).toContain("已归档");
    expect(archivedRow.find(".link-btn").exists()).toBe(false);
    wrapper.unmount();
  });

  it("添加成员：打开浮窗 → 校验空姓名靠近字段报错 → 填写后发送 POST", async () => {
    mockFetch();
    const wrapper = await mountTable();
    // D9：「＋ 添加成员」入口由 MembersPage 标题行承载，表格组件经 defineExpose 暴露打开方法。
    (wrapper.vm as unknown as { openCreate: () => void }).openCreate();
    await nextTick();
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();

    const nameInput = dialog.querySelector("#member-name") as HTMLInputElement;
    nameInput.value = "";
    (dialog.querySelector(".btn.primary") as HTMLButtonElement).click();
    await nextTick();
    expect(dialog.textContent).toContain("姓名不能为空");

    nameInput.value = "王砚";
    nameInput.dispatchEvent(new Event("input"));
    const roleInput = dialog.querySelector("#member-role") as HTMLInputElement;
    roleInput.value = "后端";
    roleInput.dispatchEvent(new Event("input"));
    const adminInput = dialog.querySelector("#member-admin") as HTMLInputElement;
    expect(adminInput.checked).toBe(false);
    adminInput.click();
    await nextTick();
    (dialog.querySelector(".btn.primary") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const post = fetchCalls.find((call) => call.init?.method === "POST");
    expect(post?.url).toContain("/admin/members");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ name: "王砚", role: "后端", color: "#2f6fe0", isAdmin: true });
    wrapper.unmount();
  });

  it("编辑成员：管理员权限勾选状态回填，取消勾选后 PATCH isAdmin=false", async () => {
    mockFetch();
    const wrapper = await mountTable();
    const editButton = wrapper.findAll(".mini-btn").find((button) => button.text() === "编辑");
    await editButton!.trigger("click");
    await nextTick();
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const adminInput = dialog.querySelector("#member-admin") as HTMLInputElement;
    expect(adminInput.checked).toBe(true);

    adminInput.click();
    await nextTick();
    (dialog.querySelector(".btn.primary") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const patch = fetchCalls.find((call) => call.init?.method === "PATCH");
    expect(patch?.url).toContain("/admin/members/m-1");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      name: "陈晨",
      role: "前端工程师",
      color: "#2f6fe0",
      isAdmin: false,
    });
    wrapper.unmount();
  });

  it("归档：确认弹窗含影响说明，确认后发送 DELETE", async () => {
    mockFetch();
    const wrapper = await mountTable();
    await wrapper.findAll(".mini-btn.red")[0]!.trigger("click");
    await nextTick();
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("立即失效");
    expect(dialog.textContent).toContain("待分配");

    (dialog.querySelector(".btn.danger-btn") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const removed = fetchCalls.find((call) => call.init?.method === "DELETE");
    expect(removed?.url).toContain("/admin/members/m-1");
    wrapper.unmount();
  });
});
