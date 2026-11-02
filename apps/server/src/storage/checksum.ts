import { createHash } from "node:crypto";

/**
 * 规范化 JSON 字节：键递归排序后序列化，保证同一数据在任何进程得到同一字节串。
 * checksum 对规范化字节计算，用于识别损坏，不作为防恶意篡改签名（06 §7.1）。
 * @param value 任意可 JSON 序列化的值。
 * @returns 规范化 JSON 字符串（无多余空白）。
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

/**
 * 计算规范化字节的 SHA-256 十六进制摘要。
 * @param value 参与 checksum 的值（调用方须先剔除 checksum 字段本身）。
 * @returns 64 位十六进制摘要字符串。
 */
export function checksumOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
