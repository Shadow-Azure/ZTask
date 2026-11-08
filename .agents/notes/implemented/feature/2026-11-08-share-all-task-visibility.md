# Agent Note: 成员链接全员可见与负责人写边界

Status: implemented

[English](2026-11-08-share-all-task-visibility.en.md) | 中文

## Problem

[02](../../../../plan/fullstack-design/02-features.md) §4–5 与 [05](../../../../plan/fullstack-design/05-api-design.md) §6 原先只让成员查看与自己相关（主任务 owner/collaborator 或小任务被分配者）的任务，事项跟踪和看板/历史也按同一范围裁剪。用户确认新口径：成员可查看团队全部任务，只有负责人能编辑自己负责的任务内容，个人页按“我负责 / 我协作 / 其他成员”三组展示且默认展开、标题可折叠。这个决定改变了分享链接的隐私边界、API 读范围、个人页分组、事项跟踪/看板/历史数据源和测试假设，必须记录取舍与后果。

## Decision

- **读范围全员化**：所有未软删除主任务、任务夹、看板与历史对有效成员会话开放。`GET /share/tasks?view=home` 返回 `owned / collaborated / others` 三组，三组不重不漏；tracker 与任务夹树返回团队全量，树保留空任务夹并与管理端同构。
- **DTO 完整化**：`toMemberTask` 保留完整 `detail` 与全部未删除小任务；`ShareTaskDetail.memberRole` 增加 `viewer`（与当前成员无主任务分配）。看板/历史不再按 `shareMemberId` 裁剪，`memberIds` 只按主任务 owner 过滤。
- **写权限不变**：只有主任务 owner 能写进度、完整详情与一层小任务；非 owner（collaborator、仅小任务被分配者、其他成员）返回 403 `OWNER_REQUIRED`；不存在/软删除任务或小任务 id 返回 404 `TASK_NOT_FOUND`。成员仍不能修改主任务描述、分配、重要度、预计完成、folderId 或删除主任务。
- **个人页交互**：三组标题默认展开，点击标题折叠/展开并保留分组计数；标题是带 `aria-expanded`/`aria-controls` 的按钮，支持 Enter / Space。其他成员卡标“其他成员 · 只读”。
- **原型先行**：`plan/m1-01-ui-prototype/ztask-prototype.html` 已按确认后的三组、只读标识和折叠交互更新，作为应用实现基准。

## Alternatives considered

- 保持 owner/collaborator 可见范围：隐私更强，但不符合用户明确确认的“团队全部任务可见”，否决。
- 全员可见且全员可编辑：越权，且与成员最小写边界冲突，否决。
- 只让事项跟踪全员可见、个人页保持两组：同一成员在两个页面看到不同任务集合，用户已确认个人页三组，否决。
- 新增“公开任务”字段做逐任务可见性：模型与迁移成本高，用户要求的是团队全量，否决。
- 保留 `shareMemberId` 裁剪分支：成为永远不会走到的死代码，误导后续实现，删除。

## Consequences

- 分享链接成为团队任务的只读目录：任何持有有效链接的成员都能读取全部任务描述、详情、小任务、看板与历史。未来若需要私密任务，必须另立可见性模型，不能只在现有链接上加开关。
- 成员写权限仍只按 owner；权限测试从“他人任务 404”改为“全员可见 200 + viewer，非 owner 写 403”。
- 看板、历史、任务夹树的成员裁剪分支被删除，实现与测试更简单；`memberIds` 变成普通的 owner 过滤。
- 三组折叠只保留在当前页面会话内，刷新后回到默认展开；不做跨设备/跨会话持久化。
