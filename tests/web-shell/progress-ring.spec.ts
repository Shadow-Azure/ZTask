// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ProgressRing from "../../apps/web/src/components/ui/ProgressRing.vue";

describe("ProgressRing（原型 subtask-progress-ring 的组件化）", () => {
  it("渲染 role=progressbar 与 aria 值/标签", () => {
    const wrapper = mount(ProgressRing, { props: { value: 40, label: "树节点拖拽交互" } });
    const ring = wrapper.find('[role="progressbar"]');
    expect(ring.attributes("aria-valuemin")).toBe("0");
    expect(ring.attributes("aria-valuemax")).toBe("100");
    expect(ring.attributes("aria-valuenow")).toBe("40");
    expect(ring.attributes("aria-label")).toBe("树节点拖拽交互，进度 40%");
  });

  it("文本显示百分比；100% 带 done 类", () => {
    const done = mount(ProgressRing, { props: { value: 100, label: "x" } });
    expect(done.text()).toContain("100%");
    expect(done.find(".ring-value").classes()).toContain("done");
    expect(done.find("text").classes()).toContain("ring-text");
  });

  it("数值钳制到 0–100", () => {
    const over = mount(ProgressRing, { props: { value: 250, label: "x" } });
    expect(over.find('[role="progressbar"]').attributes("aria-valuenow")).toBe("100");
  });
});
