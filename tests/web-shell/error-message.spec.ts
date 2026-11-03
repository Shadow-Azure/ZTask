// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ApiError } from "@ztask/shared";
import { describeApiError, translateServerValidation } from "../../apps/web/src/api/error-message";

describe("describeApiError（统一错误提示）", () => {
  it("网络错误给出服务未运行的行动提示", () => {
    expect(describeApiError(new ApiError(0, "NETWORK_ERROR", "网络错误或请求超时"))).toContain("ZTask 服务仍在运行");
  });

  it("旧版 500 的“内部错误”被替换并保留请求编号", () => {
    const message = describeApiError(new ApiError(500, "INTERNAL_ERROR", "内部错误", { requestId: "req-1" }));
    expect(message).toContain("服务端处理失败");
    expect(message).toContain("请求编号：req-1");
    expect(message).not.toContain("内部错误");
  });

  it("服务端新的具体原因原样展示，且不重复请求编号", () => {
    const message = describeApiError(
      new ApiError(500, "INTERNAL_ERROR", "保存失败：数据文件校验不通过（原因：STORAGE_CORRUPTION，请求编号：req-2）", {
        requestId: "req-2",
      }),
    );
    expect(message).toContain("数据文件校验不通过");
    expect(message.match(/请求编号/g)).toHaveLength(1);
  });

  it("把英文 AJV 校验消息翻译成字段级中文", () => {
    const message = describeApiError(new ApiError(400, "INVALID_REQUEST", "body/progress must be integer"));
    expect(message).toBe("小任务进度必须是 0–100 的整数。");
  });

  it("服务端中文领域消息原样返回", () => {
    expect(translateServerValidation("小任务「整理视觉稿」缺少有效负责人，请选择负责人")).toBe(
      "小任务「整理视觉稿」缺少有效负责人，请选择负责人",
    );
  });

  it("非 API 错误回退到异常消息或兜底文案", () => {
    expect(describeApiError(new Error("保存失败"))).toBe("保存失败");
    expect(describeApiError(null, "保存失败")).toBe("保存失败");
  });
});
