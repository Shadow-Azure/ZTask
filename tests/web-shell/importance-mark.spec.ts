// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ImportanceMark from "../../apps/web/src/components/ui/ImportanceMark.vue";

describe("ImportanceMark（重要度点标 + 文字标：颜色与文本双通道）", () => {
  it("dot 与文字标签都用重要度定类", () => {
    const wrapper = mount(ImportanceMark, { props: { importance: "high" } });
    expect(wrapper.find(".imp-dot.high").exists()).toBe(true);
    expect(wrapper.find(".imp.high").text()).toBe("高重要");
  });

  it("mid/low 各自定类", () => {
    expect(mount(ImportanceMark, { props: { importance: "mid" } }).find(".imp-dot.mid").exists()).toBe(true);
    expect(mount(ImportanceMark, { props: { importance: "low" } }).find(".imp.low").text()).toBe("低重要");
  });

  it("只渲染 dot 模式（树/成员视图场景）", () => {
    const wrapper = mount(ImportanceMark, { props: { importance: "high", dotOnly: true } });
    expect(wrapper.find(".imp").exists()).toBe(false);
    expect(wrapper.find(".imp-dot.high").exists()).toBe(true);
  });
});
