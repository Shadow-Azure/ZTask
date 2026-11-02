import { reactive } from "vue";

/** 单条 toast；同文案去重，自动消失。 */
export interface ToastItem {
  id: number;
  text: string;
}

let nextId = 1;

/** 模块级单例状态：ToastHost 渲染，任意组件通过 useToast().show 提示。 */
const state = reactive<{ items: ToastItem[] }>({ items: [] });

function dismiss(id: number): void {
  const index = state.items.findIndex((item) => item.id === id);
  if (index >= 0) state.items.splice(index, 1);
}

/**
 * 轻提示（原型 toast 的组件化）：成功/操作反馈统一入口。
 * @returns show：显示一条提示；同文案已存在时只保留一条并重置计时。
 */
export function useToast(): { show: (text: string) => void } {
  return {
    show(text: string): void {
      const existing = state.items.find((item) => item.text === text);
      if (existing) {
        dismiss(existing.id);
      }
      const id = nextId++;
      state.items.push({ id, text });
      // 原型 `.toast` 2.2s 后淡出（R6-D1：配置值与原型一致）。
      setTimeout(() => dismiss(id), 2200);
    },
  };
}

/** 清空全部提示（测试与登出场景使用）。 */
export function clearToasts(): void {
  state.items.splice(0);
}

/** 供 ToastHost 读取的响应式状态。
 * @returns 响应式的提示列表。
 */
export function toastState(): { items: ToastItem[] } {
  return state;
}