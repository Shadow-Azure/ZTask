// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearPreferences, readPreference, writePreference } from "../../apps/web/src/lib/preferences";

beforeEach(() => {
  localStorage.clear();
  clearPreferences();
});

describe("preferences（localStorage 只存布局偏好）", () => {
  it("白名单键可写可读", () => {
    writePreference("treeWidth", 360);
    expect(readPreference("treeWidth")).toBe(360);
  });

  it("非白名单键拒绝写入（业务数据不落 localStorage）", () => {
    expect(() => writePreference("tasks" as never, [{ id: "t" }])).toThrow();
    expect(() => writePreference("shareToken" as never, "secret")).toThrow();
  });

  it("数值键做边界钳制", () => {
    writePreference("treeWidth", 100);
    expect(readPreference("treeWidth")).toBe(220);
    writePreference("treeWidth", 9999);
    expect(readPreference("treeWidth")).toBe(480);
  });

  it("缺失键返回 null；清除后为空", () => {
    expect(readPreference("treeWidth")).toBeNull();
    writePreference("subtaskPanePercent", 42);
    clearPreferences();
    expect(readPreference("subtaskPanePercent")).toBeNull();
  });
});
