// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PaneResizer from "../../apps/web/src/components/ui/PaneResizer.vue";

describe("PaneResizer（原型 tree-resizer / task-pane-resizer 的组件化）", () => {
  it("role=separator 与 aria 三值 + 键盘提示", () => {
    const wrapper = mount(PaneResizer, {
      props: { label: "调整任务树宽度", min: 220, max: 480, modelValue: 340 },
    });
    const el = wrapper.find('[role="separator"]');
    expect(el.attributes("aria-orientation")).toBe("vertical");
    expect(el.attributes("aria-valuemin")).toBe("220");
    expect(el.attributes("aria-valuemax")).toBe("480");
    expect(el.attributes("aria-valuenow")).toBe("340");
    expect(el.attributes("tabindex")).toBe("0");
  });

  it("左右方向键 ±2，Home/End 到边界", async () => {
    const wrapper = mount(PaneResizer, {
      props: { label: "x", min: 220, max: 480, modelValue: 340 },
    });
    const el = () => wrapper.find('[role="separator"]');
    await el().trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe(342);
    await wrapper.setProps({ modelValue: 342 });
    await el().trigger("keydown", { key: "Home" });
    expect(wrapper.emitted("update:modelValue")?.[1]?.[0]).toBe(220);
    await wrapper.setProps({ modelValue: 220 });
    await el().trigger("keydown", { key: "End" });
    expect(wrapper.emitted("update:modelValue")?.[2]?.[0]).toBe(480);
  });

  it("更新事件携带钳制后的值", async () => {
    const wrapper = mount(PaneResizer, {
      props: { label: "x", min: 220, max: 480, modelValue: 340 },
    });
    await wrapper.find('[role="separator"]').trigger("keydown", { key: "ArrowLeft" });
    const emitted = wrapper.emitted("update:modelValue")?.[0]?.[0];
    expect(emitted).toBe(338);
  });
});
