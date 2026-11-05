# 01 · 总体架构

> 本文定义系统边界、运行拓扑、身份隔离、数据流与本地部署方式。主要持久化采用 SQLite 单库（`node:sqlite`）：当前状态关系化，历史保存完整快照，写入以事务为边界。

## 1. 产品意图与成功标准

ZTask 服务一个已经相识的小团队：管理员把目标拆成任务夹、任务和一层小任务并维护全部信息，成员通过个人链接了解自己的事项、更新负责任务的进度、编辑完整进展并管理小任务，管理员随时看到整体与个体的工作变化。成功闭环是：

```text
管理员建成员与任务
  → 为 A、B 分别生成链接
  → A/B 在局域网只看到自己的相关事项
  → 成员在个人页更新负责任务的进度/完整详情并管理小任务，协作任务只读
  → 成员事项跟踪保持只读，管理员看板与历史比较查到真实变化
```

### 1.1 目标

- 一条命令启动服务，浏览器直接使用，无独立数据库服务、消息队列或云端依赖。
- 所有业务事实保存在服务主机的 SQLite 数据库中，重启不丢失，可备份、迁移和按任务恢复。
- 管理员能查看和操作事项跟踪、成员管理；成员链接提供个人页和只读事项跟踪，不提供成员管理页。成员只能在个人页更新自己负责任务的进度、编辑完整详情并新建/编辑/删除小任务。
- A 不能通过修改 ID、调用 API 或查看响应获得 B 的私有事项。
- 每次有效任务变更保存完整快照，任务进度与详情可按任意起止时刻还原和比较。
- Web UI 的布局、信息层级、颜色与主要交互以现有原型为准。

### 1.2 非目标

- 不做多组织 SaaS、注册体系、SSO、复杂 RBAC、跨机器同步或多实例共同写入。
- 不做甘特图、资源排期、即时通讯、附件、评论流、通知中心和完整审计后台。
- 不做三层及以上任务嵌套；任务夹可嵌套，任务只允许“主任务 → 小任务”两层。
- 不照搬 DeepSeek Harness 的 Cordis 插件架构，也不把 ZTask 包装成通用数据库平台。
- 首版不支持用户直接编辑运行中的数据库；诊断用只读连接，写入只经服务。

### 1.3 反目标

- 仅靠前端隐藏管理菜单，或把全部任务下发到浏览器后过滤。
- 把业务数据拆成多个数据库文件，或在每次修改时重写全库。
- 绕过事务直接改数据库文件，或把未校验的字符串拼进 SQL。
- 把任务历史存成无法还原任意时刻的新增文本片段，或把 diff 结果当作历史事实。
- 让多个服务进程同时写同一数据目录，或允许网络共享目录多机写入。
- 为“实时”引入复杂基础设施，却让本地启动、备份和数据库恢复变困难。

## 2. 推荐运行拓扑

默认未开启分享时，只有一个 loopback 监听：

```text
ZTask 单进程
└─ 127.0.0.1:8123 → 管理页面 / Admin API / 本机 Share API
```

管理员在成员管理页开启局域网分享后，同一进程动态增加一个具体 LAN IP 监听：

```text
运行 ZTask 的主机
┌─────────────────────────────────────────────────────────┐
│ ZTask 单进程：共享 Service / 写队列 / SQLite Store       │
│                                                         │
│  127.0.0.1:8123                                         │
│  ├─ 管理页面 + Admin API（仅本机）                       │
│  └─ Share API（本机测试）                                │
│                                                         │
│  192.168.1.5:8123（按需启停）                            │
│  ├─ 成员个人页 + 只读事项跟踪 + Share API                │
│  └─ Admin API 一律拒绝                                   │
│                                                         │
│  ~/.ztask/{ztask.db,locks,backups,tmp}                  │
└─────────────────────────────────────────────────────────┘
          ▲                                ▲
          │ 本机管理员                     │ 同一局域网成员
          │                                │
   http://127.0.0.1:8123        http://192.168.1.5:8123/#/s/<token>
```

两个监听使用同一端口但不同具体 IP，共享业务模块和 SQLite 存储，不是两个 ZTask 实例。开发模式允许 Vite 在另一端口提供 HMR，但只代理 `/api`，不产生第二套业务服务。

### 2.1 为什么采用 SQLite 单库

SQLite 在一个文件里提供事务、外键、CHECK 和索引。一次任务编辑把 revision、当前状态和版本指针放在同一个事务，崩溃不会留下半状态；看板和历史查询可以走 SQL，不必在启动时从分散文件重建全部内存索引；备份可以用 `VACUUM INTO` 得到单文件一致性快照。对单机、小团队、数千任务规模，内嵌 SQLite 的复杂度低于自维护的原子写、JSONL 尾部恢复和派生索引协议。

### 2.2 为什么不采用分聚合文件或多进程服务

分聚合 JSON + JSONL 的优点是纯文本可读、按任务恢复直观，但代价是应用层要实现临时文件 + fsync + rename、JSONL checksum 与尾行恢复、current 与 revision tip 对账、启动重建索引，以及跨实体一致性只能靠约定。SQLite 已提供这些能力，且单文件权限与备份边界更简单。多进程服务仍不采用：数据目录锁与单写者模型不变，SQLite 不是多实例共享同一数据目录的授权。

## 3. 启动、动态监听与分享地址

```sh
ztask serve
ztask serve --port 8123
ztask serve --lan 192.168.1.5 --port 8123
ztask serve --lan 192.168.1.5 --port 8123 --data-dir /path/to/ztask-data
```

| 配置 | 默认值 | 规则 |
| --- | --- | --- |
| 管理监听 | `127.0.0.1:8123` | 始终优先启动，保证本机管理端可用 |
| `--lan` | 无 | 可选，启动时恢复一个具体本机局域网 IP 监听；也可在管理页动态开启 |
| `port` | `8123` | 两个监听默认共用端口；`0` 仅用于 loopback 测试 |
| `data-dir` | `~/.ztask`，可用 `ZTASK_HOME` 覆盖 | 推荐本地磁盘；不支持多机共同写入 |
| `shareBaseUrl` | 由当前 LAN host/port 推导 | 只用于生成分享 URL，不赋予额外信任 |
| `open` | 本机启动时默认打开管理页 | `--no-open` 禁止自动打开 |

不接受 `0.0.0.0`/`::` 作为普通分享配置，也不自动切换到另一块网卡。首版 HTTP 仅限可信局域网，禁止直接端口映射到公网。

### 3.1 在成员管理页动态开启

1. 管理员点击“开启局域网分享”，后端列出当前本机可选 IP 并明确展示网卡/地址。
2. 管理员选择地址后，后端验证 IP 仍属于本机、端口可绑定，再启动 LAN listener。
3. 启动成功后事务写入 `network_config`，返回实际 `shareBaseUrl`；失败则保持仅 loopback 并显示原因。
4. 后续生成/复制的成员链接统一由 `shareBaseUrl + "/#/s/" + token` 生成。
5. 未开启分享时，生成链接先引导开启，不能向成员分发不可达的 127.0.0.1 地址。
6. 关闭分享只停止 LAN listener；loopback 管理端、token 和会话数据保留。

LAN listener 的运行状态与持久化 enabled 状态分开：重启后先启动 loopback，再尝试恢复已启用 LAN 配置。IP 变化或绑定失败时管理端仍可用，但分享显示 degraded/offline，要求管理员重新选择地址。

### 3.2 链接地址更新

`share_links` 表只保存 tokenHash、memberId 和状态，不固化完整 URL。切换 LAN IP 时只更新 `network_config` 的 shareBaseUrl，随后生成/复制的链接自动使用新地址，token 不变。

已经分发出去的旧 URL 不会在成员设备上自动改写；网络地址变化后仍需重新发送新 URL。关闭监听也不等于吊销链接，恢复监听后有效 token 可继续使用。

## 4. 身份与权限架构

| Principal | 建立方式 | 能访问的 API | 数据范围 |
| --- | --- | --- | --- |
| `admin` | 请求来自 loopback listener 且 socket 对端为 loopback，并通过同源检查 | `/api/v1/admin/*` | 全部成员、任务、看板、网络与分享链接管理 |
| `member` | 有效分享令牌换取的 HttpOnly 会话 | `/api/v1/share/*` | 个人页 + 只读事项跟踪；仅 owner 主任务可写进度/完整详情/小任务 |
| 匿名 | 无 | 静态资源、令牌交换、健康检查 | 不含业务数据 |

管理员只能在服务主机操作已确认。Admin API 同时检查 listenerKind=loopback 和 remoteAddress=loopback，LAN listener 上的 Admin API 一律拒绝；默认忽略代理 IP 头，不能把“局域网内”当成管理员证明。

### 4.1 成员链接与会话生命周期

```text
管理员生成/重置
  → CSPRNG 生成至少 256 bit 随机 token
  → 按当前 shareBaseUrl 返回完整 URL 给管理员分发
  → 成员打开 /#/s/<token>
  → POST /share/session 校验 active link
  → 插入 auth_sessions 行，设置 HttpOnly Cookie
  → 清除地址栏 token
  → 后续请求由会话解析 memberId，再执行资源级过滤

重置/吊销/成员归档
  → 同一事务更新该成员的 share_links 链接行
  → 删除关联 auth_sessions 行（清理动作）
  → 即使清理失败，残留 session 也因 linkId/status 校验失败而无法使用
```

一个成员首版只有一条有效链接。分享 token 不出现在访问日志、业务错误或常规成员列表中。`auth_sessions` 表只保存登录会话，不保存任务历史或界面状态。

## 5. 核心数据流

### 5.1 管理员任务维护

```text
TaskBoard
  → GET folders/tree + GET tasks?folderId=...&q=...&importance=...&ownerIds=...
  → ownerIds 命中主任务负责人时返回整条任务；仅命中子任务负责人时只返回命中小任务
  → 浮窗提交 editor，携带主任务 version
  → admin principal + DTO + 成员/层级校验
  → 进入该任务聚合的写队列并再次检查 version
  → 同一事务插入 task_revisions 完整快照
  → 更新 tasks / assignments / task_aggregates 并提交
  → 返回最新任务；冲突返回 409，前端保留草稿
```

任务列表的 `ownerIds` 过滤只作用于列表查询，不改变看板 `memberIds` 的统计口径；搜索、重要度和负责人条件在服务端取交集，分页在过滤后的主任务集合上执行。

### 5.2 成员个人页与只读事项跟踪

```text
MemberHomePage（原型“成员链接 · 某某”）
  → GET /share/tasks，按 owner/collaborator 分为我负责的/我协作的
  → owner 主任务：PATCH progress/detail，或新建/编辑/删除其小任务，携带 version
  → ShareService 再检查 session.memberId 是该主任务 owner
  → 同一事务追加完整 revision 并更新当前状态，actor=member
  → collaborator 只读；主任务其他字段、主任务分配和删除不接受成员修改

ReadOnlyTrackerPage
  → GET folders/tree/tasks/dashboard，数据仍限 memberId 相关范围
  → 只读树、任务卡、详情、看板与历史 diff
  → 即使是自己的任务，也不能在事项跟踪中修改

成员导航只有“成员个人页”和“事项跟踪”，没有成员管理、链接管理或网络配置。
```

owner/collaborator 同时决定可见范围与个人页写权限；写权限只覆盖主任务 progress、完整 detailText 和其小任务的新建/编辑/删除，不覆盖主任务其他字段、任何任务的 owner/collaborator 分配或主任务删除；新建小任务默认当前成员为 owner。管理员仍可通过 admin API 修改全部任务。

### 5.3 看板与历史比较

```text
Dashboard
  → 用 SQL 递归查询任务夹后代主任务
  → 可选 owner memberIds 过滤（空 = 全部）
  → 当前快照聚合统计与预计完成时间分布
  → 历史候选包含 active 与软删除任务，查询范围内 task_revisions
  → 按 [start,end) 分别取 <start、<end 的最后快照
  → 返回 before/after、changeKind、currentlyDeleted
  → 前端以 jsdiff diffLines 计算差异并用 Vue 渲染双列；当前已删除项显示徽章并置底
```

历史不是纯事件溯源，也不是保存每次 diff；它是带 actor/changeKind 元数据的追加快照日志。只有实际变更才追加快照，不按固定时间轮询造快照。

## 6. 数据库一致性、并发与索引

- 一个主任务是一个聚合：`task_aggregates` 保存共享版本与 tip；`tasks` 保存主任务和小任务；`assignments` 保存分配；`task_revisions` 保存每次有效变更的完整快照。
- 一次 mutation 是一个 `BEGIN IMMEDIATE` 事务；revision、当前状态、tip 同事务提交。崩溃由 WAL 回滚或恢复，不留下半状态。
- 单进程获得数据目录写锁，进程内 mutation 进入串行队列；任务 version 在事务内再次检查，避免并发覆盖。
- 归档成员不级联重写任务行，而是让现存 assignment 在查询时按 `members.archived_at` 失效并显示“待分配”。
- 查询直接使用 SQL 索引；不再有启动时从 current 文件重建的 `byId`、`folderChildren`、`tasksByFolder` 等内存派生索引。任何缓存都只能从数据库重建，不是第二份权威数据。
- revision 的 checksum 与 SQLite 的 `integrity_check` 分别覆盖逻辑内容与页结构；完整校验用于备份、恢复和 doctor，不在每次启动扫描全库。

## 7. 备份、迁移与故障恢复

- 停止服务后复制整个数据目录仍是最简单备份。运行中备份先暂停写队列、等待在途事务，再用 `VACUUM INTO` 生成一致性数据库快照，校验后原子发布到 `backups/<时间戳>-<uuid>/`。
- 恢复先在独立目录校验 schema 版本、`integrity_check`、外键、revision 序列和引用，再切换正式目录；不能边校验边覆盖唯一数据。
- schema 版本在 `PRAGMA user_version`；启动先备份再按版本顺序执行可重入 migration，全部成功后更新版本。迁移失败回滚并拒绝启动。
- 旧文件格式通过一次性导入器进入 SQLite：先写临时库、校验、原子 rename，再把旧文件移入 `backups/pre-sqlite-*`。旧备份可由同一导入器恢复。
- revision 只追加，首版不自动清理或压缩，保证任意历史区间可查。未来归档旧段时必须保留 as-of 查询能力。
- 数据库和数据目录权限建议 0700/0600；SQLite 不加密静态数据，可读即意味着本机同用户可读，分享 token 哈希、任务详情和会话哈希同样需要保护。

## 8. 容量与性能假设

首版面向单实例、几十名成员、数千主任务和小团队低频写入。当前列表与统计走 SQL 索引；历史 diff 只查询范围内任务的 revision。本地 SQLite 的页缓存和索引足以支撑该规模，不以数万 QPS 或海量数据为目标。

若历史表或任务表增长到影响查询，再增加分段、归档表或只读快照；不得通过牺牲事务一致性换性能。数据库仍是单机单实例，多进程或跨机同步不在首版范围。

## 9. 备选方案与否决理由

| 方案 | 优点 | 当前不采用的原因 |
| --- | --- | --- |
| 分聚合 JSON + JSONL | 纯文本可读、按任务恢复直观、无原生依赖 | 已迁移；自维护原子写、JSONL 恢复与索引成本高，跨实体一致性弱 |
| 单个 JSON / Lowdb / Conf | 最简单 | 全量读写、历史与故障影响范围不适合完整业务 |
| NeDB | 纯 JS、查询与索引现成 | 跨集合一致性和关系规则仍需自己实现，维护活跃度与 SQL 能力不足 |
| SQLite | 事务、索引、关系约束、单文件快照 | 已采用；需要 Node >= 22.13 与 schema migration 纪律 |
| PouchDB / Git | revision 或版本历史强 | 同步/版本系统对当前需求过重 |

## 10. 不可被实现细节改变的边界

实现者可选择具体 SQLite 驱动、SQL 组织方式和内部函数命名，但不得改变：同源单进程、服务端 memberId 过滤、管理员独立鉴权、两层任务、单写者锁、事务写协议、每次有效变更完整快照、版本冲突处理、可验证备份恢复，以及原型视觉和交互基线。
