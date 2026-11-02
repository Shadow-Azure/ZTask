import { Command } from "commander";
import type { ServeConfigInput } from "@ztask/server";

/** serve 子命令解析结果；input 交给 validateServeConfig，open 交给 resolveOpenDecision。 */
export interface ParsedServeArgs {
  input: ServeConfigInput;
  open: boolean;
}

/**
 * 解析 `ztask serve` 参数。端口在此转数字（非法值透传 NaN，由配置校验统一报错）；
 * data-dir 缺省交由 defaultDataDir 解析 ZTASK_HOME / ~/.ztask。
 * @param argv 命令行参数（不含 node 与脚本路径）。
 * @returns 解析结果。
 * @throws Error/commander.CommanderError 未知子命令或参数错误。
 */
export function parseServeArgs(argv: string[]): ParsedServeArgs {
  let parsed: ParsedServeArgs = { input: {}, open: true };

  const program = new Command();
  program.exitOverride().name("ztask").description("ZTask 本地团队进度服务").version("0.1.0");

  program
    .command("serve")
    .description("启动管理端 Web 与同源 API（默认仅绑定 127.0.0.1）")
    .option("--host <host>", "管理监听地址；默认 127.0.0.1，wildcard 会被拒绝", "127.0.0.1")
    .option("--port <port>", "端口；默认 8123，0 仅用于 loopback 测试", "8123")
    .option("--data-dir <dir>", "数据目录；默认 ZTASK_HOME 或 ~/.ztask")
    .option("--lan <host>", "启动时尝试监听的局域网 IP（也可在成员管理页开启）")
    .option("--no-open", "启动后不自动打开管理页")
    .action((options: { host: string; port: string; dataDir?: string; lan?: string; open: boolean }) => {
      parsed = {
        input: {
          host: options.host,
          port: Number(options.port),
          dataDir: options.dataDir,
          lanHost: options.lan,
        },
        open: options.open,
      };
    });

  program.parse(argv, { from: "user" });
  return parsed;
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
