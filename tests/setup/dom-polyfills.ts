// jsdom 26 还没有 PointerEvent；事项跟踪的拖拽测试需要构造指针事件。
// 只补齐构造器，事件语义仍由组件的 pointer 监听器处理；Node 环境跳过。
if (typeof MouseEvent !== "undefined" && typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    readonly width: number;
    readonly height: number;
    readonly pressure: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0;
    }
  }

  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
