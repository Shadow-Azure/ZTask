// @vitest-environment jsdom
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import BaseDialog from "../../apps/web/src/components/ui/BaseDialog.vue";
import { clearToasts, useToast } from "../../apps/web/src/components/ui/toast";
import ToastHost from "../../apps/web/src/components/ui/ToastHost.vue";

function dialogElement(): HTMLElement {
  return document.body.querySelector('[role="dialog"]') as HTMLElement;
}

function pressKey(key: string, shift = false): void {
  dialogElement().dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
  clearToasts();
});

describe("BaseDialog（teleport + focus trap + Escape）", () => {
  it("teleport 到 body 且渲染标题与内容", () => {
    const wrapper = mount(BaseDialog, {
      attachTo: document.body,
      props: { open: true, title: "任务详情" },
      slots: { default: "<p>正文</p>" },
    });
    const dialog = dialogElement();
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector("h3")?.textContent).toBe("任务详情");
    expect(dialog.textContent).toContain("正文");
    wrapper.unmount();
  });

  it("Escape 发出 close", async () => {
    const wrapper = mount(BaseDialog, {
      attachTo: document.body,
      props: { open: true, title: "x" },
      slots: { default: "<button type='button'>占位</button>" },
    });
    await nextTick();
    pressKey("Escape");
    await nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("Shift+Tab 从首元素回绕到末元素（焦点被困）", async () => {
    const wrapper = mount(BaseDialog, {
      attachTo: document.body,
      props: { open: true, title: "x" },
      slots: {
        default: "<button type='button' id='in-1'>内一</button><button type='button' id='in-2'>内二</button>",
      },
    });
    await nextTick();
    const in2 = document.querySelector("#in-2") as HTMLElement;
    // 焦点在首元素（浮窗关闭按钮）时 Shift+Tab 应回绕到末元素
    (dialogElement().querySelector(".icon-btn") as HTMLElement).focus();
    pressKey("Tab", true);
    void in2;
    await nextTick();
    expect(document.activeElement).toBe(in2);
    wrapper.unmount();
  });

  it("关闭时焦点归还触发元素", async () => {
    const opener = document.createElement("button");
    opener.textContent = "打开";
    document.body.append(opener);
    opener.focus();

    const wrapper = mount(BaseDialog, {
      attachTo: document.body,
      props: { open: false, title: "x" },
      slots: { default: "<button type='button'>占位</button>" },
    });
    await wrapper.setProps({ open: true });
    await nextTick();
    expect(dialogElement().contains(document.activeElement)).toBe(true);

    await wrapper.setProps({ open: false });
    await nextTick();
    expect(document.activeElement).toBe(opener);
    wrapper.unmount();
    opener.remove();
  });
});

describe("ToastHost + useToast", () => {
  function mountHost() {
    return mount(ToastHost);
  }

  it("show 显示消息（aria-live 区域）", async () => {
    const wrapper = mountHost();
    useToast().show("已保存任务");
    await wrapper.vm.$nextTick();
    const host = wrapper.find('[aria-live="polite"]');
    expect(host.exists()).toBe(true);
    expect(host.text()).toContain("已保存任务");
    wrapper.unmount();
  });

  it("同一消息只保留一条，2.4 秒后自动消失（假定时器）", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountHost();
      useToast().show("A");
      await wrapper.vm.$nextTick();
      useToast().show("A");
      await wrapper.vm.$nextTick();
      expect(wrapper.findAll(".toast-item").length).toBe(1);
      vi.advanceTimersByTime(2500);
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".toast-item").exists()).toBe(false);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
