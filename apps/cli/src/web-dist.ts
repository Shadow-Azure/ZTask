import { existsSync } from "node:fs";
import path from "node:path";

/**
 * 解析生产态 Vue 构建产物目录。
 *
 * 同一条 CLI 代码有两种布局：
 * - 发布包 `ztask`：`dist/cli.js` 与 `dist/web` 同级；
 * - monorepo：`apps/cli/dist/cli.js` 与 `apps/web/dist` 相隔两层。
 * 两者都不存在时返回 null，服务退化为纯 API 模式（保持既有行为）。
 * @param baseDir CLI 产物所在目录；测试可注入替代布局。
 * @returns 可用的 Web 静态目录，或 null。
 */
export function resolveWebDist(baseDir: string = import.meta.dirname): string | null {
  const candidates = [
    path.resolve(baseDir, "web"),
    path.resolve(baseDir, "../../web/dist"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
