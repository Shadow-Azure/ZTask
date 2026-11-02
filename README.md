# ZTask

[English](README.en.md) | 中文

ZTask 是一个本地优先的团队进度管理工具。当前仓库包含可运行的 CLI、Fastify 服务、Vue 管理端、共享契约、存储恢复测试，以及与代码同级的文档工程和开发流程门禁。

## 快速开始

```sh
pnpm install
pnpm install:hooks
pnpm build
pnpm serve
```

开发时可用 `pnpm dev` 并行启动 workspace。服务默认只监听 loopback，数据保存在配置的数据目录；完整上手见[开发指南](docs/development.md)。

## 质量门禁

- `pnpm lint:docs`：快速文档门禁。
- `pnpm verify:docs`：全量文档与门禁自测。
- `pnpm test:gates`：全部文档、流程和门禁脚本测试。
- `pnpm route:gates`：按当前改动面推荐门禁组合。
- `pnpm test`：生产构建、门禁测试与 workspace 自动化测试。

文档以中文为 base，英文侧与配对记录随同维护，契约见[双语配对](docs/i18n/README.md)。开发工作按 roadmap → milestone → issue 推进，规则见[开发流程](.agents/flow/README.md)，决策理由记录在 [Agent Notes](.agents/notes/README.md)。

架构与模块边界见[架构说明](docs/architecture.md)，愿景见[项目章程](docs/charter.md)。
