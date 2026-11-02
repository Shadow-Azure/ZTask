# 架构

[English](architecture.en.md) | 中文

## 应用组成

ZTask 是 pnpm workspace 管理的本地优先团队进度工具，当前由四层组成：

- `apps/cli/`：用户入口，解析 `serve`、`backup`、`restore`、`doctor` 子命令，构造配置、启动服务或执行维护命令。
- `apps/server/`：Fastify 服务、静态前端回退、数据目录锁与本地 JSON/JSONL 存储。
- `apps/web/`：Vue 3、Vue Router 与 TanStack Query 构成的管理端外壳。
- `packages/shared/`：跨端 API 前缀、DTO 与错误契约。

`tests/` 覆盖启动、配置、存储恢复、Web 外壳与共享行为；`plan/fullstack-design/` 保存设计和实现依据。

## 启动与数据流

CLI 解析配置后调用 server 的 `serve()`。启动顺序固定为数据目录单写者锁 → manifest、恢复与索引 → Fastify 装配与监听；任一步失败都会释放锁。服务默认只监听 loopback；显式开启 LAN 后只开放成员分享域，`/api/v1/admin` 在 LAN 上一律拒绝。API 未命中返回统一 JSON 404，其他路径在有静态产物时回退到 SPA。

Server 以数据目录为持久化边界，任务、文件夹、成员、修订与 manifest 分文件保存；恢复和索引在监听前完成，后续请求通过存储门面读写。Web 端经 HTTP 层调用 `/api/v1`，共享包固定请求、响应和错误形状。

## 备份、恢复与诊断

- 在线备份由运行中的服务执行（`POST /api/v1/admin/maintenance/backup`，仅本机管理端）：暂停写队列并等待在途写入，复制数据目录到临时目录（排除 `locks/`、`tmp/`、`backups/`），校验 manifest、JSON、JSONL checksum、revision tip 与引用后写报告，再原子发布到 `backups/<时间戳>-<uuid>/`。
- `ztask backup` 通过 loopback 调用该端点；并发备份返回 409。
- `ztask restore --backup <dir> --data-dir <dir>` 先在独立临时目录完整校验并 `initStore`，成功后原子切换到目标目录；目标必须不存在或为空，失败不留下半恢复目录。
- `ztask doctor` 只读扫描数据目录，区分「重启可自动修复」（JSONL 尾部半行）与「需从备份恢复」（中间 checksum、current 与 revisionTip 不一致、引用缺失、manifest 损坏）。
- 备份是完整目录快照（含 revisions、network.json 与 auth-sessions），不压缩也不自动清理旧备份。

## 文档工程

文档与代码同级，分为三层：

- `docs/AGENTS.md` 定义写作与层级规则，`docs/README.md` 维护唯一文档索引。
- `docs/i18n/` 保存双语配对契约、术语表和翻译提示词；每个常驻文档是 `.md`、`.en.md`、`.i18n.yaml` 三件套。
- `.agents/notes/` 记录决策，`.agents/flow/` 记录 roadmap、milestone 与 issue，`docs/postmortem/` 只承载事故叙事。

`scripts/` 是可组合门禁集合。`run-gates` 将快速档和全量档组合起来；`route-gates` 按改动面推荐命令；每项检查都有独立 spec，`gate-coverage` 检查脚本与测试是否对账，`ci-wiring` 检查模式、CI 和命令清单是否脱钩。

## 技术约束

- 门禁脚本使用 Node 标准库和 TypeScript 编译器 API，不引入运行时依赖。
- Blob hash、配对记录和结构签名要求仓库文本统一 LF，由 `.gitattributes` 强制。
- 存储写入必须经过单写者锁和写队列；恢复路径在 HTTP 开放前完成。
- 管理 API 默认仅允许服务主机本机访问，LAN 权限由后续 issue 扩展。
