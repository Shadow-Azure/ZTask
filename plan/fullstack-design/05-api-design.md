# 05 · API 设计

> 所有端点以 `/api/v1` 为前缀。管理员与成员使用不同命名空间；成员端没有“传入 memberId 查询他人”的能力。本文逐项定义 37 个唯一接口的用途、URL、params、body 与成功 response。

## 1. 通用约定

- JSON UTF-8；有 body 的请求使用 `Content-Type: application/json`；同源 Cookie 仅用于 `/share`。
- Admin API 仅允许 loopback 管理员；Share API 除 `POST /share/session` 外均要求有效成员会话。LAN listener 上的 Admin API 一律 403。
- 实体 ID 为 UUID 字符串；时间戳为 UTC RFC 3339；`dueDate` 为 `YYYY-MM-DD`。
- `progress` 为 0–100 整数；`importance` 为 `high | mid | low`。
- 列表默认只返回未删除实体；任务列表超过约定上限后使用 cursor 分页，`nextCursor=null` 表示没有下一页。列表稳定按 `createdAt ASC,id ASC` 排序，cursor 是服务端签发的 opaque 最后位置标记，不直接暴露 SQL/文件偏移；新增任务只影响其后页，不使用可能跳号的页码。
- 请求 schema 默认拒绝未声明字段。params 中的 `{id}`、`{subtaskId}` 都是路径参数；query 参数在对应接口单独列出。
- 更新任务必须携带 `version`。version 是主任务聚合的并发版本；小任务 DTO 返回所属主任务聚合的同一版本，任何小任务或分配变化都会递增它。
- version 冲突返回 409 与最新可见实体；成员不可见任务统一 404；成员调用 Admin API 使用 403。
- `204` 一律为空响应体。下文 response 均为成功响应，错误结构见 §7。

## 2. 核心 DTO

### 2.1 共享结构

```text
MemberSummary = { id, name, role, color }

Subtask = {
  id, parentId, description, owner: MemberSummary,
  progress, importance, dueDate, version
}

Task = {
  id, folderId, parentId, description,
  owners: MemberSummary[], collaborators: MemberSummary[],
  progress, detail, importance, dueDate, version,
  createdAt, updatedAt, subtasks: Subtask[]
}

Folder = { id, parentId, name, position }

FolderTreeNode = {
  ...Folder,
  children: FolderTreeNode[],
  tasks: Array<{ id, description, progress, importance }>,
  counts: { done, todo }
}

RevisionResult = { taskVersion, recordedAt, changeKind }
```

`Task.version` 是主任务聚合版本。分享域任务可附加 `memberRole: "owner" | "collaborator"`，但不包含任何分享 secret 或无关成员目录。

### 2.2 看板结构

```text
ImportanceCount = { high, mid, low }
ProgressBucket = { total, importance: ImportanceCount }

DashboardSummary = {
  scope: { folderId, memberIds },
  asOf,
  buckets: { done: ProgressBucket, gt50: ProgressBucket, lt50: ProgressBucket }
}

DueBucket = {
  key: "overdue" | "week" | "month" | "later",
  total,
  importance: ImportanceCount
}

TaskChange = {
  taskId, description, owners: MemberSummary[],
  before: null | { progress, detail, recordedAt },
  after: { progress, detail, recordedAt },
  changeKind: "created" | "updated" | "deleted",
  currentlyDeleted: boolean
}
```

`before=null` 表示区间内新建，不伪造 0% 或空详情起点。owners 取 after/delete 快照；currentlyDeleted 表示任务在查询时的当前状态，不要求 changeKind 必须为 deleted。服务端已过滤无变化项，前端不自行猜测，并将 currentlyDeleted=true 的项固定排在非删除项之后且明确标识。

### 2.3 成员与网络结构

```text
AdminMember = {
  id, name, role, color, archivedAt,
  counts: { owned, collaborated },
  shareLink: null | { status, createdAt, revokedAt, lastUsedAt }
}

NetworkState = {
  loopbackUrl,
  interfaces: Array<{ name, address }>,
  shareListener: {
    enabled, running, degraded, host, port, shareBaseUrl,
    error: string | null
  }
}
```

`shareLink.status` 为 `active | revoked`，`revokedAt` 未吊销时为 null（与 §4.8 单成员查询同构）。
常规成员列表不返回 raw token。NetworkState 仅本机管理员可见，error 必须脱敏。

## 3. 管理员：任务夹与任务

### 3.1 `GET /admin/folders/tree`

- 解决问题：为左侧文件树提供任务夹层级、主任务摘要和完成统计。
- Params：无。
- Body：无。
- Response 200：`{ tree: FolderTreeNode[] }`。

树中任务只返回摘要，完整任务详情在点击后查询。

### 3.2 `POST /admin/folders`

- 解决问题：在根节点或指定任务夹下创建子任务夹。
- Params：无。
- Body：`{ name: string, parentId: string | null }`。
- Response 201：`Folder`。

服务端校验父夹存在、名称非空，并分配 id 和 position。

### 3.3 `PATCH /admin/folders/{id}`

- 解决问题：重命名任务夹，不改变层级或任务。
- Params：`id` 为任务夹 UUID。
- Body：`{ name: string }`。
- Response 200：更新后的 `Folder`。

首版不开放移动和删除任务夹。

### 3.4 `GET /admin/tasks`

- 解决问题：查询当前任务夹及后代中的主任务，用于任务管理 tab。
- Params：`folderId` 必填；`includeDescendants` 默认 true；`q` 可选；`importance=high|mid|low` 可选；`cursor` 可选。
- Body：无。
- Response 200：`{ items: Task[], nextCursor: string | null }`。

返回主任务及其一层小任务，小任务不单独成为列表行。

### 3.5 `POST /admin/tasks`

- 解决问题：创建主任务，或在已有主任务下创建一层小任务。
- Params：无。
- Body：主任务如下；创建小任务时传 parentId 并继承 folderId。
- Response 201：主任务创建返回 `Task`，version=1；小任务创建返回 `{ task: Subtask, parent: Task }`，父聚合 version 在原值上递增。

```json
{
  "folderId": "uuid",
  "parentId": null,
  "description": "任务描述",
  "ownerIds": ["uuid"],
  "collaboratorIds": [],
  "progress": 0,
  "detail": "",
  "importance": "mid",
  "dueDate": "2026-11-10"
}
```

创建小任务时 folderId 不得与父任务冲突；父任务必须是无 parentId 的主任务。

### 3.6 `GET /admin/tasks/{id}`

- 解决问题：打开任务浮窗，读取完整任务、分配和小任务。
- Params：`id` 为主任务或小任务 UUID。
- Body：无。
- Response 200：主任务返回 `Task`；小任务返回 `{ task: Subtask, parent: Task }`。

### 3.7 `PATCH /admin/tasks/{id}`

- 解决问题：修改单个任务的字段与分配，不级联覆盖其他小任务。
- Params：`id` 为任务 UUID。
- Body：version 必填，其余字段按需出现。
- Response 200：更新后的 `Task`。

```json
{
  "version": 4,
  "description": "新描述",
  "ownerIds": ["uuid"],
  "collaboratorIds": ["uuid"],
  "progress": 80,
  "detail": "完整当前详情",
  "importance": "high",
  "dueDate": "2026-11-20"
}
```

主任务的业务字段可选，version 必填；小任务仅允许 `description,ownerId,progress,importance,dueDate`，不接受 detail/collaboratorIds。主任务返回 `Task`，小任务返回 `{ task: Subtask, parent: Task }`。过期版本返回 409 和最新任务。

### 3.8 `PUT /admin/tasks/{id}/editor`

- 解决问题：一次原子保存主任务属性、分配和小任务增删改，避免部分成功。
- Params：`id` 为主任务 UUID。
- Body：完整编辑意图如下。
- Response 200：最新完整主任务 `Task`。

```json
{
  "version": 4,
  "task": {
    "description": "任务描述",
    "ownerIds": ["uuid"],
    "collaboratorIds": [],
    "progress": 70,
    "detail": "完整详情",
    "importance": "high",
    "dueDate": "2026-11-06"
  },
  "subtasks": {
    "create": [
      {
        "clientId": "browser-temp-id",
        "description": "新小任务",
        "ownerId": "uuid",
        "progress": 0,
        "importance": "mid",
        "dueDate": "2026-11-08"
      }
    ],
    "update": [
      {
        "id": "uuid",
        "description": "修改后的小任务",
        "ownerId": "uuid",
        "progress": 50,
        "importance": "high",
        "dueDate": "2026-11-09"
      }
    ],
    "deleteIds": ["uuid"]
  }
}
```

已有小任务必须属于当前主任务；任一校验失败，整个聚合不写入。

### 3.9 `DELETE /admin/tasks/{id}?version=<n>`

- 解决问题：软删除主任务组或小任务，保留历史。
- Params：`id` 为任务 UUID；query `version` 必填，防止基于旧页面误删新变更。
- Body：无。
- Response 204：空。

主任务删除会同时软删除其小任务。version 不匹配返回 409 和最新任务。

## 4. 管理员：成员与分享链接

### 4.1 `GET /admin/members`

- 解决问题：成员管理页展示成员、角色、任务计数和链接状态。
- Params：无。
- Body：无。
- Response 200：`{ items: AdminMember[] }`。

### 4.2 `POST /admin/members`

- 解决问题：添加团队成员，初始没有分享链接。
- Params：无。
- Body：`{ name: string, role?: string, color?: string }`。
- Response 201：`AdminMember`，shareLink=null。

### 4.3 `PATCH /admin/members/{id}`

- 解决问题：修改姓名、角色和显示颜色。
- Params：`id` 为成员 UUID。
- Body：`{ name?: string, role?: string, color?: string }`。
- Response 200：更新后的 `AdminMember`。

### 4.4 `DELETE /admin/members/{id}`

- 解决问题：归档成员、使当前分配失效并吊销链接和会话。
- Params：`id` 为成员 UUID。
- Body：无。
- Response 204：空。

不级联重写任务文件；历史 assignment 和 actorName 保留。

### 4.5 `POST /admin/members/{id}/share-link`

- 解决问题：为尚无 active 链接的成员创建访问凭证。
- Params：`id` 为成员 UUID。
- Body：无。
- Response 201：`{ id, status, url, createdAt }`。

完整 url 只在此次响应返回。已有 active 链接返回 409 `ACTIVE_SHARE_LINK_EXISTS`；LAN 未运行返回 409 `LAN_SHARE_DISABLED`。

### 4.6 `POST /admin/members/{id}/share-link/rotate`

- 解决问题：作废旧 token 并生成新 token。
- Params：`id` 为成员 UUID。
- Body：无。
- Response 200：`{ id, status, url, createdAt }`。

旧链接和旧会话立即失效，新 URL 使用当前 shareBaseUrl。

### 4.7 `DELETE /admin/members/{id}/share-link`

- 解决问题：停止成员访问，但不删除成员或任务。
- Params：`id` 为成员 UUID。
- Body：无。
- Response 204：空。

重复吊销保持幂等。

### 4.8 `GET /admin/members/{id}/share-link`

- 解决问题：展示链接状态、创建时间和最近使用时间。
- Params：`id` 为成员 UUID。
- Body：无。
- Response 200：`{ status, createdAt, revokedAt, lastUsedAt }`；从未生成时返回 `{ status: "none" }`。

hash-only 策略下不返回旧 URL；只有确认可恢复 secret 策略后，本机管理员 GET 才可附加 url。

### 4.9 局域网监听与分享地址

#### `GET /admin/network`

- 解决问题：展示管理 URL、可分享网卡和 LAN 监听状态。
- Params：无。
- Body：无。
- Response 200：`NetworkState`。

#### `PUT /admin/network/share-listener`

- 解决问题：动态启动或更新具体 LAN IP 监听。
- Params：无。
- Body：`{ host: "192.168.1.5", port: 8123 }`。
- Response 200：最新 `NetworkState`。

必须 bind 成功后才返回 running=true。非本机 IP、wildcard 地址或非法端口返回 422；配置保存失败按设计回滚。

#### `DELETE /admin/network/share-listener`

- 解决问题：停止局域网访问，保留本机管理端。
- Params：无。
- Body：无。
- Response 204：空。

不吊销 token，也不删除 session。关闭时先停止接收新连接，等待在途请求结束，再关闭剩余 keep-alive 连接。生成或复制分享链接时，完整 URL 由当前 shareBaseUrl 动态拼接；IP 变化后旧 URL 需要重新分发。

## 5. 管理员：看板

### 5.1 `GET /admin/dashboard/summary`

- 解决问题：返回三个进度桶及各自重要度计数。
- Params：`folderId` 必填；`memberIds` 可选，支持逗号分隔或重复参数。
- Body：无。
- Response 200：`DashboardSummary`。

### 5.2 `GET /admin/dashboard/due-distribution`

- 解决问题：返回指定统计桶的预计完成时间堆叠图数据。
- Params：`folderId` 必填；`bucket=done|gt50|lt50` 必填；`memberIds` 可选。
- Body：无。
- Response 200：`{ bucket, asOf, buckets: DueBucket[] }`。

### 5.3 `GET /admin/dashboard/changes`

- 解决问题：返回起止时间的进度和详情快照，供 jsdiff 使用。
- Params：`folderId` 必填；`memberIds` 可选；`mode=default|custom`；custom 时必须传 `startDate,endDate`。
- Body：无。
- Response 200：`{ start, end, timeZone, items: TaskChange[] }`。

历史窗口统一为 `[start,end)`：before 取 `<start` 的最后快照，after 取 `<end` 的最后快照。default 由服务端按 manifest 时区计算昨天 00:00 至 now；custom 的 endDate 解析为次日 00:00 以包含结束日全天。响应中的 start/end 是实际解析后的 UTC 边界。历史候选包含 active 与软删除任务；成员权限采用“当前相关任务的历史”，按 after/delete 快照 assignment 与当前 active member 计算。

## 6. 成员分享域

分享域同时服务两个页面：成员个人页允许 owner 主任务更新进度/完整详情并管理小任务；只读事项跟踪只使用 GET。没有成员管理或团队目录端点。

### 6.1 `POST /share/session`

- 解决问题：把分享 bearer token 换成 HttpOnly 会话。
- Params：无。
- Body：`{ token: string }`。
- Response 201：`{ member: MemberSummary }`，同时 `Set-Cookie`。

不返回 session verifier、tokenHash 或其他成员信息。失败统一 `SHARE_LINK_INVALID`，并做限流。

### 6.2 `GET /share/session`

- 解决问题：页面刷新后通过 Cookie 恢复成员身份。
- Params：无。
- Body：无。
- Response 200：`{ member: MemberSummary }`；无效会话返回 401。

### 6.3 `DELETE /share/session`

- 解决问题：注销当前成员会话。
- Params：无。
- Body：无。
- Response 204：空，同时清除 Cookie。

### 6.4 `GET /share/tasks`

- 解决问题：个人页展示负责/协作分组，只读事项跟踪展示任务列表。
- Params：`view=home|tracker`，默认 home；tracker 可传 `folderId,q,importance,cursor`。
- Body：无。
- Response 200：按 view 返回。

`view=home`：

```text
{ owned: Task[], collaborated: Task[] }
```

`view=tracker`：

```text
{ items: Task[], nextCursor: string | null }
```

服务端始终先按 session.memberId 过滤相关任务，再应用其他查询条件。

### 6.5 `GET /share/tasks/{id}`

- 解决问题：查看个人页或只读事项跟踪中的任务详情。
- Params：`id` 为任务 UUID。
- Body：无。
- Response 200：主任务返回 `Task + { memberRole }`；小任务返回 `{ task: Subtask, parent: Task, memberRole }`，parent 中只包含当前成员可见的小任务。

不相关任务返回 404。

### 6.6 `PATCH /share/tasks/{id}/progress`

- 解决问题：负责人在个人页保存主任务进度。
- Params：`id` 为主任务 UUID。
- Body：`{ progress: number, version: number }`，progress 为 0–100 整数。
- Response 200：`{ task: Task, revision: RevisionResult | null }`。

collaborator 返回 403 `OWNER_REQUIRED`；不能用于小任务，小任务通过 subtasks 端点编辑。

### 6.7 `PATCH /share/tasks/{id}/detail`

- 解决问题：负责人编辑当前完整详情，历史 revision 不变。
- Params：`id` 为主任务 UUID。
- Body：`{ detail: string, version: number }`。
- Response 200：`{ task: Task, revision: RevisionResult | null }`。

服务端替换当前完整 detailText 并追加新快照，不覆盖历史。

### 6.8 `POST /share/tasks/{id}/subtasks`

- 解决问题：负责人在自己的主任务下创建一层小任务。
- Params：`id` 为父主任务 UUID。
- Body：如下。
- Response 201：`{ task: Task, revision: RevisionResult | null }`，task 为更新后的父聚合。

```json
{
  "version": 4,
  "description": "新小任务",
  "progress": 0,
  "importance": "mid",
  "dueDate": "2026-11-10"
}
```

服务端把当前成员设为小任务 owner，成员不能指定其他 owner。

### 6.9 `PATCH /share/tasks/{id}/subtasks/{subtaskId}`

- 解决问题：编辑负责主任务下的小任务。
- Params：`id` 为父主任务 UUID；`subtaskId` 为小任务 UUID。
- Body：version 必填，可修改 `description,progress,importance,dueDate`。
- Response 200：`{ task: Task, revision: RevisionResult | null }`，task 为更新后的父聚合。

不能修改 owner，不能创建第三层；subtaskId 必须属于 id 指定的主任务。

### 6.10 `DELETE /share/tasks/{id}/subtasks/{subtaskId}?version=<n>`

- 解决问题：删除负责主任务下的小任务。
- Params：`id`、`subtaskId` 为 UUID；query `version` 为父聚合当前版本。
- Body：无。
- Response 200：`{ task: Task, revision: RevisionResult | null }`，返回最新父聚合及递增后的 version。

### 6.11 `GET /share/folders/tree`

- 解决问题：提供只读左树，但只包含相关任务及祖先节点。
- Params：无。
- Body：无。
- Response 200：`{ tree: FolderTreeNode[] }`。

结构与管理端相同，但任务和计数都按当前 memberId 范围计算。

### 6.12 `GET /share/dashboard/summary`

- 解决问题：在相关任务范围内查看统计。
- Params：与 `GET /admin/dashboard/summary` 相同。
- Body：无。
- Response 200：`DashboardSummary`。

服务端先限定 memberId，再应用 folder/member 筛选，筛选不能扩大范围。

### 6.13 `GET /share/dashboard/due-distribution`

- 解决问题：查看相关任务的预计完成时间分布。
- Params：与 `GET /admin/dashboard/due-distribution` 相同。
- Body：无。
- Response 200：`{ bucket, asOf, buckets: DueBucket[] }`。

### 6.14 `GET /share/dashboard/changes`

- 解决问题：查看相关任务的进度与详情变化。
- Params：与 `GET /admin/dashboard/changes` 相同。
- Body：无。
- Response 200：`{ start, end, timeZone, items: TaskChange[] }`，items 只含当前成员相关任务，并包含保留 revision 的软删除任务；currentlyDeleted=true 的项由前端标识并置底。

## 7. 错误模型

```json
{
  "error": {
    "code": "TASK_VERSION_CONFLICT",
    "message": "任务已被其他人更新",
    "requestId": "uuid",
    "details": {"current": "最新可见 Task，可选"}
  }
}
```

| HTTP | code 示例 | 使用场景 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | JSON、query 或参数格式错误 |
| 401 | `SHARE_SESSION_REQUIRED` | 无成员会话或会话过期 |
| 403 | `ADMIN_LOCAL_ONLY`、`OWNER_REQUIRED`、`TASK_READ_ONLY` | 已知身份但页面、角色或资源不允许操作 |
| 404 | `TASK_NOT_FOUND`、`SHARE_LINK_INVALID` | 不存在或对成员不可见，不泄露他人资源 |
| 409 | `TASK_VERSION_CONFLICT`、`ACTIVE_SHARE_LINK_EXISTS`、`LAN_SHARE_DISABLED` | 并发、链接状态或分享未开启 |
| 422 | `TASK_DEPTH_EXCEEDED`、`ASSIGNMENT_ROLE_CONFLICT`、`LAN_INTERFACE_INVALID` | 业务或网络配置校验失败 |
| 429 | `SHARE_EXCHANGE_RATE_LIMITED` | 令牌交换过频 |
| 500 | `INTERNAL_ERROR` | 已脱敏的内部异常 |

## 8. 契约测试

- 每个 route 验证 method、URL、params、body、成功 response schema 和额外字段拒绝。
- 管理员/成员/匿名对所有端点跑权限矩阵，而非只测 happy path。
- 两个成员固定 fixture：A 的任务绝不出现在 B 的任一响应；B 的 ID 对 A 返回 404；A 不能访问成员管理路由或目录端点，相关任务中的成员摘要不含分享凭证。
- 所有管理员 mutation 及成员进度/详情/小任务 mutation 验证 version 缺失/过期/最新；collaborator、第三层任务和主任务其他字段写请求不能产生文件变化。
- 删除主任务、小任务分别验证 version 冲突；小任务删除响应必须是更新后的父聚合。
- `GET /share/tasks` 分别验证 home 的 owned/collaborated 与 tracker 的 items/nextCursor，两个视图都不能泄露无关任务。
- 网络端点验证非本机/wildcard IP、bind 失败回滚、network.json 状态和 shareBaseUrl 更新。
- OpenAPI diff 进入 CI；不兼容变更必须升级 `/api/v2` 或明确迁移，不在 v1 中静默改字段含义。
