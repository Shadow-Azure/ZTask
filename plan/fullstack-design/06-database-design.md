# 06 · 文件存储设计

> 本文是分聚合 JSON + JSONL 的持久化契约。文件路径沿用 `06-database-design.md` 以稳定文档链接，但产品不再使用关系数据库。

## 1. 存储原则

1. 按业务聚合拆文件，避免全库单 JSON。
2. 一个主任务及其小任务、成员分配是一个原子编辑聚合。
3. 当前状态使用格式化 JSON；历史使用只追加 JSONL。
4. 每次有效任务变更追加完整 post-change 快照，而不是只存字段 delta 或预先计算的 diff。
5. `revisions.jsonl` 是历史和恢复依据，`current.json` 是最新缓存；内存索引全部可重建。
6. 只支持一个服务写进程；文件可读不等于允许用户运行时手改。

## 2. 数据目录

```text
~/.ztask/
  manifest.json
  network.json
  members/
    <memberId>.json
  folders/
    <folderId>.json
  tasks/
    <taskId>/
      current.json
      revisions.jsonl
  share-links/
    <memberId>.json
  auth-sessions/
    <sessionId>.json
  locks/
  backups/
  tmp/
```

`tasks/<taskId>` 的 taskId 是主任务 ID，小任务不另建顶层目录。`auth-sessions` 明确表示认证会话，不与任务工作记录混淆。`tmp` 只放同文件系统内的临时文件，启动时按协议清理，不能成为唯一数据位置。

## 3. `manifest.json`

```json
{
  "formatVersion": 1,
  "applicationVersion": "0.1.0",
  "createdAt": "2026-11-01T02:00:00.000Z",
  "timeZone": "Asia/Shanghai"
}
```

manifest 记录全局格式和团队统一时区，不保存当前任务索引或会话。格式版本只能按受支持 migration 升级；文件比应用支持的版本新时拒绝启动。

### 3.1 `network.json`

```json
{
  "formatVersion": 1,
  "shareListener": {
    "enabled": true,
    "host": "192.168.1.5",
    "port": 8123,
    "shareBaseUrl": "http://192.168.1.5:8123"
  }
}
```

该文件保存期望恢复的网络配置，不保存 socket、运行错误或可用网卡列表。实际 running/degraded 状态由 NetworkService 管理。动态 bind 成功后才原子更新文件；重启时 loopback 始终可用，LAN 恢复失败只把分享标记为不可用。

share-link 文件不保存完整 URL。生成/复制链接时以当前 shareBaseUrl 拼接 `/#/s/<token>`；IP 变化只改 network.json，不重写 token。旧设备已持有的 URL 需要重新分发。

## 4. 成员、任务夹与分享聚合

### 4.1 `members/<memberId>.json`

```json
{
  "formatVersion": 1,
  "id": "uuid",
  "name": "陈晨",
  "role": "前端工程师",
  "color": "#2f6fe0",
  "createdAt": "2026-11-01T02:00:00.000Z",
  "updatedAt": "2026-11-01T02:00:00.000Z",
  "archivedAt": null
}
```

姓名不要求唯一。归档只修改此文件；任务中的历史 assignment ID 保留，查询时把 archived member 排除出有效负责人，并让任务显示待分配。

### 4.2 `folders/<folderId>.json`

```json
{
  "formatVersion": 1,
  "id": "uuid",
  "parentId": null,
  "name": "2026 Q4 迭代",
  "position": 0,
  "createdAt": "2026-11-01T02:00:00.000Z",
  "updatedAt": "2026-11-01T02:00:00.000Z",
  "deletedAt": null
}
```

服务在写前防止父链成环。首版不开放移动/删除，避免引入跨文件夹级联；未来移动 folder 只改一个 folder 文件，任务仍通过 folderId 关联。

### 4.3 `share-links/<memberId>.json`

```json
{
  "formatVersion": 1,
  "id": "uuid",
  "memberId": "uuid",
  "tokenHash": "sha256...",
  "status": "active",
  "createdAt": "2026-11-01T02:00:00.000Z",
  "revokedAt": null,
  "lastUsedAt": null
}
```

每成员一个文件，从路径上保证最多一条当前链接。重置直接原子替换为新 id/tokenHash；旧 session 因 shareLinkId 不匹配而失效。完整 URL 由 network.json 的 shareBaseUrl 派生，不写入此文件。raw token 默认不落盘；若选择可恢复 secret 方案，需单独调整威胁模型与文件权限，不能放进普通成员响应。

## 5. 认证会话 `auth-sessions/<sessionId>.json`

```json
{
  "formatVersion": 1,
  "sessionId": "uuid",
  "memberId": "uuid",
  "shareLinkId": "uuid",
  "verifierHash": "sha256...",
  "createdAt": "2026-11-01T02:00:00.000Z",
  "expiresAt": "2026-12-01T02:00:00.000Z",
  "lastSeenAt": "2026-11-01T02:00:00.000Z"
}
```

Cookie 携带 `sessionId.verifier`，服务端按 ID 找文件并校验 verifierHash；不能只凭 sessionId 登录。每次请求还检查 member 未归档以及 shareLinkId 是当前 active link。

session 是过期可清理的认证状态，不进入任务历史。lastSeenAt 最多每数分钟更新一次；链接重置/吊销时删除 session 文件只是清理，link 校验才是最终失效保证。

## 6. 任务聚合 `current.json`

一个主任务对应一个聚合目录，小任务不单独创建 `tasks/<subtaskId>/`，而是放在主任务的 `subtasks` 数组中。主任务和小任务的分配统一放在聚合的 `assignments` 数组中，并通过 `taskId` 指向主任务或某个小任务。

以下示例包含一个主任务和两个小任务。陈晨同时是主任务与两个小任务的 owner，这是合法分配；唯一性按 `(taskId,memberId)` 判断，而不是按整个聚合的 memberId 判断。

```json
{
  "formatVersion": 1,
  "taskId": "11111111-1111-1111-1111-111111111111",
  "taskVersion": 4,
  "updatedAt": "2026-11-01T03:00:00.000Z",
  "revisionTip": {"taskVersion": 4, "recordedAt": "2026-11-01T03:00:00.000Z", "changeKind": "detail", "checksum": "sha256..."},
  "task": {
    "folderId": "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "parentId": null,
    "description": "任务树组件重构",
    "progress": 70,
    "detailText": "完成树组件基础结构搭建\n节点展开/收起完成",
    "importance": "high",
    "dueDate": "2026-11-06",
    "createdAt": "2026-11-01T01:00:00.000Z",
    "deletedAt": null
  },
  "subtasks": [
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "parentId": "11111111-1111-1111-1111-111111111111",
      "folderId": "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "description": "树节点拖拽交互",
      "progress": 100,
      "importance": "high",
      "dueDate": "2026-10-24",
      "createdAt": "2026-11-01T01:10:00.000Z",
      "deletedAt": null
    },
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "parentId": "11111111-1111-1111-1111-111111111111",
      "folderId": "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "description": "大数据量虚拟滚动",
      "progress": 40,
      "importance": "mid",
      "dueDate": "2026-11-03",
      "createdAt": "2026-11-01T01:20:00.000Z",
      "deletedAt": null
    }
  ],
  "assignments": [
    {"taskId": "11111111-1111-1111-1111-111111111111", "memberId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "kind": "owner"},
    {"taskId": "11111111-1111-1111-1111-111111111111", "memberId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "kind": "collaborator"},
    {"taskId": "22222222-2222-2222-2222-222222222222", "memberId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "kind": "owner"},
    {"taskId": "33333333-3333-3333-3333-333333333333", "memberId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "kind": "owner"}
  ]
}
```

约束：

- 主任务 `parentId=null`；小任务父任务必须属于当前聚合且自身为主任务。
- 小任务 folderId 与主任务相同，不独立移动。
- assignment.taskId 必须等于聚合主任务 ID 或 subtasks 中某个小任务 ID；同一 `(taskId,memberId)` 只能出现一次，kind 为 owner/collaborator。
- 主任务允许多个 owner/collaborator；小任务首版最多一个有效 owner，且不开放 collaborator。不同 taskId 下允许同一 memberId 重复出现。
- 创建/编辑时要求有效 owner；成员归档后允许 0 个有效 owner，UI 标记待分配。
- progress 为 0–100 整数；importance 为 high/mid/low；dueDate 为 date-only。
- taskVersion 从 1 开始，每次有效聚合变更递增；主任务和全部小任务 DTO 共享这个聚合版本。

## 7. 历史 `revisions.jsonl`

### 7.1 快照而非 delta

每次有效创建、属性编辑、进度保存、完整详情编辑、小任务变更和删除，追加一条完整聚合快照。无实际变化的保存不追加。

```json
{"formatVersion":1,"revisionId":"uuid","taskId":"uuid","taskVersion":4,"recordedAt":"2026-11-01T03:00:00.000Z","changeKind":"detail","actor":{"kind":"member","memberId":"uuid","name":"陈晨"},"checksum":"sha256...","snapshot":{"task":{"progress":70,"detailText":"完成基础结构\n节点展开完成"},"subtasks":[],"assignments":[]}}
```

示例为突出字段做了简化；正式 snapshot 与 current 的 `task/subtasks/assignments` 完整结构一致。checksum 对不含 checksum 字段的规范化记录字节计算，用于识别损坏，不作为防恶意篡改签名。

`changeKind` 是受控枚举，如 create/update/progress/detail/subtask/delete；actor.name 是操作时显示名快照；管理员维护与成员个人页 owner 的进度/详情/小任务更新都记录操作者，成员后续改名/归档不影响历史可读性。

### 7.2 为什么不是纯事件溯源

纯事件溯源需要重放 ProgressChanged/DetailAppended 等 delta 才能求状态。本方案直接保存 after-state 全量快照，任意时刻只取最近一条即可。actor/changeKind 提供变更语义，但不要求通过重放事件计算当前状态。

### 7.3 时间段 diff

历史窗口统一为 `[start,end)`，对范围内每个任务流式读取日志：

```text
before = recordedAt < start 的最后一条；同刻以 taskVersion 大者为准
after  = recordedAt < end   的最后一条；同刻以 taskVersion 大者为准
```

- after=null：end 前没有快照，不返回。
- before=null 且 after.changeKind=delete：按 deleted 处理，before=null；不与 created 冲突。
- before=null 且其他 after：按 created 处理，不伪造 0% 起点。
- before=after：区间内无有效变化，不返回。
- before/after progress 或 detailText 不同：返回 updated。
- 只有其他字段变化：不进入当前进度/详情 diff，但快照仍保留。
- currentlyDeleted 独立表示任务在查询时的当前删除状态；即使 changeKind=updated，只要当前已删除，前端也必须显示“当前已删除”并置底。

历史候选集合不能复用只含 active 任务的 current 列表，必须包含当前有效任务和已软删除但保留 revision 的任务。成员权限采用“当前相关任务的历史”：按最新 after/delete 快照中的 assignment 与当前 active member 计算，被移除 owner 失去历史访问，新 owner 可查看当前负责任务的历史；owners 响应取 after/delete 快照。

后端返回 before/after 的完整 detailText、changeKind 和 currentlyDeleted，前端使用 jsdiff diffLines 计算行级 diff，Vue 自研双列渲染；不把 diff 结果写回存储。

## 8. 原子写与崩溃恢复

### 8.1 JSON 原子替换

```text
在目标文件同目录创建临时文件
  → 写入完整 JSON + newline
  → fsync 临时文件
  → rename 原子替换目标
  → 支持的平台上 fsync 父目录
```

临时文件继承/设置 0600 权限。不能直接 writeFile 覆盖 current。Windows/POSIX 的 rename 差异由原子写封装统一处理并测试。

### 8.2 任务提交顺序

```text
队列内比较 expectedVersion
  → 生成 version+1 完整快照
  → append revision + flush/fsync
  → 原子发布带 revisionTip 的 current
  → 更新内存索引
```

若 append 后、current 前崩溃，启动发现 current.taskVersion 落后，直接从最新完整 revision 重建 current。若 current 已发布而索引更新失败，文件仍是权威状态，重建索引即可。

### 8.3 JSONL 尾部恢复

- 每行必须是完整 UTF-8 JSON，以 `\n` 结束；文本中的换行由 JSON 转义。
- 启动通过 current.revisionTip 和文件尾部核对版本/checksum，正常情况无需扫描全部历史。
- 尾部缺换行、JSON 不完整或 checksum 不匹配时，先备份原文件，再只处理最后一个不完整记录；不能静默删除中间有效记录。
- current 比 revision tip 新、tip checksum 不匹配或中间损坏无法解释时拒绝自动修复并提示恢复备份。

## 9. 派生索引与查询

启动从 current 文件建立：

```text
byId
folderChildren
activeTasksByFolder
historyTasksByFolder（包含软删除）
assignmentsByMember（按 taskId 区分主/小任务）
activeOwnersByTask
parentBySubtaskId（小任务 id → 主任务 id）
activeSubtaskOwnersByTask（主任务 id → 小任务 owner 集合）
```

这些索引只服务查询，不独立持久化为权威数据。folder 后代通过内存遍历取得，主任务列表和 owner 过滤直接查索引；current 看板不全量读取 JSONL。

任务列表的 `ownerIds` 过滤先查 `activeOwnersByTask` 判断主任务负责人命中；未命中时再查 `activeSubtaskOwnersByTask` 与 `parentBySubtaskId` 得到命中小任务及其主任务，按主任务去重，只组装命中的子任务。归档成员不进入 active 索引，因此已归档 ID 不会命中；该流程不扫描 JSONL，分页在过滤后的主任务集合上执行。

历史查询只流式读取范围内任务的 revisions。若未来日志很大，可增加分段和稀疏时间索引，但索引必须能从 JSONL 重建。

## 10. 时间、迁移与备份

- 所有时刻存 UTC RFC 3339 字符串；recordedAt 相同以 taskVersion 决胜。
- dueDate 是 YYYY-MM-DD，不做 UTC 转换；团队时区从 manifest 读取。
- migration 在启动且写锁持有、API 未开放时执行；先备份，逐文件原子、可重入升级，全部成功后最后更新 manifest。
- 停止服务后复制整个目录即可备份。在线备份先暂停写队列并等待在途写入，再复制到临时目录、校验和原子发布；备份输入排除 locks、tmp 和 backups 自身，避免锁状态与递归复制。
- 恢复先在独立目录跑完整校验，包含 JSON Schema、引用关系、revision tip 和 checksum，再切换正式目录。
- 首版不自动删除或压缩 revision；未来压缩旧段必须保留任意时间范围的 as-of 查询。
