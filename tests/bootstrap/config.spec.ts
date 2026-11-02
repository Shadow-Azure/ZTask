import { describe, expect, it } from "vitest";
import { defaultDataDir, isLoopbackHost, isWildcardHost, validateServeConfig } from "@ztask/server";

describe("defaultDataDir", () => {
  it("ZTASK_HOME 优先于 ~/.ztask", () => {
    expect(defaultDataDir({ ZTASK_HOME: "/tmp/ztask-data" })).toBe("/tmp/ztask-data");
  });

  it("未设置 ZTASK_HOME 时回退 ~/.ztask", () => {
    const dir = defaultDataDir({});
    expect(dir.endsWith(".ztask")).toBe(true);
  });
});

describe("validateServeConfig", () => {
  it("默认绑定 127.0.0.1:8123", () => {
    const config = validateServeConfig({ dataDir: "/tmp/ztask-data" });
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8123);
  });

  it("拒绝 wildcard 默认监听（0.0.0.0 / ::）", () => {
    expect(() => validateServeConfig({ host: "0.0.0.0", dataDir: "/tmp/d" })).toThrow();
    expect(() => validateServeConfig({ host: "::", dataDir: "/tmp/d" })).toThrow();
  });

  it("拒绝越界与非数字端口", () => {
    expect(() => validateServeConfig({ port: 70000, dataDir: "/tmp/d" })).toThrow();
    expect(() => validateServeConfig({ port: Number.NaN, dataDir: "/tmp/d" })).toThrow();
  });

  it("port 0 仅允许 loopback（测试用）", () => {
    expect(validateServeConfig({ port: 0, dataDir: "/tmp/d" }).port).toBe(0);
    expect(() => validateServeConfig({ port: 0, host: "192.168.1.5", dataDir: "/tmp/d" })).toThrow();
  });

  it("拒绝空 dataDir", () => {
    expect(() => validateServeConfig({ dataDir: "   " })).toThrow();
  });
});

describe("host classification", () => {
  it("loopback 判定覆盖 localhost/127.x/::1", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("192.168.1.5")).toBe(false);
  });

  it("wildcard 判定覆盖 0.0.0.0/::/空值", () => {
    expect(isWildcardHost("0.0.0.0")).toBe(true);
    expect(isWildcardHost("::")).toBe(true);
    expect(isWildcardHost("")).toBe(true);
    expect(isWildcardHost("127.0.0.1")).toBe(false);
  });
});
