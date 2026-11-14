# 阶段 13：单包发布与 CI 发布流水线

[English](m13-single-package-release.en.md) | 中文

```yaml flow
kind: milestone
id: m13
title: 阶段 13：单包发布与 CI 发布流水线
status: done
github:
  number: 13
  url: https://github.com/Shadow-Azure/ZTask/milestone/13
```

仓库内可构建运行，但安装仍要求 clone、pnpm 与本地构建。本阶段把 CLI、服务端与 Web 构建产物收进一个可发布的 `ztask` 包，用 CI 打包、冒烟并在版本标签上发布。

## 交付边界

- 只做单包发布：`npm pack` 产物包含 CLI、server、shared 与预构建 Web；不发布多个 workspace 包。
- 版本标签触发发布：构建、测试、打包冒烟、npm 发布与 GitHub Release 串行完成。
- 不引入 Docker、桌面壳、自动更新或账号体系；业务、存储与权限模型不变。

## 阶段验收

- 干净目录安装 tarball 后，`npx ztask serve` 启动管理端与 API，Web 资源来自包内路径。
- PR 上持续运行打包安装冒烟；打 `v*` 标签时 CI 能产出 npm 包与 GitHub Release（凭据就绪后）。
- 文档给出安装、发布与所需凭据的最小说明。
