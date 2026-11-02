import { describe, expect, it } from "vitest";
import { parseServeArgs, resolveOpenDecision } from "@ztask/cli";

describe("parseServeArgs", () => {
  it("默认 127.0.0.1:8123 且允许自动打开", () => {
    const parsed = parseServeArgs(["serve"]);
    expect(parsed.input.host).toBe("127.0.0.1");
    expect(parsed.input.port).toBe(8123);
    expect(parsed.input.dataDir).toBeUndefined();
    expect(parsed.open).toBe(true);
  });

  it("解析显式 host/port/data-dir", () => {
    const parsed = parseServeArgs(["serve", "--host", "127.0.0.1", "--port", "9000", "--data-dir", "/tmp/zd"]);
    expect(parsed.input.port).toBe(9000);
    expect(parsed.input.dataDir).toBe("/tmp/zd");
  });

  it("--no-open 关闭自动打开", () => {
    expect(parseServeArgs(["serve", "--no-open"]).open).toBe(false);
  });

  it("非数字端口透传为 NaN，由 validateServeConfig 报错", () => {
    const parsed = parseServeArgs(["serve", "--port", "abc"]);
    expect(Number.isNaN(parsed.input.port)).toBe(true);
  });

  it("未知子命令报错", () => {
    expect(() => parseServeArgs(["frobnicate"])).toThrow();
  });
});

describe("resolveOpenDecision", () => {
  const base = { open: true, isTTY: true, env: {} as NodeJS.ProcessEnv };
  it("TTY 且未设 CI 时默认打开", () => {
    expect(resolveOpenDecision(base)).toBe(true);
  });
  it("非 TTY（管道/CI）不打开", () => {
    expect(resolveOpenDecision({ ...base, isTTY: false })).toBe(false);
  });
  it("CI 环境不打开", () => {
    expect(resolveOpenDecision({ ...base, env: { CI: "1" } })).toBe(false);
  });
  it("--no-open 显式禁用", () => {
    expect(resolveOpenDecision({ ...base, open: false })).toBe(false);
  });
});
