#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { CommanderError } from "commander";
import { defaultDataDir, LockHeldError, serve, validateServeConfig } from "@ztask/server";
import type { NetworkState } from "@ztask/shared";
import { parseCliArgs, resolveOpenDecision, type ParsedServeArgs } from "./serve-args.js";
import { formatLockHeldMessage } from "./lock-error.js";
import { EXIT_USAGE, runBackup, runDoctor, runRestore } from "./maintenance.js";

const require = createRequire(import.meta.url);
/** CLI 版本即服务版本，健康检查回显。 */
const VERSION: string = require("../package.json").version;

/** 生产态 Vue 构建产物位置（apps/web/dist）；不存在时服务纯 API 模式。 */
const WEB_DIST = path.resolve(import.meta.dirname, "../../web/dist");

/**
 * 命令分发：serve 启动服务；backup/restore/doctor 走维护路径（#23）。
 * 维护命令不启动 HTTP、不可达/校验失败时以非零退出码结束（见 maintenance.ts）。
 * @param argv 命令行参数（不含 node 与脚本路径）。
 */
async function main(argv: string[]): Promise<void> {
  const parsed = parseCliArgs(argv);
  switch (parsed.command) {
    case "backup":
      process.exitCode = await runBackup({ url: parsed.url });
      return;
    case "restore":
      process.exitCode = await runRestore({
        backupDir: parsed.backupDir,
        dataDir: parsed.dataDir,
        applicationVersion: VERSION,
      });
      return;
    case "doctor":
      process.exitCode = await runDoctor({ dataDir: parsed.dataDir ?? defaultDataDir() });
      return;
    case "serve":
      await runServe(parsed.serve);
      return;
  }
}

/**
 * 启动 `ztask serve`：校验配置、启动服务、打印地址与分享状态，并接管 SIGINT/SIGTERM。
 * @param parsed serve 子命令的解析结果。
 */
async function runServe(parsed: ParsedServeArgs): Promise<void> {
  const { input, open } = parsed;
  const config = validateServeConfig({
    ...input,
    staticRoot: existsSync(WEB_DIST) ? WEB_DIST : null,
  });

  const handle = await serve(config, { version: VERSION }).catch((cause: unknown) => {
    if (cause instanceof LockHeldError) {
      // 冲突是第二个实例最常见的启动结果：把持有者、数据目录与可执行动作一次说清。
      console.error(formatLockHeldMessage(cause, { host: config.host, port: config.port }));
      process.exitCode = 1;
      return null;
    }
    throw cause;
  });
  if (handle === null) return;
  // 只打印管理 URL 与分享地址；raw token 只在管理端生成响应里出现一次（05 §4.5）。
  const url = `http://${config.host}:${handle.port}/`;
  console.log(`ZTask ${VERSION} 管理端：${url}`);
  printShareStatus(handle.networkService.state(), handle.lanError);
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

/**
 * 输出分享监听状态（01 §3.1、05 §4.9）：
 * - running：打印 shareBaseUrl，供管理员分发链接时核对地址；绝不打印 token；
 * - --lan 启动失败：打印已脱敏原因，并明确管理端不受影响；
 * - degraded（重启恢复失败）：提示地址不可用，要求重新选择；
 * - 其余：提示可在成员管理页开启。
 * @param state 网络状态快照。
 * @param lanError serve 返回的 --lan 脱敏失败原因（null 表示未指定或成功）。
 */
function printShareStatus(state: NetworkState, lanError: string | null): void {
  const listener = state.shareListener;
  if (listener.running && listener.shareBaseUrl !== null) {
    console.log(`局域网分享：${listener.shareBaseUrl}（成员链接使用该地址，可在成员管理页管理）`);
    return;
  }
  if (lanError !== null) {
    console.log(`局域网分享未开启：${lanError}；本机管理端不受影响`);
    return;
  }
  if (listener.degraded) {
    console.log(`局域网分享不可用：${listener.error ?? "保存的地址当前不可用，请在成员管理页重新选择"}`);
    return;
  }
  console.log("局域网分享：未开启（可在成员管理页开启）");
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
  if (cause instanceof CommanderError) {
    // --help/--version 是正常退出（exitCode 0）；参数/子命令错误统一按用法错误退出（2）。
    process.exit(cause.exitCode === 0 ? 0 : EXIT_USAGE);
  }
  if (cause instanceof LockHeldError) {
    console.error(`启动失败：${cause.message}`);
    process.exit(1);
  }
  console.error("启动失败：", cause);
  process.exit(1);
});
