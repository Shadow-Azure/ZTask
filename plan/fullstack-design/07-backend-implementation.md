# 07 · 后端实现设计

> 本文把业务规则落实到服务边界、文件协议、算法和测试。实现者不应再自行改变权限、单写者、聚合快照和恢复口径。

## 1. 启动装配

`bootstrap(options)` 执行明确顺序：

1. 校验 loopback port、可选 --lan、data-dir、timezone 与已保存 network.json。
2. 创建权限受限的数据目录，检查本地文件系统并获得单写者锁。
3. 校验 manifest，必要时先备份并执行可重入 migration。
4. 校验 current/revision tip，修复可确定的 JSONL 未完成尾部与落后 current，建立派生索引。
5. 装配共享 Service 与 HTTP 路由，先启动 loopback listener，再按 network.json/--lan 尝试恢复 LAN listener。
6. 打印管理 URL、分享状态和数据目录；loopback 失败则退出，LAN 失败则保持管理端可用并标记分享 degraded。

测试通过同一 `buildApp({store,clock,config})` 使用临时目录，不为测试复制路由或业务装配。

## 2. 文件存储基础设施

### 2.1 AtomicJsonWriter

接口负责 `writeJson(path,value)` 与 `readJson(path,schema)`。写入必须在同目录创建临时文件、完整写入、fsync、rename，并处理权限与清理；读取必须做 JSON Schema 和 formatVersion 校验。

临时文件写入失败时保留旧 current。任何自动清理只能针对明确属于本进程的临时文件，不能用通配符删除用户文件。

### 2.2 JsonlWriter/Reader

- append 一次写入完整记录字节和换行，并 flush/fsync。
- reader 流式逐行解析，支持按时间范围扫描，避免把全部 revision 读入内存。
- checksum 校验用于损坏检测；尾部恢复先复制原文件到诊断区。
- current.revisionTip 与尾部一致时启动走快路径；完整校验用于备份、恢复和显式 doctor 命令。

### 2.3 WriterLock 与 WriteQueue

启动锁覆盖整个数据目录。锁 compromised 时停止新写入并报警，不能继续假设自己唯一。

任务按 taskId 入队；share-link 按 memberId 入队；需要全局协调的 migration/backup 使用全局队列。version 检查、revision append 和 current 发布在同一个任务队列动作内完成。成员写请求还必须在同一队列边界内重新检查 session/link 有效、member 未归档、当前仍是主任务 owner，防止管理员移除 owner/归档成员与成员写入并发时沿用旧权限。

## 3. 身份实现

### 3.1 AdminAuth

`requireAdmin(request)` 同时检查 listenerKind=loopback 和 socket remoteAddress=loopback，LAN listener 上 Admin API 一律拒绝；默认忽略代理头。状态变更再校验 Origin/Fetch-Site。

### 3.2 ShareAuth

`exchangeShareToken(token)`：

1. 规范化并拒绝空/超长 token，SHA-256 后查当前 active share-link 文件。
2. 校验成员未归档，生成独立 sessionId 与高熵 verifier，只存 verifierHash。
3. 原子写 auth-sessions/<sessionId>.json，节流更新 link.lastUsedAt。
4. 设置 HttpOnly Cookie，返回最小成员摘要，不返回 raw token 或其他成员数据。

`requireMember` 每次校验 session、expiresAt、member archivedAt 和 shareLinkId 当前状态。重置/吊销删除 session 失败不影响最终失效，因为 linkId/status 校验会拒绝残留会话。`logout(sessionId)` 删除当前会话文件并清除 Cookie；文件不存在时保持幂等，返回 204。


### 3.3 NetworkService

`listInterfaces()` 返回当前本机非 loopback、非 wildcard 的具体地址及网卡描述，由管理员明确选择，不根据“看起来是内网”自动切换。`enableLan(host,port)`：

1. 仅接受 loopback Admin API 调用，验证 host 当前属于本机且不是 0.0.0.0/::。
2. 校验端口并启动使用共享 Service 的 LAN HTTP listener；请求标记 listenerKind=lan。
3. bind 成功后原子写 network.json，期望 enabled=true，并返回实际 shareBaseUrl。
4. 配置保存失败则关闭新 listener，恢复旧网络状态并返回错误。

`disableLan()` 先保存 enabled=false，再停止接收新连接，等待在途请求结束后关闭剩余 keep-alive 连接；保存失败则保持原入口，且不删除 token/session。更新 IP 时先启动新 listener、保存新配置，成功后关闭旧入口；保存失败只关闭新入口，旧分享继续可用。任何失败都显示脱敏错误，不静默选择其他地址。

重启先保证 loopback 管理端，再恢复 enabled 的 LAN 配置。IP 已失效或端口冲突只影响分享状态。ShareLinkService 在生成/复制 URL 前要求 LAN running，并从当前配置计算 URL；token 文件不随 base 变化。

## 4. FolderService

```ts
getTree(scope?: TaskScope): Promise<FolderTreeNode[]>
createFolder(input: {name: string; parentId: string | null}): Promise<Folder>
renameFolder(id: string, name: string): Promise<Folder>
getDescendantIds(folderId: string): Promise<string[]>
```

- 树由派生 `folderChildren` 索引生成，不做文件系统目录嵌套；文件夹层级是 JSON 字段，不是物理路径。
- create/rename 校验父夹、名称和同级重复提示，写单个 folder 文件后更新索引；share getTree(scope) 只返回含可见任务的任务夹及祖先，并按可见任务计算计数。
- 首版不开放移动/删除；未来移动必须防止新父为自身后代。
- 文件路径只接受服务端生成的 UUID，不能把用户 folder/task 名称用于路径，避免路径穿越和改名迁移。

## 5. TaskService

### 5.1 读取

`listTasks(scope,filters)` 从 current 索引得到主任务及小任务，批量组装 DTO，无 N+1 文件读取。搜索在完整派生索引上执行，再按 `createdAt ASC,id ASC` 稳定排序，以最后一项的 createdAt/id 生成 opaque cursor；新增任务不会导致页码跳号。

`getTaskForAdmin` 返回完整聚合；`getTaskForMember(id,memberId)` 先通过 assignmentsByMember 和当前 member 状态确定范围。主任务 owner/collaborator 可看完整聚合；仅分配给小任务的成员只看父任务上下文和被分配的小任务，不看主任务 detail 或其他小任务。个人页分组按主任务分配，subtask-only 只出现在只读事项跟踪。不能把全量结果交给前端再过滤。`patchTaskForAdmin(id,input)` 分别校验主任务字段与小任务字段，主任务返回 Task，小任务返回 Subtask+parent。

### 5.2 创建与层级

`createTask` 在主任务聚合队列中：

1. 校验 folder/parent、字段和有效成员。
2. parent 非空时加载父聚合，要求父为未删除主任务，继承 folderId。
3. 主任务生成 version=1 的新聚合；小任务在父聚合当前 version 上递增，并写入带 taskId 的 assignments。
4. 先追加 create revision，再发布 current，更新索引。
5. 主任务返回 Task/version=1；小任务返回 Subtask+parent 与父聚合递增后的 version。

主任务创建独立聚合；小任务创建必须进入父聚合写队列。小任务下再创建返回 422。

### 5.3 编辑器原子保存

`saveTaskEditor(taskId,editor)` 只操作一个任务聚合文件：队列内比较主任务 version，应用主任务属性、分配和小任务 create/update/delete，生成完整 after-state，追加 revision 并发布 current。任一校验失败不写文件。

不能通过“先删全部小任务再重建”实现编辑，否则会改变小任务 ID 与历史语义。按 clientId/已有 ID 计算差异，已有小任务必须属于当前聚合。

这里“原子”指单个聚合的文件恢复协议，不是声称文件系统提供通用多文件事务。

### 5.4 软删除

删除只修改目标任务聚合：追加带 deletedAt/changeKind=delete 的完整快照，再发布 current。普通树、成员个人页/只读事项跟踪和当前看板排除；历史查询按 revision 保留。

成员归档不级联修改任务聚合。任务中的 assignment ID 保留，activeOwners 派生索引排除 archived member，UI 显示待分配；归档完成后立即失效并重建 assignmentsByMember/activeOwnersByTask 等相关索引，索引未恢复前拒绝受影响读写。这避免一次归档重写大量文件，也避免旧权限残留。

## 6. RevisionService

```ts
commitTaskChange(input: {
  taskId: string
  expectedVersion: number
  mutate: (current: TaskAggregate) => TaskAggregate
  actor: Actor
  changeKind: RevisionKind
}): Promise<{aggregate: TaskAggregate, revision: RevisionResult | null}>
```

实现步骤固定为：队列内读 current → 检查 version → mutate/校验 → 比较确有变化 → 写完整 revision → 发布 current → 更新索引。实际变更返回 aggregate+revision；no-op 不写 revision 并返回 aggregate+revision=null。revision fsync 后即视为逻辑提交；后续步骤失败要立即从 revision 恢复 current/索引，恢复期间拒绝业务读写，持续失败则进入 degraded。

成员个人页或管理员编辑详情时，服务端接收并校验完整当前 detailText，生成新的完整聚合快照；不能用新值覆盖历史 revision。成员端不再使用只追加文本的专用算法。

小任务写操作先校验当前 member 是父主任务 owner，再校验 subtaskId 属于该聚合和任务层级最多两层。小任务请求只接受描述、进度、重要度和预计完成；新建时服务端把当前成员设为单 owner，任何任务分配变更与主任务删除都只能由管理员完成。

revision 始终保存完整 after-state。文本做空白规范化与长度限制，不提前 HTML 转义；前端按纯文本渲染。


## 7. ShareLinkService

- `generate`：已有 active link 返回 409，要求明确 rotate；LAN 未运行时返回 LAN_SHARE_DISABLED，完整 URL 使用当前 shareBaseUrl。
- `rotate`：原子替换该成员 share-link 文件为新 id/tokenHash，再删除关联 sessions；旧 session 因 id 不匹配立即无效。
- `revoke`：原子写 status=revoked/revokedAt，再清理 sessions；重复吊销幂等返回 204。
- `archiveMember`：先吊销链接，再写 member.archivedAt；残留任务 assignment 通过 active 索引失效。
- hash-only 策略下，完整 URL 只在 generate/rotate 响应出现；刷新后不能恢复旧 token。

### 7.1 MemberService

`listMembers()` 返回 active 成员与主任务负责/协作计数；`createMember(input)` 创建无链接成员；`updateMember(id,input)` 修改 name/role/color 并原子更新 member 文件与索引；`archiveMember` 与 ShareLinkService 在同一 member 写队列中按顺序执行：暂停该成员新写入 → 吊销 link 并使 session 失效 → 写 member.archivedAt → 立即失效并重建 assignments/activeOwners 等索引 → 恢复读取。archivedAt 写入前失败最多表现为链接已吊销但成员仍 active，不会产生越权；写入后失败则成员已归档，启动或重试时继续重建索引。任何阶段都不依赖残留 session 或旧索引授权，不伪装跨文件事务。
- 若选择可恢复 secret，必须单独评审文件权限与泄露风险，不能顺便在 member JSON 增加 rawToken。

## 8. DashboardService

### 8.1 Summary

`buildScope(folderId,memberIds,principal)` 遍历内存 folderChildren 得到后代，再用 activeTasksByFolder/activeOwners 过滤。member principal 先固定为 session.memberId 的相关任务集合，后续筛选只能缩小；admin principal 才是全范围。三桶互斥：done=100、gt50=51–99、lt50=0–50；小任务不重复计数，空 memberIds 表示全部。

时间分布在同一 current 集合上按 manifest 时区的今天计算。dueDate 首版必填，null 在写入时返回 422，不进入统计。

### 8.2 Changes

`resolveRange(input,clock)` 统一生成 `[start,end)`：default 为昨天 00:00 至 now，custom endDate 解析为次日 00:00。历史候选使用 historyTasksByFolder，包含软删除任务；成员权限按 after/delete 快照 assignment 与当前 active member 计算“当前相关任务的历史”。

对每个候选任务流式扫描 revisions：

- before 取 recordedAt<start 的最后一条，after 取 recordedAt<end 的最后一条；同毫秒以 taskVersion 决胜。
- after=null：忽略。
- before=null 且 after.changeKind=delete：deleted，before=null。
- before=null 且其他 after：created，不伪造旧状态。
- before/after 相同：忽略；progress/detail 不同则 updated。
- 只有分配/重要度变化：不进入当前 diff。
- currentlyDeleted 由查询时当前聚合 deletedAt 独立计算，changeKind=updated 也可能为 true；owners 取 after/delete 快照。

后端返回完整 before/after、changeKind 和 currentlyDeleted，前端使用 jsdiff diffLines 计算行级 diff，Vue 自研双列渲染，并将 currentlyDeleted=true 的项标记“当前已删除”且固定置底。存储不保存 diff 结果。

## 9. 备份与恢复实现

在线备份作为全局写队列动作：暂停新 mutation → 等待在途写入 → 复制数据到临时备份目录（排除 locks/tmp/backups）→ 校验 manifest/JSON/JSONL → 写备份校验报告 → 原子发布备份 → 恢复写入。

恢复不直接在唯一正式目录上边读边覆盖：先在独立目录展开并完整校验，再停止服务、切换目录、重新执行启动恢复和索引构建。提供 doctor 只读校验命令，区分可自动修复与需要备份介入的问题。

## 10. 错误与并发测试矩阵

| 用例 | 预期 |
| --- | --- |
| 小任务下再创建 | 422，无文件变化 |
| owner 与 collaborator 重复 | 422，无 revision/current 变化 |
| 归档成员被提交为新负责人 | 422 |
| 两个管理员会话并发编辑同一聚合 | 队列内一个 version 成功，另一个 409 |
| 动态开启非法/非本机/wildcard IP | 422，不启动 listener、不写 network.json |
| LAN bind 成功但 network.json 保存失败 | 关闭新 listener，回滚到原状态 |
| 重启时保存的 LAN IP 已失效 | loopback 正常，分享 degraded，不自动换地址 |
| 小任务编辑器含他任务 ID | 422/404，不写文件 |
| revision append 失败 | current 保持旧版，返回失败 |
| append 后 current 前崩溃或 current 发布失败 | 立即/重启后由最新完整 revision 重建 current；恢复前拒绝业务读写 |
| current 后 index 前失败 | 文件保持新版，重建索引后一致；重建期间 store not-ready |
| JSONL 最后半行 | 备份原文件后修复未完成尾部，不动有效前缀 |
| 中间 checksum 损坏 | 拒绝静默修复，要求诊断/恢复 |
| A 请求 B task | 404，不读取/返回 B 的 DTO |
| owner 在个人页保存进度/完整详情或管理小任务 | 校验主任务 owner 与 version，写 current + 完整 revision，actor=member |
| collaborator 写进度/详情/小任务，或 owner 创建第三层任务 | 403，文件与 revision 均不变化 |
| 成员请求团队目录/成员管理 | 无此页面或端点；相关任务只含脱敏成员摘要 |
| rotate 后旧 Cookie/session 文件残留 | 401，linkId 校验拒绝 |
| 同毫秒多个 revision | taskVersion 决定 as-of 顺序 |
| 区间内创建 | before=null，不伪造旧状态 |
| start 恰好有变更 | 包含在 [start,end) 内，不漏算 |
| 当前已删除任务有历史变化 | 历史候选仍包含，响应 currentlyDeleted=true，前端徽章并置底 |
| 同区间创建后删除 | changeKind=deleted，before=null，不重复标 created |
| no-op 保存 | 不写 revision，返回当前聚合与 revision=null |

## 11. 后端验收场景

1. 临时目录启动，默认仅 loopback；动态开启具体 LAN IP 后成员可访问，重启按配置恢复，IP 失效不影响管理端。
2. 创建任务夹树、A/B、主任务和小任务，派生索引返回正确后代与分配。
3. A/B 各交换链接，只见自己相关任务；管理员 API 对成员 Cookie 仍为 403。
4. A 在个人页保存负责任务进度、编辑完整详情并管理小任务，B 的协作任务只读；双方事项跟踪均只读，管理员与成员历史查询只看到各自权限范围内的 before/after。
5. rotate A 链接，旧 URL/Cookie 失效，即使旧 session 文件被人为保留也不能用。
6. 故障注入覆盖 append/current/index 各阶段，重启或索引重建后无半状态。
7. 在线备份后在全新目录恢复，文件、历史、链接状态和校验报告完整。
