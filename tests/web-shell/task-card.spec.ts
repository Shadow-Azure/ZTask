// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TaskCard from "../../apps/web/src/components/TaskCard.vue";
import type { TaskCardModel } from "../../apps/web/src/components/task-card-model";

function model(overrides: Partial<TaskCardModel> = {}): TaskCardModel {
  return {
    id: "t-1",
    description: "任务树组件重构",
    folderName: "2026 Q4 迭代",
    owners: ["陈晨", "林悦"],
    importance: "high",
    dueDate: "2099-01-01",
    progress: 70,
    detail: "完成树组件基础结构搭建\n节点展开/收起完成",
    subtasks: [
      { id: "s-1", description: "树节点拖拽交互", progress: 100, ownerName: "陈晨" },
      { id: "s-2", description: "大数据量虚拟滚动", progress: 40, ownerName: "林悦" },
    ],
    ...overrides,
  };
}

describe("TaskCard（统一只读卡）", () => {
  it("渲染标题/负责人/重要度/预计完成与总进度", () => {
    const wrapper = mount(TaskCard, { props: { task: model() } });
    expect(wrapper.text()).toContain("任务树组件重构");
    expect(wrapper.text()).toContain("陈晨、林悦");
    expect(wrapper.text()).toContain("高重要");
    expect(wrapper.text()).toContain("70%");
    expect(wrapper.find(".fill").attributes("style")).toContain("70%");
  });

  it("小任务进展环与空态、详情行数与空态", () => {
    const full = mount(TaskCard, { props: { task: model() } });
    expect(full.findAll('[role="progressbar"]').length).toBe(2);
    expect(full.text()).toContain("1/2 已完成");

    const empty = mount(TaskCard, {
      props: { task: model({ subtasks: [], detail: "" }) },
    });
    expect(empty.text()).toContain("暂无小任务");
    expect(empty.text()).toContain("暂无进展详情");
    expect(empty.text()).toContain("0 条记录");
  });

  it("只读：卡内不存在任何编辑控件", () => {
    const wrapper = mount(TaskCard, { props: { task: model() } });
    expect(wrapper.findAll("button").length).toBe(0);
    expect(wrapper.findAll("input").length).toBe(0);
    expect(wrapper.findAll("textarea").length).toBe(0);
  });

  it("逾期标记（截止日早于今天且未完成）", () => {
    const overdue = mount(TaskCard, { props: { task: model({ dueDate: "2001-01-01" }) } });
    expect(overdue.find(".due").classes()).toContain("overdue");
    expect(overdue.text()).toContain("已逾期");

    const doneInTime = mount(TaskCard, { props: { task: model({ dueDate: "2001-01-01", progress: 100 }) } });
    expect(doneInTime.find(".due").classes()).not.toContain("overdue");
  });

  it("头部键盘 Enter/Space 触发 open，携带任务 ID", async () => {
    const wrapper = mount(TaskCard, { props: { task: model() } });
    await wrapper.find(".card-head").trigger("keydown", { key: "Enter" });
    await wrapper.find(".card-head").trigger("keydown", { key: " " });
    await wrapper.find(".card-head").trigger("click");
    const opens = wrapper.emitted("open");
    expect(opens?.length).toBe(3);
    expect(opens?.[0]).toEqual(["t-1"]);
  });

  it("无负责人时显示待分配；文件夹路径为可选", () => {
    const wrapper = mount(TaskCard, {
      props: { task: model({ owners: [], folderName: undefined }) },
    });
    expect(wrapper.text()).toContain("待分配");
    expect(wrapper.find(".folder").exists()).toBe(false);
  });
});
