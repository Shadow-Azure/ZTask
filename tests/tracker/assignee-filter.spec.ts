// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AssigneeFilter from "../../apps/web/src/features/tracker/AssigneeFilter.vue";
import type { AdminMember } from "@ztask/shared";

const MEMBERS: AdminMember[] = [
  { id: "m-1", name: "陈晨", role: "前端工程师", color: "#2f6fe0", archivedAt: null, counts: { owned: 0, collaborated: 0 }, shareLink: null },
  { id: "m-2", name: "林悦", role: "后端工程师", color: "#1f9d6b", archivedAt: null, counts: { owned: 0, collaborated: 0 }, shareLink: null },
  { id: "m-3", name: "赵敏", role: "产品经理", color: "#8a55c9", archivedAt: null, counts: { owned: 0, collaborated: 0 }, shareLink: null },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AssigneeFilter（负责人多选筛选）", () => {
  it("紧凑触发框显示首个成员与 +N", () => {
    const wrapper = mount(AssigneeFilter, {
      props: { members: MEMBERS, modelValue: ["m-1", "m-2"], ariaLabel: "按负责人筛选" },
      attachTo: document.body,
    });
    expect(wrapper.find(".fsel-trigger").text()).toContain("陈晨");
    expect(wrapper.find(".fsel-trigger").text()).toContain("+1");
    expect(wrapper.find(".fsel-trigger").text()).not.toContain("全部");
    wrapper.unmount();
  });

  it("面板搜索、选项多选与清除发出受控更新", async () => {
    const wrapper = mount(AssigneeFilter, {
      props: { members: MEMBERS, modelValue: [], ariaLabel: "按负责人筛选" },
      attachTo: document.body,
    });
    await wrapper.find(".fsel-trigger").trigger("click");
    expect(wrapper.findAll(".fsel-opt")).toHaveLength(3);
    await wrapper.find(".fsel-search").setValue("林");
    expect(wrapper.findAll(".fsel-opt")).toHaveLength(1);
    await wrapper.find(".fsel-opt").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["m-2"]]);
    wrapper.unmount();
  });

  it("已选时提供清除操作", async () => {
    const wrapper = mount(AssigneeFilter, {
      props: { members: MEMBERS, modelValue: ["m-1"], ariaLabel: "按负责人筛选" },
      attachTo: document.body,
    });
    await wrapper.find(".fsel-trigger").trigger("click");
    await wrapper.find(".fsel-clear").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([[]]);
    wrapper.unmount();
  });
});
