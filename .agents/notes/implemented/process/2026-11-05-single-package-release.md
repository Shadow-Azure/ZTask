# Agent Note: 单包发布与 tag 驱动的 CI 发布

Status: implemented

[English](2026-11-05-single-package-release.en.md) | 中文

## Problem

ZTask 的安装路径一直面向贡献者：要 clone 仓库、装 pnpm、跑 `pnpm build`，再从 `apps/cli/dist` 启动。CLI 把 Web 静态目录写死成 monorepo 相对路径 `../../web/dist`，版本号在 commander 里复制了一份常量，仓库也没有发布流水线。方案 A 要求非开发者只装 Node 就能运行，并把发布做成可复现的 CI 流程。

## Decision

新增 workspace 包 `apps/ztask`（发布名 `ztask`），以 esbuild 把 `@ztask/cli`、`@ztask/server`、`@ztask/shared` 的构建产物打成单个 ESM 入口，第三方依赖（fastify、@fastify/*、commander）保持 external 走 package.json 的 dependencies；`apps/web/dist` 复制到包内 `dist/web`。CLI 的 Web 目录解析同时接受“包内 `dist/web`”与“monorepo `apps/web/dist`”，版本从包内 `package.json` 读取，保证两种布局一致。

发布由两条流水线承担：PR/main 的 CI 增加打包安装冒烟（`npm pack` → clean 目录安装 → 启动 → 健康检查与 SPA 断言）；推送 `v*` 标签或手动触发时运行发布工作流，校验 tag 与包版本一致，复用测试、构建与冒烟后先创建附带 tarball 的 GitHub Release；配置了仓库 secret `NPM_TOKEN` 时再执行 `npm publish --provenance`，未配置则跳过 npm 并保留可安装的 Release 资产。

## Alternatives considered

- 发布 `@ztask/cli` + `@ztask/server` + `@ztask/shared` 多包：安装名与版本要跨三个包对齐，用户仍可能装出错配组合；与“单包”要求相悖，否决。
- 只把 web 产物塞进 CLI 包、服务端继续依赖 workspace 包：发布后 `@ztask/server` 无法从 npm 解析，等于仍要多包，否决。
- 先做 Docker 镜像：容器解决了运行环境，但 `npx ztask` 这条最轻路径仍不可用；方案 A 先交付单包，Docker 留给后续阶段，否决。
- 用 `tsc` 多项目把三包编译进同一目录：模块说明符不会重写，包内相对布局与源码目录耦合，否决。

## Consequences

- 发布前必须先 `pnpm build`（或由 `prepack` 触发流水线构建），否则 tarball 可能缺 `dist/`；CI 与本地冒烟都按“构建后再 pack”执行。
- esbuild 成为 `apps/ztask` 的构建依赖；升级 Node 目标时需同步 `engines` 与 esbuild target。
- 首次公开发布不依赖 npm：GitHub Release 先产出可安装的 tarball；配置 `NPM_TOKEN` 后才额外发布到 npm。包名与许可证仍需维护者确认。
- 单包使 npm 安装体积包含 Web 产物；后续若要发布 Docker 镜像，可复用同一 `dist`，不需要改业务代码。
