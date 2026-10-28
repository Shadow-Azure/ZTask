# 架构（初始阶段）

[English](architecture.en.md) | 中文

## 形态

初始阶段只有一个仓库、一套 Node 工具链（pnpm），没有产品代码。仓库当前由三部分组成：

- `docs/`：常驻文档（双语三件套 + 门禁）。
- `.agents/`：Agent Note 体系与开发流程规则（流程树未初始化）。
- `scripts/`：门禁脚本与流程工具（纯 Node，无构建步骤）。

## 技术约束

- 门禁脚本只用 Node 标准库 + typescript 编译器 API，不引入运行时依赖；devDependencies 仅 typescript 与 @redocly/ajv（门禁自测试用）。
- 文档字节级门禁（blob hash、配对记录）要求仓库文本形态统一 LF，由 `.gitattributes` 强制。
- 产品技术选型未定；选型时先改本文件再写代码。

## 演进方向

第一批产品能力预计围绕「进度建模」展开；届时补模块边界、数据流与接口契约章节，并把可执行约束下沉成新的门禁。
