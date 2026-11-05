import { createRequire } from "node:module";
import { Command } from "commander";
import type { ServeConfigInput } from "@ztask/server";

const require = createRequire(import.meta.url);
/** 命令行版本来源：monorepo 与发布包都读各自 package.json，避免另写常量。 */
const PACKAGE_VERSION: string = require("../package.json").version;

/** serve 子命令解析结果；input 交给 validateServeConfig，open 交给 resolveOpenDecision。 */
export interface ParsedServeArgs {
  input: ServeConfigInput;
  open: boolean;
}

/** 默认管理端地址（与 serve 的默认 host/port 一致）；`ztask backup` 缺省连这里。 */
export const DEFAULT_SERVER_URL = "http://127.0.0.1:8123";

/** 全部子命令的解析结果（#23 追加 backup/restore/doctor）。 */
export type ParsedCliArgs =
  | { command: "serve"; serve: ParsedServeArgs }
  | { command: "backup"; url: string }
  | { command: "restore"; backupDir: string; dataDir: string }
  | { command: "doctor"; dataDir?: string };

/**
 * 构造 ztask 的 commander 程序：四个子命令共用一份帮助与参数校验。
 * 所有 action 只把结果写回回调，真正的执行由 cli.ts 分发，便于单测解析而不启动服务。
 * @param onParse 解析出一个子命令时回调。
 * @param version 传给 `--version` 的版本号。
 * @returns 已注册全部子命令的程序。
 */
function buildProgram(onParse: (parsed: ParsedCliArgs) => void, version: string): Command {
  const program = new Command();
  program.exitOverride().name("ztask").description("ZTask 本地团队进度服务").version(version);

  program
    .command("serve")
    .description("启动管理端 Web 与同源 API（默认仅绑定 127.0.0.1）")
    .option("--host <host>", "管理监听地址；默认 127.0.0.1，wildcard 会被拒绝", "127.0.0.1")
    .option("--port <port>", "端口；默认 8123，0 仅用于 loopback 测试", "8123")
    .option("--data-dir <dir>", "数据目录；默认 ZTASK_HOME 或 ~/.ztask")
    .option("--lan <host>", "启动时尝试监听的局域网 IP（也可在成员管理页开启）")
    .option("--no-open", "启动后不自动打开管理页")
    .action((options: { host: string; port: string; dataDir?: string; lan?: string; open: boolean }) => {
      onParse({
        command: "serve",
        serve: {
          input: {
            host: options.host,
            port: Number(options.port),
            dataDir: options.dataDir,
            lanHost: options.lan,
          },
          open: options.open,
        },
      });
    });

  program
    .command("backup")
    .description("通过本机管理端 HTTP 端点执行一次在线备份（暂停写入的快照）")
    .option("--url <url>", `管理端地址；默认 ${DEFAULT_SERVER_URL}`, DEFAULT_SERVER_URL)
    .action((options: { url: string }) => {
      onParse({ command: "backup", url: options.url });
    });

  program
    .command("restore")
    .description("离线把备份恢复到新数据目录（目标必须不存在或为空；服务需先停止）")
    .requiredOption("--backup <dir>", "备份目录（<dataDir>/backups/<时间戳>-<uuid>）")
    .requiredOption("--data-dir <dir>", "目标数据目录（必须不存在或为空）")
    .action((options: { backup: string; dataDir: string }) => {
      onParse({ command: "restore", backupDir: options.backup, dataDir: options.dataDir });
    });

  program
    .command("doctor")
    .description("只读校验数据目录，输出问题分类与修复建议（不写任何文件）")
    .option("--data-dir <dir>", "数据目录；默认 ZTASK_HOME 或 ~/.ztask")
    .action((options: { dataDir?: string }) => {
      onParse(
        options.dataDir === undefined
          ? { command: "doctor" }
          : { command: "doctor", dataDir: options.dataDir },
      );
    });

  return program;
}

/**
 * 解析 ztask 命令行的子命令与参数。
 * `--help` 由 commander 输出全部四个子命令（serve/backup/restore/doctor）后退出。
 * @param argv 命令行参数（不含 node 与脚本路径）。
 * @param version `--version` 输出；默认取包内 package.json，便于发布包与 monorepo 共用。
 * @returns 子命令解析结果。
 * @throws commander.CommanderError 未知子命令、缺少必填参数或用户请求帮助/版本。
 */
export function parseCliArgs(argv: string[], version: string = PACKAGE_VERSION): ParsedCliArgs {
  let parsed: ParsedCliArgs | null = null;
  const program = buildProgram((value) => {
    parsed = value;
  }, version);
  program.parse(argv, { from: "user" });
  if (parsed !== null) return parsed;
  // 无子命令：打印帮助并按用法错误退出（commander 在 exitOverride 下抛 CommanderError）。
  program.help({ error: true });
  throw new Error("不可达：commander.help 在 exitOverride 下总是抛 CommanderError");
}

/**
 * 仅解析 `ztask serve` 参数（保持既有测试与调用方的窄接口）。
 * @param argv 命令行参数（不含 node 与脚本路径）。
 * @returns serve 解析结果。
 * @throws Error 传入的是其它子命令时。
 */
export function parseServeArgs(argv: string[]): ParsedServeArgs {
  const parsed = parseCliArgs(argv);
  if (parsed.command !== "serve") {
    throw new Error(`parseServeArgs 只接受 serve 子命令，收到 ${parsed.command}`);
  }
  return parsed.serve;
}

/** 自动打开决策的输入。 */
export interface OpenDecisionInput {
  open: boolean;
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
}

/**
 * 是否自动打开管理页：--no-open 优先；非 TTY 或 CI 环境一律不打开（01 §3 默认打开仅指本机交互场景）。
 * @param input open 标志、TTY 状态与环境变量。
 * @returns true 表示应当打开浏览器。
 */
export function resolveOpenDecision(input: OpenDecisionInput): boolean {
  if (!input.open) return false;
  if (!input.isTTY) return false;
  if (input.env.CI !== undefined) return false;
  return true;
}
