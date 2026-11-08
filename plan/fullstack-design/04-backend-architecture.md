# 04 · 后端架构与组件选型

> 后端是单进程模块化单体。HTTP 层负责传输与鉴权，service 层负责业务不变量，store 层负责 SQLite 事务、schema 与恢复；数据库结构不直接泄露为公开 API。

## 1. 技术选型

| 类别 | 推荐 | 理由 |
| --- | --- | --- |
| 运行时 | Node.js 22+ + TypeScript | 前后端共享生成契约 |
| HTTP | Fastify | 轻量路由、schema 校验、hooks 与插件封装清晰 |
| 静态资源 | `@fastify/static` | 生产同源提供 Vue dist 与 SPA fallback |
| Cookie | `@fastify/cookie` | 成员会话 Cookie，不把签名密钥等同于分享 token |
| 校验/契约 | JSON Schema + OpenAPI 生成 | 请求、响应与数据库结构可复用部分基础 schema，但分别版本化 |
| 主要持久化 | SQLite 单库（`better-sqlite3`） | 事务、索引、关系约束、单文件快照备份；内嵌库不引入独立服务 |
| 事务 | SQLite `BEGIN IMMEDIATE` + WAL | revision、当前状态和 tip 原子提交，崩溃由 WAL 恢复 |
| 写锁 | `proper-lockfile` 或等价 mkdir 锁 + 进程内队列 | 防止多实例写同一目录，保证 version 检查与写入串行 |
| 数据校验 | SQLite `quick_check`/`integrity_check`/`foreign_key_check` + revision checksum | 启动、迁移和恢复时识别不兼容或损坏数据 |
| ID/secret | `crypto.randomUUID`、`crypto.randomBytes` | 实体 UUID；分享令牌与会话使用 CSPRNG |
| CLI | Commander 或等价轻量参数解析 | serve、备份、恢复校验、数据目录与监听参数 |
| 测试 | Node test/Vitest + Fastify inject + 临时目录 | 覆盖 API、存储协议、故障注入与权限，不需要真实端口 |

不引入 ORM、独立数据库服务或多进程共享数据库；SQLite 作为内嵌库使用。`Conf` 仍只用于产品设置，不用于业务数据。

## 2. 模块与目录

```text
apps/server/src/
  cli.ts                       命令入口，仅解析参数并调用 bootstrap
  bootstrap.ts                 配置、写锁、store recovery、两个监听的生命周期
  config.ts                    loopback/lan/port/data-dir/timezone 校验
  listeners.ts                 loopback + 可选 LAN HTTP listener 装配
  app.ts                       注册插件、静态资源、错误处理与路由
  plugins/
    admin-auth.ts              loopback 管理员 principal
    share-auth.ts              token 交换、会话解析与成员 principal
    listener-context.ts        标记 loopback/lan 请求入口
    security.ts                同源变更检查、安全响应头、速率限制
  routes/
    admin/folders.ts
    admin/tasks.ts
    admin/members.ts
    admin/share-links.ts
    admin/dashboard.ts
    admin/network.ts           本机 IP 列表、启停 LAN 监听、分享状态
    share/session.ts
    share/tasks.ts
    share/folders.ts          只读可见任务夹树
    share/dashboard.ts        只读团队看板/历史
    health.ts
  services/
    folder-service.ts          树、防环、后代范围
    task-service.ts            CRUD、两层约束、分配与版本
    member-service.ts          成员、归档、任务计数
    share-link-service.ts      生成/重置/吊销/会话生命周期
    network-service.ts         动态 bind/unbind、地址校验、shareBaseUrl
    dashboard-service.ts       当前统计、时间分布、历史变化
    revision-service.ts        完整快照、追加日志与 current 发布
  stores/
    store.ts                   打开/迁移/校验数据库，统一 store facade
    db.ts                      DatabaseSync 连接、pragma、事务封装
    schema.ts                  当前 schema 的 DDL 与索引
    meta-store.ts              meta、schema 版本与应用元数据
    writer-lock.ts             单实例锁与 compromised 处理
    write-queue.ts             按聚合/全局串行 mutation
    task-store.ts              聚合当前状态 + revision + 事务提交
    member-store.ts
    folder-store.ts
    share-store.ts             share-links + auth-sessions
    network-store.ts           network_config 持久化，不保存运行时 socket
    checksum.ts                revision 规范化 checksum
    backup.ts                  暂停写入、VACUUM INTO 快照、校验与恢复
    migrations/                有序、事务化的 schema migration
  domain/
    models.ts                  内部实体、聚合与 principal 类型
    errors.ts                  NotFound/Conflict/Forbidden/Validation
    policies.ts                owner 写权限与任务关系分组
  schemas/                     API 与持久化格式 schema（分开命名和版本）
  support/
    clock.ts                   可测试时钟、UTC 与服务时区边界
    crypto.ts                  token、哈希、常量时间比较、checksum
    serialization.ts           表模型 → 内部模型 → DTO，剔除敏感字段
```

## 3. 请求管线

```text
Fastify onRequest
  → 请求 ID、安全头、基础 body 限制
  → admin/share 插件分别建立 principal
preValidation
  → JSON Schema 校验参数/body/query
preHandler / service
  → 资源存在性 + 当前 principal 的资源级权限
  → 写队列内再次检查 version 和业务不变量
  → 事务内写 revision、当前状态和 aggregate tip → COMMIT
response
  → DTO serialization，剔除 verifier_hash/token_hash 等内部字段
error handler
  → 一致错误模型；成员私有资源优先 404，内部异常不泄露路径/secret
```

管理员与成员路由放在不同 encapsulation scope。`/api/v1/share/*` 不使用管理端全量索引结果，`/api/v1/admin/*` 也不接受 member session 作为身份。

## 4. 权限策略

### 4.1 管理员与双监听

- 每个请求先由 listener-context 标记 `listenerKind=loopback | lan`，再由 admin-auth 验证。
- Admin API 同时要求 listenerKind=loopback 和 socket.remoteAddress 为 loopback；LAN listener 上的 Admin API 一律 `ADMIN_LOCAL_ONLY`。
- 默认忽略 `X-Forwarded-For`，状态变更要求同源 Origin/Fetch-Site 检查。
- 两个 HTTP 入口共享 Service/Store/写队列，但可有不同路由权限；不复制业务数据或业务实例。
- 网络启停端点本身也是 Admin API，只能从 loopback 调用。

### 4.2 成员

`MemberPrincipal` 只包含 `memberId`、`sessionId`、`shareLinkId`。每次请求同时验证 session 未过期、member 未归档、session.shareLinkId 等于当前 active link.id。残留 session 记录本身不是有效授权。

任务读取对有效成员返回团队全部任务；非 owner 写返回 403，不存在/软删除任务或小任务 id 返回 404。管理员任务列表的 `ownerIds` 只是展示筛选，不是权限范围：服务端先固定管理员全范围，再按主任务/子任务负责人裁剪结果，不能把过滤结果当作授权依据。share scope 不提供成员目录、成员管理或链接管理端点；事项跟踪只使用 GET。个人页额外提供 owner 主任务进度、完整详情和小任务管理写端点，service 必须再次校验 session.memberId 是该主任务 owner；collaborator 与其他成员只读，主任务其他字段、任何任务分配和主任务删除仅管理员可操作。客户端不能通过 body/query 指定权限 memberId。

## 5. 写协议与版本

### 5.1 单写者与队列

- 启动获得数据目录写锁，锁失效时停止写入并清楚报错。
- 进程内按 taskId 串行任务 mutation；涉及全局唯一状态的操作进入相应成员/全局队列。
- version 必须在队列内重新读取并比较，不能只在路由入口检查。
- 事务提交成功即持久化；提交后的查询直接读数据库，没有独立的“内存索引更新失败”阶段。重启以数据库为准。

### 5.2 任务聚合写协议

```text
读取当前聚合 + 校验 expectedVersion
  → 生成 version+1 的完整 post-change snapshot
  → BEGIN IMMEDIATE
  → INSERT task_revisions（带 checksum 的完整快照）
  → 更新 tasks / assignments 当前状态
  → 更新 task_aggregates 的 version 与 tip
  → COMMIT
  → 返回最新 DTO
```

revision、当前状态和 tip 在同一个事务提交，不存在“revision 已写、current 未写”的窗口；回滚由 SQLite 保证。revision 仍是历史与恢复依据，但正常启动不再需要从 revision 重建 current。事务失败时请求返回失败，库内不留下部分变更；如果数据库本身不可用，则进入 not-ready/degraded，而不是把已提交变更伪装成未发生。

### 5.3 非任务聚合

- folder/member/share-link/network 各自一个短事务，无跨聚合级联。
- 成员归档可以在一个事务里吊销链接、删除会话并写 `archived_at`；任务中的 memberId 保留，查询时按 `members.archived_at` 视为无效分配并显示待分配。
- share-link 重置或吊销后，session 删除是清理；鉴权仍必须通过当前 link 状态兜底。
- session 的 lastSeenAt 节流写入，避免每次请求写库；过期 session 可清理，不属于历史事实。

## 6. 历史服务

`RevisionService.commitTaskChange` 是唯一允许发布任务变更的入口。管理员创建、编辑、删除，以及成员个人页 owner 主任务进度/完整详情保存及小任务新建、编辑、删除都进入该入口；成员写路径产生 actor=member 的完整快照，其他分享域读取路径不写历史。

每个 revision 保存写入后的完整任务聚合快照，以及操作者类型、memberId、显示名快照、UTC 时间和 changeKind。历史看板只比较 snapshot 中的 progress/detailText，完整快照仍用于审计和未来扩展。

不是每次请求都生成快照：只有实际有效变更才追加；普通读取、失败校验和 version 冲突不写 revision。

## 7. 看板服务

- `getSummary(scope)` 用 SQL 从当前任务与分配统计三个进度桶、重要度和时间分布。
- `getChanges(scope,range)` 只查询范围内任务的 `task_revisions`，分别求 as-of before/after。
- 两者共享 `TaskScope`：后代 folderIds、主任务、owner memberIds、软删除历史口径。
- 派生索引与 DTO 映射分离，统计口径用纯函数测试；索引损坏可以重建，不能成为独立事实来源。

## 8. 安全与隐私

- 分享 token 至少 32 随机字节，Base64URL 编码；不使用 Math.random。
- 推荐只存 token SHA-256 哈希；会话采用 id.verifier + verifierHash，常量时间比较。
- Cookie 设置 HttpOnly、SameSite=Strict、Path=/api/v1/share；HTTPS 时才增加 Secure。
- 同源部署，不开放任意 CORS；mutation 检查 Origin/Fetch-Site 和自定义头。
- token 交换限流并统一失败；日志不记录 Cookie、请求体 token、任务详情正文或完整数据路径。
- 数据目录 0700、数据库与 sidecar 0600；SQLite 可读不意味着可以放在公开共享目录。
- 安全响应头包括 Referrer-Policy:no-referrer、合理 CSP、nosniff；前端不渲染用户 HTML。
- 可信 LAN 是首版威胁边界，HTTP 不防网络被动窃听。

## 9. 生命周期、网络状态与可观测性

启动顺序：校验配置 → 创建权限受限目录 → 获得写锁 → 打开数据库、schema 检查或 migration、一致性校验 → 装配共享 Service → 启动 loopback listener → 按 network_config/CLI 尝试恢复 LAN listener → 打印管理 URL 与分享状态。

loopback 启动失败则进程启动失败；LAN 恢复失败不影响本机管理端，但 network 状态必须为 degraded/offline，且不得生成看似可用的分享 URL。

动态开启 LAN 时先校验具体 IP 属于本机并 bind 成功，再持久化 network_config；若配置保存失败，停止刚启动的 listener 并回滚到关闭状态。动态更新 IP 时先启动新 listener，再保存新配置，成功后关闭旧 listener；保存失败只关闭新入口，旧入口继续服务。关闭分享时先保存 enabled=false，再停止 LAN listener；保存失败则保持原入口，不吊销 token/session。

关闭顺序：停止接收两个监听的新连接 → 等待写队列排空 → 关闭 Fastify/listeners → `wal_checkpoint(TRUNCATE)` 并关闭数据库 → 释放锁。

备份使用同一写队列暂停入口；备份结果是一个 `VACUUM INTO` 数据库快照、应用版本、schema 版本和校验报告。健康检查只返回版本与就绪状态，网络状态单独提供脱敏状态，不暴露文件路径或修复细节。日志包含 requestId、listenerKind、路由模板、状态码、耗时和实体 ID，不包含 secret/详情。

## 10. 测试金字塔

- domain 单测：任务层级、角色唯一、统计桶、日期边界、token 生命周期。
- store 协议测试：schema、事务回滚、写锁、版本冲突、checksum、WAL 恢复、旧文件导入、备份恢复、doctor。
- 故障注入：事务提交前中止、进程在 WAL 提交窗口被杀、migration 失败、session 删除失败。
- 网络测试：动态 bind/unbind、非法/非本机 IP、端口冲突、重启恢复、IP 失效、base URL 更新、LAN Admin API 拒绝。
- API 测试：admin/member/匿名矩阵、A 访问 B 返回 404、成员个人页 owner 限定写入、collaborator 只读、owner 小任务限定管理、事项跟踪无写控件对应端点、无成员目录、链接重置后旧会话失效。
- 端到端：真实静态 dist + API + 临时目录，验证启动、重启持久化、历史 diff、旧数据导入和备份恢复。
