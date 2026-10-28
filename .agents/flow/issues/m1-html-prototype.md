# ZTask Web HTML 原型设计与对齐

[English](m1-html-prototype.en.md) | 中文

```yaml flow
kind: issue
id: m1-01
milestone: m1
depends: []
priority: P0
status: ready
scope:
  - design/prototype/**
  - .agents/flow/issues/m1-html-prototype*
adr: []
github:
  number: 3
  url: https://github.com/Shadow-Azure/ZTask/issues/3
```

## 背景

ZTask 的最终形态是参考 DeepSeek Harness 的大体架构：本地起 CLI 服务，用户通过 Web 端访问。在写任何实现代码之前，需要先在 Web 端把界面形态对齐，原型是后续一切设计的基准。

## 目标

- 与用户讨论并确定信息架构与界面清单。
- 产出一套可在浏览器中交互浏览的静态 HTML 原型，覆盖清单中的全部界面与关键交互。
- 逐屏评审迭代，最终取得用户对原型的定稿确认。

## 设计依据

- 形态蓝本：DeepSeek Harness（本地 CLI + Web GUI 的单页访问形态）。
- 本 issue 先行，无既有设计文档；原型定稿即是 m1-02 设计文档的输入。

## 实现内容

- `design/prototype/` 目录下的静态原型：`index.html` 原型导航页，加界面清单中每个界面一个静态 HTML 页（内联 CSS/JS 即可，不引前端框架）。
- 本地以静态文件服务器起原型站点，供浏览器评审。

## 实施步骤

1. 与用户对齐界面清单与每屏的关键元素、交互。
2. 搭原型导航页，逐屏实现静态 HTML。
3. 本地起静态服务，逐屏收集反馈并迭代。
4. 用户确认定稿，归档原型目录。

## 依赖与交付边界

- 依赖：无。
- 交付边界：静态原型与界面清单本身；不含任何构建工具、框架选型与真实数据。

## 独立验证

```sh
python3 -m http.server 8123 --directory design/prototype
```

- 浏览器打开 `http://127.0.0.1:8123/`，可从导航页到达清单中的每个界面并完成关键交互演示。

## 验收标准

- 原型覆盖已对齐的界面清单，无缺屏。
- 用户逐屏看过并明确表示定稿。
- `pnpm lint:docs` 与 `pnpm verify:flow` 绿。

## 门禁与 CI

- 原型目录内的 Markdown（如有说明文件）受双语三件套与换行门禁管辖。
- CI 现有 build-and-docs 与 flow-online 双 lane 全量覆盖。

## 非目标

- 不做前端框架与工程化选型。
- 不写设计文档（属 m1-02）。
- 不实现任何真实前后端逻辑。
