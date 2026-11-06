# 发布单包 ztask 并接入 CI 发布流水线

[English](m13-single-package-release.en.md) | 中文

```yaml flow
kind: issue
milestone: m13
priority: P1
status: in-progress
scope:
  - apps/ztask/**
  - apps/cli/**
  - scripts/**
  - tests/**
  - .github/workflows/**
  - .agents/**
  - package.json
  - pnpm-lock.yaml
  - README.md
  - README.en.md
  - README.i18n.yaml
  - docs/architecture.md
  - docs/architecture.en.md
  - docs/architecture.i18n.yaml
  - docs/development.md
  - docs/development.en.md
  - docs/development.i18n.yaml
  - .gitignore
  - reports/**
adr:
  - ../../notes/implemented/process/2026-11-05-single-package-release.md
github:
  number: 77
  url: https://github.com/Shadow-Azure/ZTask/issues/77
```

## 背景

ZTask 目前只能从仓库运行：安装要求 clone、pnpm 与 `pnpm build`，CLI 的 Web 静态目录写死为 monorepo 相对路径，版本号在 commander 里另写一份常量，仓库也没有任何发布流水线。用户已决定先做方案 A 的单包发布，最终把发布做成 CI 流水线。

## 目标

- 新增可发布的 `ztask` 包：把 CLI、server、shared 打成一个 ESM 产物，随包携带预构建 Web；`bin.ztask`、`files`、`engines`、仓库元数据齐备，`npm pack` 只产出一个 tarball。
- CLI 同时支持包内布局（`dist/cli.js` 旁）与 monorepo 布局（`apps/web/dist`）解析 Web；`--version` 与健康检查版本来自包内 `package.json`。
- CI 增加打包安装冒烟：在 clean 临时目录安装 tarball、启动、断言健康检查与 SPA 页面；PR 与 main 都跑。
- 新增 tag 或手动触发的发布工作流：校验 tag 与包版本一致，跑测试/构建/打包冒烟，先创建附带 tarball 的 GitHub Release；配置 `NPM_TOKEN` 时再执行 `npm publish --provenance`，缺省跳过并在日志说明。
- README 增加单包安装入口，开发文档补充发布步骤与所需凭据；写 Agent Note 记录打包与发布决策。

## 验收

- `pnpm build` 后 `npm pack`（`apps/ztask`）产出一个 tarball，解包只含 `dist/` 与包内 README，不含 workspace 源码。
- 干净临时目录 `npm install <tarball>` 后，`npx ztask --version` 等于包版本；`npx ztask serve --port 0 --no-open` 启动，`/api/v1/health` 返回 200 且版本一致，`/` 返回含 Vue 入口的 HTML。
- monorepo 内 `node apps/cli/dist/cli.js serve` 仍能加载 `apps/web/dist`，不回归。
- CI 的打包冒烟在 PR 上通过；发布工作流在无 `NPM_TOKEN` 时仍产出带 tarball 的 GitHub Release，配置 token 后额外完成 npm 发布。
- `pnpm test`、`pnpm lint:docs`、`pnpm verify:docs`、`pnpm verify:flow` 通过。
