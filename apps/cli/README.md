# ztask CLI

`ztask` 是 ZTask 本地服务的命令入口，提供 `serve`、`init` 与 `backup`/`restore`/`doctor` 子命令。`serve` 单进程同源启动 Fastify API 与 Vue 管理端壳；`init` 把 npm 全局可执行目录写入 PATH。自动打开浏览器仅支持 macOS（`open`）与 Linux（`xdg-open`）；Windows 可手动访问打印出的管理 URL。

## 安装与启动

```sh
pnpm install
pnpm build        # 构建 shared/server/cli/web
pnpm serve        # 等价于 node apps/cli/dist/cli.js serve，默认 http://127.0.0.1:8123/
```

开发模式（Vite HMR + API 同机）：

```sh
pnpm dev          # 并行起 server(tsc --watch) 与 web(vite)，/api 代理到 8123
```

## `ztask init`

把 npm 全局可执行目录加入 PATH。命令先检查目录是否已配置：已配置时只提醒；否则展示目录与将写入的启动文件并询问 y/n，确认后写入当前 shell 的启动文件（Windows 写当前用户 PATH）。完成后提示重新打开终端或执行打印的 `source` 命令。非交互环境用 `--yes` 跳过确认；重复执行幂等。

## `ztask serve` 参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--host <host>` | `127.0.0.1` | 监听地址；`0.0.0.0`/`::` 会被拒绝，局域网分享走后续里程碑的动态 LAN 监听 |
| `--port <port>` | `8123` | `0` 仅用于 loopback 测试（由内核分配端口） |
| `--data-dir <dir>` | `ZTASK_HOME` 或 `~/.ztask` | 数据目录；本 issue 尚未写入业务数据，只承载单写者锁 |
| `--no-open` | （默认尝试打开） | 非交互环境（管道/CI）本就不会自动打开 |

启动后：

- 管理端与 API 同源：`http://127.0.0.1:8123/`。
- 健康检查：`GET /api/v1/health`。
- 未知 `/api/*` 返回统一 404 JSON，不会落到 SPA 页面。
- `SIGINT`/`SIGTERM` 优雅退出：关闭 HTTP 服务并释放数据目录锁。

## 数据目录锁

同一数据目录同时只允许一个 `ztask serve` 实例（`.ztask-lock`）。第二个实例会以 `启动失败：数据目录正被进程 N 持有` 退出，并继续打印数据目录、已知管理端地址、当前平台的查看/停止命令，以及 PID 被其他程序复用时的清理前提；读不到持有者 PID 时会说明可能原因与删除锁目录前的确认要求。进程崩溃留下的残锁在确认 pid 已死时可自动接管；只有确认没有 ZTask 正在写该目录时才手工删除锁目录。
