# 开发流程门禁

[English](README.en.md) | 中文

流程树是 roadmap → milestone → issue 三层文档，配 `yaml flow` 围栏声明结构化数据，规则与 `scripts/flow-lib.mjs` 的封闭集合互为镜像。

## 当前状态：未初始化

ZTask 尚未建流程树：没有 roadmap、`milestones/`、`issues/`。门禁行为：`pnpm verify:flow` 输出「未初始化跳过」通过；PR 的 `--diff` 模式在 base 无 roadmap 时同样跳过。初始化是独立决策，先写 roadmap 再开树。

## 层级与数据

- roadmap：`milestones:` 列表定 milestone 顺序，是唯一序列权威。
- milestone：`milestones/m{id}-{slug}.md`，字段 `id` / `title` / `status`（`planned` / `active` / `done`）/ `github`（`{number, url}`，未同步时均 null）。
- issue：`issues/{milestone}-{slug}.md`，字段 `id`（`{milestone}-NN` 稳定编号）/ `milestone` / `depends` / `priority`（`P0` / `P1` / `P2`）/ `status`（`backlog` / `ready` / `in-progress` / `done`）/ `scope`（glob 列表）/ `adr` / `github`。

## 规则要点

- 状态机：issue 只能沿 backlog → ready → in-progress → done 单向流转；依赖须存在、须在更早 milestone、不得成环；milestone 全部 issue done 后才能 done。
- issue 中文正文十段逐字：背景 / 目标 / 设计依据 / 实现内容 / 实施步骤 / 依赖与交付边界 / 独立验证 / 验收标准 / 门禁与 CI / 非目标。
- 提交与 PR 标题须挂 `(#N)`；引用的 issue 须 ready / in-progress；diff 触及文件须落在所挂 issue 的 scope 并集。无豁免通道。

## GitHub 双侧

写 GitHub 的唯一入口是 `pnpm flow:sync`（建对象、回填编号、对齐状态）；`pnpm verify:flow-online` 只校验双侧一致。工具：`pnpm flow:new-issue` 建 issue 三件套脚手架。
