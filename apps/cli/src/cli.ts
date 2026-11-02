#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { LockHeldError, serve, validateServeConfig } from "@ztask/server";
import { resolveOpenDecision } from "./serve-args.js";
import { parseServeArgs } from "./serve-args.js";

const require = createRequire(import.meta.url);
/** CLI 版本即服务版本，健康检查回显。 */
const VERSION: string = require("../package.json").version;

/** 生产态 Vue 构建产物位置（apps/web/dist）；不存在时服务纯 API 模式。 */
const WEB_DIST = path.resolve(import.meta.dirname, "../../web/dist");

async function main(argv: string[]): Promise<void> {
  const { input, open } = parseServeArgs(argv);
  const config = validateServeConfig({
    ...input,
    staticRoot: existsSync(WEB_DIST) ? WEB_DIST : null,
  });

  const handle = await serve(config, { version: VERSION });
  const url = `http://${config.host}:${handle.port}/`;
  console.log(`ZTask ${VERSION} 管理端：${url}`);
  console.log(`数据目录：${config.dataDir}`);

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.log(`收到 ${signal}，正在关闭…`);
    void handle
      .close()
      .then(() => process.exit(0))
      .catch((cause: unknown) => {
        console.error("关闭失败：", cause);
        process.exit(1);
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  if (resolveOpenDecision({ open, isTTY: process.stdout.isTTY, env: process.env })) {
    openBrowser(url);
  }
}

/** 用平台默认方式打开 URL；失败只提示，不影响服务。 */
function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = spawn(command, [url], { detached: true, stdio: "ignore" });
    child.on("error", () => console.log(`未能自动打开浏览器，请手动访问 ${url}`));
    child.unref();
  } catch {
    console.log(`未能自动打开浏览器，请手动访问 ${url}`);
  }
}

main(process.argv.slice(2)).catch((cause: unknown) => {
  if (cause instanceof LockHeldError) {
    console.error(`启动失败：${cause.message}`);
    process.exit(1);
  }
  console.error("启动失败：", cause);
  process.exit(1);
});
