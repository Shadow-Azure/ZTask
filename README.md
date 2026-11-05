<div align="center">

# ZTask

**本地优先的团队进度管理工具**

让团队对「现在推进到哪、谁在管、下一步是什么」有一致答案。

[English](README.en.md) | 中文

[![CI](https://github.com/Shadow-Azure/ZTask/actions/workflows/ci.yml/badge.svg)](https://github.com/Shadow-Azure/ZTask/actions/workflows/ci.yml)

</div>

![ZTask 管理端：任务夹、主任务与小任务的进度和进展详情](docs/assets/ztask-admin.png)

ZTask 把团队进度放在团队自己手里。一条命令启动本地服务，用浏览器打开管理端，按任务夹组织目标、负责人与截止日期；需要协作时开启局域网分享，每位成员只看到与自己相关的事项。数据以可读的 JSON/JSONL 保存在本机目录，备份、恢复与诊断都有对应命令。

## 主要能力

- **任务树与进展详情**：任务夹分层，主任务下挂一层小任务；负责人、协作人、重要度、预计完成与逐条进展记录收在同一张卡片里。
- **情况看板与历史差异**：按完成度、重要度与预计完成时间汇总，支持成员筛选；按时间区间还原前后快照并双列对照。
- **成员与局域网分享**：一人一条分享链接，负责人可更新自己的事项，协作成员只读；链接可重置、吊销，旧会话立即失效。
- **备份、恢复与诊断**：单写者文件存储与写队列保证一致性；`ztask backup` 生成在线快照，`restore` 校验后原子恢复，`doctor` 区分可修复与需恢复的问题。
- **文档与门禁同级**：文档三件套、死链、双语配对、类型等价与开发流程都在 CI 里机械校验，不依赖口头约定。

## 快速开始

发布包上线后，只装 Node 22 或更高版本即可，不需要 clone 仓库：

```sh
npx ztask serve
```

管理端默认位于 `http://127.0.0.1:8123`，数据目录默认为 `~/.ztask`，可用 `--data-dir` 指定。

本地开发：

```sh
pnpm install
pnpm install:hooks
pnpm build
pnpm serve
```

`pnpm dev` 并行启动 workspace；单包打包与发布见[开发指南](docs/development.md)。

## 文档

- [文档索引](docs/README.md)：全部常驻文档的入口。
- [架构说明](docs/architecture.md)：应用组成、启动顺序与数据流。
- [项目章程](docs/charter.md)：愿景与产品边界。
- [开发流程](.agents/flow/README.md)：roadmap → milestone → issue 的推进规则。
- [Agent Notes](.agents/notes/README.md)：非平凡决策的记录约定。
