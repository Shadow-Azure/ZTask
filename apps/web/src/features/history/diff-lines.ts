import { diffLines } from "diff";

/** 双列 diff 的单行：左列只可能是 same/del/blank，右列只可能是 same/add/blank。 */
export interface DiffLine {
  kind: "same" | "del" | "add" | "blank";
  /** 行文本（不含换行符）；blank 为空串。 */
  text: string;
}

/** `buildDiffColumns` 的输出；added/removed 用于「+N −M」统计。 */
export interface DiffColumns {
  left: DiffLine[];
  right: DiffLine[];
  added: number;
  removed: number;
}

/**
 * 把 jsdiff 的一个 change 值拆成行（保留「末尾换行 = 有该行」的语义）。
 * @param value diffLines 返回的片段文本。
 * @returns 行数组；空片段返回空数组。
 */
function linesOf(value: string): string[] {
  if (value === "") return [];
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  // "a\nb\n" 代表 a、b 两行；末尾空串不是额外空行。
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * 统一换行与末尾换行：CRLF/CR → LF；非空文本补一个末尾换行再交给 diffLines。
 *
 * 原因：jsdiff 的 diffLines 以换行切分，缺少末尾换行时会把整行判成「删除 + 新增」，
 * 于是「只追加一行」看起来像整段替换。补一个换行只是让行模型一致，不改变任何内容行。
 * @param text 原始文本。
 * @returns 归一化文本。
 */
function normalize(text: string): string {
  const value = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (value === "" || value.endsWith("\n")) return value;
  return `${value}\n`;
}

/**
 * 用 jsdiff `diffLines` 生成双列行（08 §4.3）：removed → 左红右空，added → 左空右绿，
 * unchanged → 两列同文。相邻 removed+added 自然形成「左旧右新」的修改对齐。
 *
 * 所有文本都作为纯字符串返回，渲染层只做插值，绝不拼 HTML。
 * @param before 起始快照的完整详情（空串表示空）。
 * @param after 结束快照的完整详情。
 * @returns 左右两列与增删行数。
 */
export function buildDiffColumns(before: string, after: string): DiffColumns {
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  const changes = diffLines(normalize(before), normalize(after));
  for (const change of changes) {
    for (const text of linesOf(change.value)) {
      if (change.added) {
        left.push({ kind: "blank", text: "" });
        right.push({ kind: "add", text });
        added += 1;
      } else if (change.removed) {
        left.push({ kind: "del", text });
        right.push({ kind: "blank", text: "" });
        removed += 1;
      } else {
        left.push({ kind: "same", text });
        right.push({ kind: "same", text });
      }
    }
  }

  return { left, right, added, removed };
}
