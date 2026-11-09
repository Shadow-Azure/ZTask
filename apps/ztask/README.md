# ztask

ZTask 的单包发布入口：一个 `ztask` 命令启动管理端 Web 与同源 API，数据保存在本机文件目录。

## 安装

需要 Node.js 22 或更高版本。当前版本从 [GitHub Release](https://github.com/Shadow-Azure/ZTask/releases) 的 tarball 安装（把 `v0.1.0` 换成最新 Release 的版本）；Linux、macOS 与 Windows 使用同一条命令：

```sh
npm install -g https://github.com/Shadow-Azure/ZTask/releases/download/v0.1.0/ztask-0.1.0.tgz
ztask serve
```

发布到 npm 后也可以：

```sh
npx ztask serve
# 或
npm install -g ztask
ztask serve
```

如果全局安装后运行 `ztask serve` 提示找不到命令，执行 `npx ztask init`：它会显示 npm 全局可执行目录与将要写入的启动文件，确认后写入 PATH；重新打开终端或执行提示里的 `source` 命令后即可直接运行。非交互环境可加 `--yes` 跳过确认。不改 PATH 时也可以直接用 `npx ztask serve` 启动。

默认管理端为 `http://127.0.0.1:8123/`，数据目录为 `~/.ztask`（可用 `ZTASK_HOME` 或 `--data-dir` 覆盖）。`serve` 之外的 `init`、`backup`、`restore`、`doctor` 子命令与仓库内的 CLI 一致。

## 升级与卸载

`ztask serve` 运行时会加载包内的原生 SQLite 模块（`better-sqlite3`）。Windows 上运行中的进程会占用该模块文件：此时执行 `npm install -g` 覆盖旧版本或 `npm uninstall -g ztask`，npm 可能无法清理旧包目录并报 `EPERM`，同时在 `node_modules` 下留下 `.ztask-<随机串>` 目录。

升级或卸载前，先在运行服务的终端按 `Ctrl+C`，确认进程退出后再执行 npm 命令。升级就是重新执行上面的安装命令，然后再次启动 `ztask serve`；数据目录（默认 `~/.ztask`）不受影响。卸载只移除程序，数据目录默认保留，确认不再需要时再手动删除。

若 npm 已经报 `EPERM` 并留下残留目录：

1. 停止所有 `ztask serve`。找不到服务所在终端时，用数据目录 `.ztask-lock/pid` 里的 PID 结束进程：Windows 执行 `Stop-Process -Id <pid>`，macOS/Linux 执行 `kill <pid>`。
2. 删除 npm 报错路径里残留的 `.ztask-*` 目录。全局安装时它在 `npm root -g` 输出的目录下；用 `npx ztask` 启动时，它在 npm 缓存的 `_npx/<hash>/node_modules` 下（缓存根目录用 `npm config get cache` 查看）。
3. 重新执行升级或卸载命令。

## 从源码发布

仓库根执行 `pnpm build`，再在 `apps/ztask` 执行 `npm pack`；产物只包含 `dist/`（CLI、server、shared 与预构建 Web）和本 README。发布流水线见仓库 `.github/workflows/release.yml`。

完整文档见 [ZTask 仓库](https://github.com/Shadow-Azure/ZTask)。
