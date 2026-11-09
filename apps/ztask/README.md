# ztask

ZTask 的单包发布入口：一个 `ztask` 命令启动管理端 Web 与同源 API，数据保存在本机文件目录。

## 安装

需要 Node.js 22 或更高版本。当前版本从 [GitHub Release](https://github.com/Shadow-Azure/ZTask/releases) 的 tarball 安装（把 `v0.3.0` 换成最新 Release 的版本）；Linux、macOS 与 Windows 使用同一条命令：

```sh
npm install -g https://github.com/Shadow-Azure/ZTask/releases/download/v0.3.0/ztask-0.3.0.tgz
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

## 从源码发布

仓库根执行 `pnpm build`，再在 `apps/ztask` 执行 `npm pack`；产物只包含 `dist/`（CLI、server、shared 与预构建 Web）和本 README。发布流水线见仓库 `.github/workflows/release.yml`。

完整文档见 [ZTask 仓库](https://github.com/Shadow-Azure/ZTask)。
