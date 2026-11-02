// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PaneResizer from "../../apps/web/src/components/ui/PaneResizer.vue";

function pointerEvent(type: string, clientX: number): PointerEvent {
  return new PointerEvent(type, { clientX, button: 0, bubbles: true });
}

describe("PaneResizer 指针拖拽（原型拖拽语义）", () => {
  it("pointerdown 后 pointermove 发出 drag(clientX)，pointerup 结束并移除 dragging 类", async () => {
    const wrapper = mount(PaneResizer, {
      props: { label: "调整任务树宽度", min: 220, max: 480, modelValue: 340 },
      attachTo: document.body,
    });
    const el = wrapper.find('[role="separator"]');
    el.element.dispatchEvent(pointerEvent("pointerdown", 300));
    await nextTick2();
    expect(el.classes()).toContain("dragging");

    el.element.dispatchEvent(pointerEvent("pointermove", 340));
    await nextTick2();
    expect(wrapper.emitted("drag")?.[0]).toEqual([340]);

    el.element.dispatchEvent(pointerEvent("pointerup", 340));
    await nextTick2();
    await nextTick2();
    expect(el.classes()).not.toContain("dragging");
    expect(wrapper.emitted("dragend")).toBeTruthy();
    wrapper.unmount();
  });

  it("非主键按下不进入拖拽", async () => {
    const wrapper = mount(PaneResizer, {
      props: { label: "x", min: 220, max: 480, modelValue: 340 },
      attachTo: document.body,
    });
    const el = wrapper.find('[role="separator"]');
    el.element.dispatchEvent(new PointerEvent("pointerdown", { clientX: 300, button: 2, bubbles: true }));
    expect(el.classes()).not.toContain("dragging");
    wrapper.unmount();
  });

  async function nextTick2(): Promise<void> {
    const { nextTick } = await import("vue");
    await nextTick();
  }
});
