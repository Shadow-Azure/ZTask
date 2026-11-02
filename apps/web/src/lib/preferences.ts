/**
 * 本机布局偏好（03 §4 状态归属）：localStorage 只允许白名单内的布局键，
 * 任务、成员、token 等业务数据一律不得落盘——这是隐私边界的机械执行。
 */

const PREFIX = "ztask:pref:";

/** 允许进入 localStorage 的偏好键及其取值约束。 */
const PREFERENCE_KEYS = {
  treeWidth: { min: 220, max: 480 },
  subtaskPanePercent: { min: 26, max: 55 },
} as const;

/** 白名单偏好键名（treeWidth / subtaskPanePercent）。 */
export type PreferenceKey = keyof typeof PREFERENCE_KEYS;

function clamp(key: PreferenceKey, value: number): number {
  const bounds = PREFERENCE_KEYS[key];
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * 读取数值偏好；缺失或损坏返回 null。
 * @param key 白名单偏好键。
 * @returns 钳制后的数值；缺失或损坏为 null。
 */
export function readPreference(key: PreferenceKey): number | null {
  const raw = localStorage.getItem(PREFIX + key);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return clamp(key, parsed);
}

/**
 * 写入数值偏好（先钳制到合法区间）。
 * @param key 白名单偏好键。
 * @param value 数值。
 * @throws Error 键不在白名单内（防止业务数据误入 localStorage）。
 */
export function writePreference(key: PreferenceKey, value: number): void {
  if (!(key in PREFERENCE_KEYS)) {
    throw new Error(`非白名单偏好键，拒绝写入 localStorage：${String(key)}`);
  }
  localStorage.setItem(PREFIX + key, String(clamp(key, value)));
}

/** 清空全部偏好（登出/重置场景使用）。 */
export function clearPreferences(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
  }
}
