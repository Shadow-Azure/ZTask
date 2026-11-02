# Agent Note: 分享会话的信任边界与会话生命周期

Status: implemented

[English](2026-11-02-share-session-boundary.en.md) | 中文

## Problem

分享链接只是凭证：真正隔离成员数据的是「令牌换 HttpOnly 会话 + 每请求重校验 + 按 memberId 裁剪查询」，前端隐藏入口不构成授权。[全栈设计](../../../../plan/fullstack-design/05-api-design.md) 05 §6 与 [07](../../../../plan/fullstack-design/07-backend-implementation.md) §3.2 已经定了会话交换、Cookie 属性和失效语义，但没定「无效令牌返回 401 还是 404」、分享链接的生成/重置/吊销该由哪个 issue 交付、成员可见树该复用管理端树还是另写一份。这三处如果各实现一份，会在 #19（成员写入）与 #20（链接生命周期）之间产生互相矛盾的权限口径。

## Decision

- **凭证边界**：raw token 只出现在 `POST /share/session` 的 body；服务端只落 SHA-256（`share-links/<memberId>.json`），会话只落 `verifierHash`（`auth-sessions/<sessionId>.json`）；`Cookie` 值形如 `<sessionId>.<verifier>`，属性 `HttpOnly; SameSite=Strict; Path=/api/v1/share; Max-Age=30d`。
- **每请求重校验**：session 文件存在 → verifierHash 常量时间比对 → 未过期 → 成员未归档 → `shareLinkId` 仍是 active 链接。吊销即时生效靠最后一步，不依赖删除会话文件。
- **错误码选型**：交换失败统一 `401 SHARE_LINK_INVALID`（未知凭证按认证失败处理）；会话缺失/过期 `401 SHARE_SESSION_REQUIRED`；不相关任务 `404 TASK_NOT_FOUND`（不泄露存在性）。交换端点按来源 IP 固定窗口限流，超限 `429 SHARE_EXCHANGE_RATE_LIMITED`。
- **归属与只读**：#18 只交付会话与只读查询；分享链接的生成/重置/吊销端点归 #20，成员个人页写入归 #19。#18 的测试用 fixtures 直接播种 link 文件，不把铸造逻辑提前塞进生产代码。tracker 在成员域不渲染也不注册任何写 mutation。
- **单一 scope 构造点**：成员可见任务由 `share-scope` 一处判定（主任务 owner/collaborator，或可见小任务的被分配者），任务夹树复用 `folder-service.tree(成员可见聚合)`，不再另写一份树构建与计数。
- **仅小任务被分配者的口径**（05 §6.4/§6.5 与 07 §5.1 冲突时的取舍）：以更严格的 07 §5.1 为准——他们只出现在只读事项跟踪，看得到父任务上下文与自己被分配的小任务，但主任务 `detail` 在 DTO 中抹掉、其他小任务不可见；个人页的「我负责的/我协作的」按主任务分配分组，不包含 subtask-only。

## Alternatives considered

- 无效令牌返回 404（05 §7 错误表把 `SHARE_LINK_INVALID` 与 404 同列）：与「凭证无效即认证失败」的语义不符，也会让前端难以用统一 401 分支进失效页；保留 401 并在 PR 中记录这一偏差。
- 持久化 raw token 以便管理员随时复制：省一次「重置」，但把长期凭证写进磁盘，否决；#20 采用「只存哈希 + 重新生成」。
- 为成员树另写 `buildMemberTree`：实现更快，但计数口径与 folder service 漂移，同一棵树在管理端与成员端会出现不一致。
- 在 #18 内顺手实现链接铸造/轮换：与 #20 的 lifecycle 端点重复，并会让 #18 承担「重置不失效旧会话」这类本该由轮换语义处理的问题。

## Consequences

- **#20 的硬约束**：重置必须换成新的 `linkId`（必要时删除旧会话文件），否则旧 Cookie 在 `shareLinkId` 校验下继续有效。
- 会话与链接都按文件扫描，成员/链接数量增长后需要索引（欠账，v1 规模可接受）。
- 前端把成员域 401 统一收敛为「清 share 缓存 + 进失效页」；管理端 401 不走这条路径，避免误伤。
- #19 接入成员写入时必须在写队列内重校验 session、link 状态与 owner 角色（07 §37），不能只依赖前端禁用。
- 会话文件按成员累积、过期只判断不删除，清理与链接重置/审批一起留给 #20；限流为单进程内存固定窗口，开 LAN 前需按 NAT/多 listener 重评阈值。
