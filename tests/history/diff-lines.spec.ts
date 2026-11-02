import { describe, expect, it } from "vitest";
import { buildDiffColumns } from "../../apps/web/src/features/history/diff-lines";

/**
 * 双列 diff 纯函数（08 §4.3）：覆盖新增、删除、修改、未变化、空文本、CRLF、
 * 中文/emoji、纯空行、末尾换行与整段替换。
 */
describe("buildDiffColumns（jsdiff → 双列行）", () => {
  it("未变化：两列同文且不计增删", () => {
    const result = buildDiffColumns("第一行\n第二行", "第一行\n第二行");
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.left.map((line) => line.text)).toEqual(["第一行", "第二行"]);
    expect(result.right.map((line) => line.text)).toEqual(["第一行", "第二行"]);
    expect(result.left.every((line) => line.kind === "same")).toBe(true);
  });

  it("修改：删除行在左、添加行在右，未变化行两侧对齐", () => {
    const result = buildDiffColumns("A\n旧内容\nC", "A\n新内容\nC");
    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);
    // 相邻 removed+added 配对到同一行，避免 1 行修改显示成错开的两行。
    expect(result.left.map((line) => line.kind)).toEqual(["same", "del", "same"]);
    expect(result.right.map((line) => line.kind)).toEqual(["same", "add", "same"]);
    expect(result.left[1]!.text).toBe("旧内容");
    expect(result.right[1]!.text).toBe("新内容");
  });

  it("空详情：两侧都为空时不产生行", () => {
    const result = buildDiffColumns("", "");
    expect(result.left).toHaveLength(0);
    expect(result.right).toHaveLength(0);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
  });

  it("从空文本新增：全部是右列 added，左列 blank", () => {
    const result = buildDiffColumns("", "第一行\n第二行");
    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.left.every((line) => line.kind === "blank")).toBe(true);
    expect(result.right.map((line) => line.text)).toEqual(["第一行", "第二行"]);
  });

  it("CRLF 归一化：不因换行符差异产生假变更", () => {
    const result = buildDiffColumns("a\r\nb\r\n", "a\nb\n");
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.left.map((line) => line.text)).toEqual(["a", "b"]);
  });

  it("保留空行与末尾换行语义", () => {
    const result = buildDiffColumns("a\n\nb\n", "a\n\nb\nc\n");
    expect(result.added).toBe(1);
    expect(result.right.map((line) => line.text)).toEqual(["a", "", "b", "c"]);
    // 新增行在左列是 blank 占位，行数必须与右列一致。
    expect(result.left.map((line) => line.text)).toEqual(["a", "", "b", ""]);
    expect(result.left[3]!.kind).toBe("blank");
  });

  it("中文、emoji 与长行按整行处理", () => {
    const long = "长".repeat(500);
    const result = buildDiffColumns("你好 🙌", `你好 🙌\n${long}`);
    expect(result.added).toBe(1);
    expect(result.right[1]!.text).toBe(long);
  });

  it("整段替换：旧段全部删除、新段全部新增", () => {
    const result = buildDiffColumns("旧一\n旧二", "新一\n新二\n新三");
    expect(result.removed).toBe(2);
    expect(result.added).toBe(3);
    // 2 行配对 + 1 行右列新增。
    expect(result.left.map((line) => line.kind)).toEqual(["del", "del", "blank"]);
    expect(result.right.map((line) => line.kind)).toEqual(["add", "add", "add"]);
  });
});
