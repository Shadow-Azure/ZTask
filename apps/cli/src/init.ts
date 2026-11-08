import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { EXIT_FAILURE, EXIT_OK } from "./maintenance.js";

const execFileAsync = promisify(execFile);

/** 写入 shell 启动文件的注释标记，便于用户识别与删除。 */
const MARKER = "# ztask init: 把 npm 全局可执行目录加入 PATH";

/** `ztask init` 的可注入依赖；缺省值对应真实环境，测试按需覆盖。 */
export interface InitOptions {
  /** 进程环境（读取 PATH 与 SHELL）；默认 process.env。 */
  env?: NodeJS.ProcessEnv;
  /** 目标平台；默认 process.platform。 */
  platform?: NodeJS.Platform;
  /** 用户主目录；默认 os.homedir()。 */
  homeDir?: string;
  /** 跳过 y/n 确认直接写入（对应 `--yes`）；默认 false。 */
  assumeYes?: boolean;
  /** 解析 npm 全局前缀；默认执行 `npm prefix --global`。 */
  resolveNpmPrefix?: () => Promise<string>;
  /** 读取文本文件，文件不存在返回 null；默认 fs.readFile。 */
  readTextFile?: (file: string) => Promise<string | null>;
  /** 追加文本（父目录不存在时创建）；默认 fs.appendFile。 */
  appendTextFile?: (file: string, text: string) => Promise<void>;
  /** 询问用户是否继续；默认从交互终端读取 y/n，非 TTY 时抛错。 */
  confirm?: (question: string) => Promise<boolean>;
  /** 查询 Windows 当前用户 PATH 是否已有目录；默认调用 PowerShell。 */
  isWindowsPathConfigured?: (binDir: string) => Promise<boolean>;
  /** 把目录写入 Windows 当前用户 PATH；默认调用 PowerShell。 */
  addWindowsPath?: (binDir: string) => Promise<void>;
}

/** 一组待写入的 shell 启动配置。 */
interface StartupFile {
  /** 启动文件绝对路径。 */
  file: string;
  /** 追加到文件中的 PATH 配置行。 */
  line: string;
  /** 让当前终端立即生效的命令。 */
  applyHint: string;
}

/**
 * 解析 npm 全局前缀（`npm prefix --global`）；npm 缺失或输出为空时拒绝。
 * @returns 去掉空白后的前缀路径。
 * @throws Error npm 不可执行、退出码非零或输出为空。
 */
async function defaultResolveNpmPrefix(): Promise<string> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const { stdout } = await execFileAsync(command, ["prefix", "--global"], {
    shell: process.platform === "win32",
  });
  const prefix = stdout.trim();
  if (prefix === "") throw new Error("npm prefix --global 未输出路径");
  return prefix;
}

/** 读取文本文件；不存在或不可读时返回 null，不向调用方抛错。 */
async function readTextFileIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** 追加文本；父目录不存在时先创建，保留原有内容。 */
async function appendTextFile(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, text, "utf8");
}

/**
 * 读取交互终端的 y/n 确认；空输入按 n 处理，非法输入重新询问。
 * @param question 展示给用户的问题。
 * @returns true 表示用户确认。
 * @throws Error 当前输入或输出不是 TTY 时无法交互。
 */
async function promptConfirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("当前不是交互终端，无法请求确认；可加 --yes 直接写入");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question(question)).trim().toLowerCase();
      if (answer === "" || answer === "n" || answer === "no") return false;
      if (answer === "y" || answer === "yes") return true;
      console.log("请输入 y 或 n。");
    }
  } finally {
    rl.close();
  }
}

/** PowerShell 用户 PATH 查询脚本：只输出 yes/no，不修改环境变量。 */
function windowsPathQueryScript(binDir: string): string {
  const dir = binDir.replace(/'/g, "''");
  return [
    `$dir = '${dir}'.TrimEnd('\\')`,
    "$current = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "$found = @($current -split ';' | Where-Object { $_.Trim().TrimEnd('\\') -ieq $dir })",
    "if ($found.Count -gt 0) { Write-Output 'yes' } else { Write-Output 'no' }",
  ].join("; ");
}

/** PowerShell 用户 PATH 写入脚本：已存在则不动，当前为空时不留下前导分号。 */
function windowsPathAddScript(binDir: string): string {
  const dir = binDir.replace(/'/g, "''");
  return [
    `$dir = '${dir}'.TrimEnd('\\')`,
    "$current = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "$found = @($current -split ';' | Where-Object { $_.Trim().TrimEnd('\\') -ieq $dir })",
    "if ($found.Count -gt 0) { Write-Output 'unchanged' } else {",
    "  $next = if ([string]::IsNullOrWhiteSpace($current)) { $dir } else { $current.TrimEnd(';') + ';' + $dir }",
    "  [Environment]::SetEnvironmentVariable('Path', $next, 'User')",
    "  Write-Output 'added'",
    "}",
  ].join("; ");
}

/**
 * 查询 Windows 当前用户 PATH 是否已经包含目标目录。
 * @param binDir 需要检查的 npm 全局可执行目录。
 * @returns true 表示用户 PATH 已包含该目录。
 * @throws Error PowerShell 不可用或查询失败。
 */
async function defaultIsWindowsPathConfigured(binDir: string): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", windowsPathQueryScript(binDir)],
    { windowsHide: true },
  );
  return stdout.trim().toLowerCase() === "yes";
}

/**
 * 把目录追加到 Windows 当前用户的 PATH（系统 PATH 与其它用户不受影响）。
 * @param binDir 需要加入 PATH 的 npm 全局可执行目录。
 * @throws Error PowerShell 不可用或写入失败。
 */
async function defaultAddWindowsPath(binDir: string): Promise<void> {
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", windowsPathAddScript(binDir)],
    { windowsHide: true },
  );
}

/**
 * 计算 npm 全局可执行目录：POSIX 为 `<prefix>/bin`，Windows 为前缀本身。
 * @param prefix npm 全局前缀。
 * @param platform 目标平台。
 * @returns 存放 ztask 可执行 shim 的目录。
 */
function globalBinDir(prefix: string, platform: NodeJS.Platform): string {
  if (platform === "win32") return path.win32.normalize(prefix);
  return path.posix.join(prefix, "bin");
}

/** 统一目录写法：去掉尾部路径分隔符；Windows 大小写不敏感。 */
function normalizeDir(dir: string, platform: NodeJS.Platform): string {
  const trimmed = dir.trim().replace(/[\\/]+$/, "");
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

/**
 * 判断 PATH 是否已经包含目标目录；空条目与尾部分隔符忽略，Windows 大小写不敏感。
 * @param binDir 目标目录。
 * @param pathValue PATH 原始值。
 * @param platform 目标平台。
 * @returns true 表示已包含。
 */
function isOnPath(binDir: string, pathValue: string, platform: NodeJS.Platform): boolean {
  const delimiter = platform === "win32" ? ";" : ":";
  const target = normalizeDir(binDir, platform);
  return pathValue
    .split(delimiter)
    .some((entry) => entry.trim() !== "" && normalizeDir(entry, platform) === target);
}

/** 用 POSIX 单引号安全包裹路径（内部单引号按 shell 规则转义）。 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 选择当前 shell 的启动文件与 PATH 配置行。
 * zsh/bash/fish 各有约定文件；其它 POSIX shell 退回 `~/.profile`。
 * @param shell `$SHELL` 的原始值，可能缺失。
 * @param homeDir 用户主目录。
 * @param binDir 需要加入 PATH 的目录。
 * @returns 启动文件、配置行与当前终端生效命令。
 */
function shellStartupFile(shell: string | undefined, homeDir: string, binDir: string): StartupFile {
  const name = path.basename((shell ?? "").trim());
  const quoted = shellQuote(binDir);
  if (name === "fish") {
    return {
      file: path.join(homeDir, ".config", "fish", "config.fish"),
      line: `fish_add_path ${quoted}`,
      applyHint: `fish_add_path ${quoted}`,
    };
  }
  const line = `export PATH=${quoted}:"$PATH"`;
  if (name === "zsh") return { file: path.join(homeDir, ".zshrc"), line, applyHint: line };
  if (name === "bash") return { file: path.join(homeDir, ".bashrc"), line, applyHint: line };
  return { file: path.join(homeDir, ".profile"), line, applyHint: line };
}

/** 构造追加块；在已有内容后留一个空行，空文件或新文件不产生前导空行。 */
function markerBlock(line: string, existing: string | null): string {
  if (existing === null || existing === "") return `${MARKER}\n${line}\n`;
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${separator}${MARKER}\n${line}\n`;
}

/** 打印让配置在当前终端立即生效的命令。 */
function printApplyHint(startup: StartupFile): void {
  console.log(`已把该目录写入 ${startup.file}。`);
  console.log("重新打开终端后生效；也可以在当前终端执行：");
  console.log(`  ${startup.applyHint}`);
}

/** npm 全局目录中是否已有 ztask 可执行 shim（Windows 同时接受 .cmd 与无扩展名）。 */
function shimInstalled(binDir: string, platform: NodeJS.Platform): boolean {
  const names = platform === "win32" ? ["ztask.cmd", "ztask"] : ["ztask"];
  return names.some((name) => existsSync(path.join(binDir, name)));
}

/** 缺少全局 shim 时提示先安装。 */
function printMissingShimHint(binDir: string): void {
  console.log(`提示：${binDir} 下未找到 ztask；请先执行 npm install -g ztask。`);
}

/**
 * `ztask init`：引导用户把 npm 全局可执行目录持久化到 PATH，使后续 `ztask serve` 可直接运行。
 *
 * 目录已在 PATH 或启动文件/用户 PATH 已记录时只提醒、不写入；否则展示目录并请求 y/n
 * 确认（`--yes` 跳过）。确认后 POSIX 写 shell 启动文件、Windows 写当前用户 PATH，并
 * 提示重新打开终端或执行打印的 source 命令。
 * @param options 平台、主目录、确认策略与可注入依赖；缺省读取真实环境。
 * @returns 退出码：0 已配置、已完成或用户取消；1 读取 npm、确认或写入失败。
 */
export async function runInit(options: InitOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const assumeYes = options.assumeYes ?? false;
  const readText = options.readTextFile ?? readTextFileIfExists;
  const appendText = options.appendTextFile ?? appendTextFile;
  const resolveNpmPrefix = options.resolveNpmPrefix ?? defaultResolveNpmPrefix;
  const confirm = options.confirm ?? promptConfirm;
  const isWindowsPathConfigured = options.isWindowsPathConfigured ?? defaultIsWindowsPathConfigured;
  const addWindowsPath = options.addWindowsPath ?? defaultAddWindowsPath;

  let prefix: string;
  try {
    prefix = (await resolveNpmPrefix()).trim();
  } catch (cause) {
    console.error("无法读取 npm 全局安装目录，请确认 npm 已安装并在 PATH 中。");
    console.error(`原因：${cause instanceof Error ? cause.message : String(cause)}`);
    return EXIT_FAILURE;
  }
  if (prefix === "") {
    console.error("无法读取 npm 全局安装目录：npm prefix --global 未输出路径。");
    return EXIT_FAILURE;
  }

  const binDir = globalBinDir(prefix, platform);
  console.log(`npm 全局可执行目录：${binDir}`);

  // npx / npm run 会把自身需要的 bin 目录前置到子进程 PATH，这里看到的 PATH 不代表
  // 用户 shell 的真实 PATH；这类调用改为检查启动文件或 Windows 用户 PATH。
  const invokedThroughNpm = env.npm_lifecycle_event !== undefined;
  if (!invokedThroughNpm && isOnPath(binDir, env.PATH ?? env.Path ?? "", platform)) {
    console.log("该目录已在 PATH 中，无需修改。");
    if (shimInstalled(binDir, platform)) console.log("现在可以直接运行 ztask serve。");
    else printMissingShimHint(binDir);
    return EXIT_OK;
  }

  let startup: StartupFile | null = null;
  let existing: string | null = null;
  let configured = false;
  if (platform === "win32") {
    try {
      configured = await isWindowsPathConfigured(binDir);
    } catch (cause) {
      console.error("无法读取 Windows 当前用户的 PATH。");
      console.error(`原因：${cause instanceof Error ? cause.message : String(cause)}`);
      return EXIT_FAILURE;
    }
  } else {
    startup = shellStartupFile(env.SHELL, homeDir, binDir);
    existing = await readText(startup.file);
    configured = existing !== null && existing.includes(binDir);
  }

  if (configured) {
    console.log("该目录已在 PATH 配置中，无需修改。");
    if (platform === "win32") {
      console.log("当前终端尚未加载；重新打开终端后生效。");
    } else if (startup !== null) {
      console.log(`配置位于 ${startup.file}，当前终端尚未加载。`);
      console.log(`重新打开终端，或在当前终端执行：${startup.applyHint}`);
    }
    if (!shimInstalled(binDir, platform)) printMissingShimHint(binDir);
    return EXIT_OK;
  }

  console.log("该目录不在 PATH 中。");
  if (!assumeYes) {
    let confirmed: boolean;
    try {
      confirmed = await confirm("是否将它加入 PATH？(y/n) ");
    } catch (cause) {
      console.error(`无法请求确认：${cause instanceof Error ? cause.message : String(cause)}`);
      return EXIT_FAILURE;
    }
    if (!confirmed) {
      console.log("已取消，未修改 PATH；需要时可重新运行 ztask init。");
      return EXIT_OK;
    }
  }

  if (platform === "win32") {
    try {
      await addWindowsPath(binDir);
    } catch (cause) {
      console.error("写入 Windows 用户 PATH 失败，请手动把上面的目录加入用户环境变量 Path。");
      console.error(`原因：${cause instanceof Error ? cause.message : String(cause)}`);
      return EXIT_FAILURE;
    }
    console.log("已把该目录加入当前用户的 PATH。");
    console.log("重新打开终端后生效，然后直接运行 ztask serve。");
  } else if (startup !== null) {
    try {
      await appendText(startup.file, markerBlock(startup.line, existing));
    } catch (cause) {
      console.error(`写入 ${startup.file} 失败，请手动加入：${startup.line}`);
      console.error(`原因：${cause instanceof Error ? cause.message : String(cause)}`);
      return EXIT_FAILURE;
    }
    printApplyHint(startup);
  }
  if (!shimInstalled(binDir, platform)) printMissingShimHint(binDir);
  return EXIT_OK;
}
