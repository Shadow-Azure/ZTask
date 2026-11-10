# 开发上手

[English](development.en.md) | 中文

## 环境

- Node 20.0–25（20.15 以下同样支持）与 pnpm（v10），版本由 `engines` 和 `packageManager` 锁定。
- 首次 clone 执行 `pnpm install && pnpm install:hooks`。安装器同时注册 `.i18n.yaml` 的 fail-closed merge driver。
- 文档门禁与流程门禁均离线运行；在线流程校验需要已认证的 `gh`。

## 日常循环

```sh
pnpm route:gates
pnpm lint:docs
pnpm verify:docs
```

`route:gates` 读取工作树路径并给出建议组合。仅文档改动通常跑 `lint:docs`；改变文档结构、死链或围栏时跑 `verify:docs`。门禁脚本本身还必须跑 `pnpm test:gates`，产品代码按对应 workspace 测试与 `pnpm build` 验证。

新增或修改非平凡决策时，在同一 PR 写 Agent Note。修改双语任一侧时，最小修补另一侧并执行：

```sh
pnpm record:i18n -- docs/foo.md
```

配对记录是“确认两侧一致”的动作，重录前先审阅两侧 diff。契约见 [i18n/README.md](i18n/README.md)。

## 备份、恢复与诊断

```sh
pnpm serve
node apps/cli/dist/cli.js backup
node apps/cli/dist/cli.js doctor
node apps/cli/dist/cli.js restore --backup <backup-dir> --data-dir <data-dir>
```

`restore` 要求服务已停止、目标目录不存在或为空；恢复完成后用同一 `--data-dir` 启动即可。新用户建议先 `serve` 建目录，备份目录在 `<data-dir>/backups/`。

## 本地钩子

`pnpm install:hooks` 安装三条窄钩子：

- `pre-commit` 拒绝暂存文本的尾随空白。
- `commit-msg` 要求提交标题包含 flow issue 引用 `(#N)`。
- `pre-push` 执行快速文档门禁。

钩子提供及时反馈，穷尽覆盖仍由 CI 承担。

## 单包发布

`apps/ztask` 是发布包 `ztask`。`pnpm build` 后用 `pnpm package:smoke` 在仓库外做安装冒烟。推送 `v<version>` 标签（须与包版本一致）或手动触发 `Release`：先创建带 tarball 的 GitHub Release，配置 `NPM_TOKEN` 时再发布 npm，否则跳过；之后配置 token 可重跑同版本补齐 npm。首次发布前确认包名与许可证。Release tarball 用 `npm install -g <url>` 安装；本地只打包用 `pnpm pack:ztask`。

## 流程与 CI

开工前把需求落到 `.agents/flow/` 的 roadmap、milestone 与 issue，规则见 [.agents/flow/README.md](../.agents/flow/README.md)。新 issue 用 `pnpm flow:new-issue` 生成，编号回填走 `pnpm flow:sync`，提交、PR 标题与 scope 由流程门禁对账。

CI 静态 lane 依次运行 `pnpm test`、`pnpm build` 和 `pnpm verify:docs`，PR 另跑流程 diff 校验。在线 lane 运行 `verify-flow-online`，只校验 GitHub 状态，不写远端。
