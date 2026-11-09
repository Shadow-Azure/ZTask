# 07 · 后端实现设计

> 本文把业务规则落实到服务边界、存储协议、算法和测试。实现者不应再自行改变权限、单写者、聚合快照和恢复口径。

## 1. 启动装配

`bootstrap(options)` 执行明确顺序：

1. 校验 loopback port、可选 --lan、data-dir、timezone 与已保存的 `network_config`。
2. 创建权限受限的数据目录，检查本地文件系统并获得单写者锁。
3. 打开数据库，校验 schema 版本，必要时先备份并执行可重入 migration。
4. 执行 `quick_check`、外键与 aggregate/revision 一致性校验；不重建 current，也不建立内存派生索引。
5. 装配共享 Service 与 HTTP 路由，先启动 loopback listener，再按 `network_config`/--lan 尝试恢复 LAN listener。
6. 打印管理 URL、分享状态和数据目录；loopback 失败则退出，LAN 失败则保持管理端可用并标记分享 degraded。

测试通过同一 `buildApp({store,clock,config})` 使用临时目录，不为测试复制路由或业务装配。

## 2. 存储基础设施

### 2.1 Database 与事务

`db.ts` 负责打开 `better-sqlite3` 连接（Kysely `SqliteDialect`）、设置 pragma、提供 `transaction(fn)` 封装和关闭。连接是进程内单例；写事务使用 `BEGIN IMMEDIATE`，异常一律 `ROLLBACK` 后按现有错误类型抛出。业务层不直接持有 SQL 语句，仓储函数集中在 `storage/`。

连接打开后必须设置 `journal_mode=WAL`、`synchronous=FULL`、`foreign_keys=ON`、`busy_timeout=5000`、`trusted_schema=OFF`。数据库文件和数据目录权限在创建时收紧；sidecar 文件同样按 0600 校验。

### 2.2 Schema 与 checksum

`schema.ts` 保存当前 DDL 和索引；`migrations/` 保存按版本排序的迁移函数。`PRAGMA user_version` 与 `schema_migrations` 同步更新，迁移在事务内执行，失败回滚并保留迁移前 `VACUUM INTO` 备份。

`checksum.ts` 继续提供规范化 JSON 的 SHA-256，用于 `task_revisions.checksum`；它只负责逻辑完整性，不替代 SQLite 的页完整性检查。

### 2.3 WriterLock 与 WriteQueue

启动锁覆盖整个数据目录。锁 compromised 时停止新写入并报警，不能继续假设自己唯一。

任务按 taskId 入队；share-link 按 memberId 入队；migration/backup 使用全局队列。version 检查、revision 插入、当前状态更新和 tip 更新在同一个事务动作内完成。成员写请求还必须在同一队列边界内重新检查 session/link 有效、member 未归档、当前仍是主任务 owner，防止管理员移除 owner 或归档成员与成员写入并发时沿用旧权限。

## 3. 身份实现

### 3.1 AdminAuth

`requireAdmin(request)` 同时检查 listenerKind=loopback 和 socket remoteAddress=loopback；LAN listener 上只有有效管理员成员会话（每请求重读 `members.is_admin`）放行，其余一律拒绝。默认忽略代理头。状态变更再校验 Origin/Fetch-Site。

### 3.2 ShareAuth

`exchangeShareToken(token)`：

1. 规范化并拒绝空/超长 token，SHA-256 后查当前 active `share_links` 行。
2. 校验成员未归档，生成独立 sessionId 与高熵 verifier，只存 verifierHash。
3. 事务插入 `auth_sessions` 行，节流更新 link.lastUsedAt。
4. 设置 HttpOnly Cookie，返回最小成员摘要，不返回 raw token 或其他成员数据。

`requireMember` 每次校验 session、expiresAt、member archivedAt 和 shareLinkId 当前状态。重置/吊销删除 session 失败不影响最终失效，因为 linkId/status 校验会拒绝残留会话。`logout(sessionId)` 删除当前会话行并清除 Cookie；行不存在时保持幂等，返回 204。


### 3.3 NetworkService

`listInterfaces()` 返回当前本机非 loopback、非 wildcard 的具体地址及网卡描述，由管理员明确选择，不根据“看起来是内网”自动切换。`enableLan(host,port)`：

1. 仅接受 loopback Admin API 调用，验证 host 当前属于本机且不是 0.0.0.0/::。
2. 校验端口并启动使用共享 Service 的 LAN HTTP listener；请求标记 listenerKind=lan。
3. bind 成功后事务写 `network_config`，期望 enabled=true，并返回实际 shareBaseUrl。
4. 配置保存失败则关闭新 listener，恢复旧网络状态并返回错误。

`disableLan()` 先保存 enabled=false，再停止接收新连接，等待在途请求结束后关闭剩余 keep-alive 连接；保存失败则保持原入口，且不删除 token/session。更新 IP 时先启动新 listener、保存新配置，成功后关闭旧入口；保存失败只关闭新入口，旧分享继续可用。任何失败都显示脱敏错误，不静默选择其他地址。

重启先保证 loopback 管理端，再恢复 enabled 的 LAN 配置。IP 已失效或端口冲突只影响分享状态。ShareLinkService 在生成/复制 URL 前要求 LAN running，并从当前配置计算 URL；链接记录不随 base 变化。

## 4. FolderService

```ts
getTree(scope?: TaskScope): Promise<FolderTreeNode[]>
createFolder(input: {name: string; parentId: string | null}): Promise<Folder>
renameFolder(id: string, name: string): Promise<Folder>
getDescendantIds(folderId: string): Promise<string[]>
```

- 树由 `folders` 表一次查询后在服务层组装，不做文件系统目录嵌套；文件夹层级是 `parent_id`，不是物理路径。
- create/rename 校验父夹、名称和同级重复提示，事务更新 `folders` 行；share getTree 返回完整团队树（含空夹），与管理端同构。
- 首版不开放移动/删除；未来移动必须防止新父为自身后代。
- 实体 ID 只接受服务端生成的 UUID，不能把用户 folder/task 名称用于查询或存储键，避免歧义和注入面扩大。

## 5. TaskService

### 5.1 读取

`listTasks(scope,filters)` 用 SQL 查询得到主任务及小任务，批量组装 DTO，无 N+1。`filters` 包含 `q`、`importance` 和 `ownerIds`，三者取交集。搜索在团队全部任务集合上执行，再按 `createdAt ASC,id ASC` 稳定排序，以最后一项的 createdAt/id 生成 opaque cursor；新增任务不会导致页码跳号。

### 5.1.1 负责人筛选

`ownerIds` 为空或缺省表示不筛选；非空时从 `assignments` 表判断，口径与旧 `activeOwnersByTask`/`activeSubtaskOwnersByTask` 一致：任一 ID 是主任务有效 owner，则保留整条任务及全部小任务；否则只把该 ID 负责的有效小任务组装进 DTO，父任务没有任何命中小任务时丢弃。主任务的 `owners/collaborators` 始终完整返回。过滤在分页前完成，分页计数按过滤后的主任务，而不是按小任务；未知或归档成员 ID 不命中也不报错，非法 UUID 在 query 校验阶段返回 400。该参数只由管理员任务列表使用，分享域不暴露。

`getTaskForAdmin` 返回完整聚合；`getTaskForMember(id,memberId)` 返回团队全部任务的完整聚合（描述、detail、全部未删除小任务），用 `memberRole` 标注 owner / collaborator / viewer。个人页按主任务分配三组；subtask-only 归入 others。`patchTaskForAdmin(id,input)` 分别校验主任务字段与小任务字段，主任务返回 Task，小任务返回 Subtask+parent。

### 5.2 创建与层级

`createTask` 在主任务聚合队列中：

1. 校验 folder/parent、字段和有效成员。
2. parent 非空时加载父聚合，要求父为未删除主任务，继承 folderId。
3. 主任务生成 version=1 的新聚合；小任务在父聚合当前 version 上递增，并写入带 taskId 的 assignments。
4. 在同一个事务内插入 create revision、当前状态行和 aggregate tip。
5. 主任务返回 Task/version=1；小任务返回 Subtask+parent 与父聚合递增后的 version。

主任务创建独立聚合；小任务创建必须进入父聚合写队列。小任务下再创建返回 422。

### 5.3 编辑器原子保存

`saveTaskEditor(taskId,editor)` 只操作一个聚合事务：队列内比较主任务 version，应用主任务属性、分配和小任务 create/update/delete，生成完整 after-state，在同一事务插入 revision 并更新当前状态。任一校验失败回滚，不写库。

不能通过“先删全部小任务再重建”实现编辑，否则会改变小任务 ID 与历史语义。按 clientId/已有 ID 计算差异，已有小任务必须属于当前聚合。

这里“原子”指 SQLite 的跨表事务，不是把多个独立聚合合并成一个大事务。

### 5.4 软删除

删除只修改目标任务聚合：在同一事务追加带 deletedAt/changeKind=delete 的完整快照并更新当前状态。普通树、成员个人页/只读事项跟踪和当前看板排除；历史查询按 revision 保留。

成员归档不级联修改任务聚合。任务中的 assignment ID 保留，查询按 `members.archived_at` 排除 archived member，UI 显示待分配；归档事务提交后新查询立即生效，不需要重建索引。这避免一次归档重写大量任务行，也避免旧权限残留。

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

实现步骤固定为：队列内读当前聚合 → 检查 version → mutate/校验 → 比较确有变化 → 同一事务写完整 revision、当前状态和 tip → 提交。实际变更返回 aggregate+revision；no-op 不写 revision 并返回 aggregate+revision=null。事务提交即逻辑提交；提交失败整体回滚，不回退到“先写历史再补当前”的分步恢复。

成员个人页或管理员编辑详情时，服务端接收并校验完整当前 detailText，生成新的完整聚合快照；不能用新值覆盖历史 revision。成员端不再使用只追加文本的专用算法。

小任务写操作先校验当前 member 是父主任务 owner，再校验 subtaskId 属于该聚合和任务层级最多两层。小任务请求只接受描述、进度、重要度和预计完成；新建时服务端把当前成员设为单 owner，任何任务分配变更与主任务删除都只能由管理员完成。

revision 始终保存完整 after-state。文本做空白规范化与长度限制，不提前 HTML 转义；前端按纯文本渲染。


## 7. ShareLinkService

- `generate`：已有 active link 返回 409，要求明确 rotate；LAN 未运行时返回 LAN_SHARE_DISABLED，完整 URL 使用当前 shareBaseUrl。
- `rotate`：在同一事务内删除关联 sessions、替换该成员链接行为新 id/tokenHash；旧 session 因 id 不匹配立即无效。
- `revoke`：在同一事务内写 status=revoked/revokedAt 并清理 sessions；重复吊销幂等返回 204。
- `archiveMember`：在同一事务内吊销链接、删除 session、写 member.archivedAt；残留任务 assignment 通过 `members.archived_at` 失效。
- hash-only 策略下，完整 URL 只在 generate/rotate 响应出现；刷新后不能恢复旧 token。

### 7.1 MemberService

`listMembers()` 返回 active 成员与主任务负责/协作计数；`createMember(input)` 创建无链接成员；`updateMember(id,input)` 修改 name/role/color 并事务更新 `members` 行；`archiveMember` 与 ShareLinkService 在同一 member 写队列中执行暂停新写入 → 同一事务吊销 link、删除 session、写 member.archivedAt → 恢复读取。事务提交前失败则链接和成员都保持原状；提交后失败只会表现为成员已归档、链接已吊销，不会产生越权。任何阶段都不依赖残留 session 或旧缓存授权。
- 若选择可恢复 secret，必须单独评审数据库权限与泄露风险，不能顺便在 `members` 表增加 rawToken。

## 8. DashboardService

### 8.1 Summary

`buildScope(folderId,memberIds)` 用 SQL 递归查询任务夹后代，再按任务和 owner 筛选。管理员与成员都是全范围；`memberIds` 只是 owner 口径的合法缩小。三桶互斥：done=100、gt50=51–99、lt50=0–50；小任务不重复计数，空 memberIds 表示全部。

时间分布在同一当前任务集合上按 `meta.time_zone` 的今天计算。dueDate 允许 null（未设置）；null 不进入预计完成分布。

### 8.2 Changes

`resolveRange(input,clock)` 统一生成 `[start,end)`：default 为昨天 00:00 至 now，custom endDate 解析为次日 00:00。历史候选使用 historyTasksByFolder，包含软删除任务；管理员与成员都看团队全部历史，`memberIds` 按 after/delete 快照的主任务 owner 过滤。

对每个候选任务查询 `task_revisions`：

- before 取 recordedAt<start 的最后一条，after 取 recordedAt<end 的最后一条；同毫秒以 taskVersion 决胜。
- after=null：忽略。
- before=null 且 after.changeKind=delete：deleted，before=null。
- before=null 且其他 after：created，不伪造旧状态。
- before/after 相同：忽略；progress/detail 不同则 updated。
- 只有分配/重要度变化：不进入当前 diff。
- currentlyDeleted 由查询时当前聚合 deletedAt 独立计算，changeKind=updated 也可能为 true；owners 取 after/delete 快照。

后端返回完整 before/after、changeKind 和 currentlyDeleted，前端使用 jsdiff diffLines 计算行级 diff，Vue 自研双列渲染，并将 currentlyDeleted=true 的项标记“当前已删除”且固定置底。存储不保存 diff 结果。

## 9. 备份与恢复实现

在线备份作为全局写队列动作：暂停新 mutation → 等待在途事务 → 在临时备份目录内 `VACUUM INTO` 出单文件数据库快照 → 对副本跑 integrity_check/foreign_key_check/schema 与引用校验 → 写备份校验报告 → 原子发布备份 → 恢复写入。

恢复不直接在唯一正式目录上边读边覆盖：先在独立目录展开并完整校验，再停止服务、切换目录、重新执行启动校验；旧格式备份先经导入器转成 SQLite。提供 doctor 只读校验命令，SQLite 事务使可自动修复的问题基本消失，结构性问题需要备份介入。

## 10. 错误与并发测试矩阵

| 用例 | 预期 |
| --- | --- |
| 小任务下再创建 | 422，无数据库变化 |
| owner 与 collaborator 重复 | 422，无 revision 或当前状态变化 |
| 归档成员被提交为新负责人 | 422 |
| `ownerIds` 含非法 UUID | 400 `INVALID_REQUEST`，不执行列表查询 |
| `ownerIds` 含未知或归档成员 | 200，条件不命中，不报错 |
| 两个管理员会话并发编辑同一聚合 | 单个事务内一个 version 成功，另一个 409 |
| 动态开启非法/非本机/wildcard IP | 422，不启动 listener、不写 network_config |
| LAN bind 成功但 network_config 保存失败 | 关闭新 listener，回滚到原状态 |
| 重启时保存的 LAN IP 已失效 | loopback 正常，分享 degraded，不自动换地址 |
| 小任务编辑器含他任务 ID | 422/404，不写库 |
| revision 插入失败 | 事务回滚，当前状态与 revision 均不变 |
| 事务提交前进程中止 | 回滚，无 revision/当前状态半更新；下次打开由 WAL 恢复 |
| 提交后查询失败 | 直接重试读库；没有独立索引重建阶段 |
| WAL 尾部未完成 | 下次打开自动恢复，不丢已提交事务 |
| 数据库页或 checksum 损坏 | integrity_check/业务校验报错，要求从备份恢复 |
| A 请求 B task | 200，返回完整 Task 且 memberRole=viewer |
| owner 在个人页保存进度/完整详情或管理小任务 | 校验主任务 owner 与 version，写 current + 完整 revision，actor=member |
| collaborator 写进度/详情/小任务，或 owner 创建第三层任务 | 403，数据库与 revision 均不变化 |
| 成员请求团队目录/成员管理 | 无此页面或端点；任务只含脱敏成员摘要 |
| rotate 后旧 Cookie/session 行残留 | 401，linkId 校验拒绝 |
| 同毫秒多个 revision | taskVersion 决定 as-of 顺序 |
| 区间内创建 | before=null，不伪造旧状态 |
| start 恰好有变更 | 包含在 [start,end) 内，不漏算 |
| 当前已删除任务有历史变化 | 历史候选仍包含，响应 currentlyDeleted=true，前端徽章并置底 |
| 同区间创建后删除 | changeKind=deleted，before=null，不重复标 created |
| no-op 保存 | 不写 revision，返回当前聚合与 revision=null |

## 11. 后端验收场景

1. 临时目录启动，默认仅 loopback；动态开启具体 LAN IP 后成员可访问，重启按配置恢复，IP 失效不影响管理端。
2. 创建任务夹树、A/B、主任务和小任务，SQL 查询返回正确后代与分配。
3. A/B 各交换链接，都能看到团队全部任务；写操作仍只允许 owner，管理员 API 对成员 Cookie 仍为 403。
4. A 在个人页保存负责任务进度、编辑完整详情并管理小任务，B 的协作任务只读；双方事项跟踪均只读，管理员与成员历史查询只看到各自权限范围内的 before/after。
5. rotate A 链接，旧 URL/Cookie 失效，即使旧 session 行被人为保留也不能用。
6. 故障注入覆盖事务提交前中止、migration 失败与进程重启，重启后无半状态。
7. 在线备份后在全新目录恢复，数据库、历史、链接状态和校验报告完整。
