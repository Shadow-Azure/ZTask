# 09 · Review 指南与待确认问题

> 建议先读本文，再按关注域回到 01–08。本文区分“用户已明确”“原型已明确”“设计推荐”“仍需拍板”。SQLite 单库、完整快照历史、成员个人页有限更新 + 只读事项跟踪、默认 loopback + 按需动态 LAN 监听，以及 jsdiff + Vue 双列 diff 已确认，不再作为开放选项。

## 1. 需求追溯矩阵

| 用户/原型要求 | 设计位置 | 覆盖结论 |
| --- | --- | --- |
| 本地启动服务，Web UI 访问，数据全在本地 | [01 §2/§3/§6](01-architecture.md) + [04](04-backend-architecture.md) | 单进程 + 本地 SQLite 单库 |
| 默认 loopback，分享时动态开启 LAN IP | [01 §3](01-architecture.md) + [07 §3.3](07-backend-implementation.md) + [05 §4.1](05-api-design.md) | 双监听共享服务；network_config 派生 URL；LAN Admin API 拒绝 |
| 类似 DeepSeek Harness 的使用架构 | [README](README.md) + [01 §2](01-architecture.md) | 借 CLI/同源托管/本地数据库，不借插件运行时 |
| A/B 分别生成链接，只能看自己相关事项 | [01 §4](01-architecture.md) + [04 §4](04-backend-architecture.md) + [05 §6](05-api-design.md) | 独立命名空间 + 服务端资源过滤；个人页 owner 限定写入，事项跟踪只读 |
| 管理员查看/操作事项跟踪和成员管理 | [02 §2/§3](02-features.md) + [08 §5](08-frontend-implementation.md) | 管理员保留 CRUD、进展维护、计数与链接操作 |
| 成员个人页 + 只读事项跟踪 | [02 §4/§5](02-features.md) + [08 §6](08-frontend-implementation.md) | 无成员管理页；个人页 owner 保存进度/完整详情并管理小任务，协作只读；事项跟踪完全只读 |
| 左侧任务夹树，可嵌套 | [02 §3](02-features.md) + [06 §4.3](06-database-design.md) | folder parent_id + SQL 树查询 |
| 点击任务夹看到其中全部任务 | [02 §3.2](02-features.md) + [07 §4](07-backend-implementation.md) | 默认包含全部后代，与原型一致 |
| 任务增删改查与七个字段 | [02 §3.1](02-features.md) + [05 §3](05-api-design.md) + [06 §6](06-database-design.md) | 全字段任务表 + 事务 revision |
| 多负责人、多协作人 | [02 §2](02-features.md) + [06 §6](06-database-design.md) | assignments 关系表多对多 |
| 小任务仅一层 | [02 §3.1](02-features.md) + [07 §5.2](07-backend-implementation.md) | 同一聚合事务 + service/schema 强制 |
| 双击/浮窗维护 | [03 §5](03-frontend-architecture.md) + [08 §3](08-frontend-implementation.md) | 单击标题或双击卡片打开，浮窗统一编辑 |
| 任务管理/纯查询看板双 tab | [02 §3/§7](02-features.md) + [08 §4](08-frontend-implementation.md) | 看板无编辑 mutation |
| 成员多选，不选看整体 | [02 §7](02-features.md) + [07 §8](07-backend-implementation.md) | owner OR 过滤，空=全部 |
| 任务管理按负责人多选筛选，区分主任务/子任务命中 | [02 §3.2](02-features.md) + [05 §3.4](05-api-design.md) + [07 §5.1.1](07-backend-implementation.md) + [08 §2.4](08-frontend-implementation.md) | 服务端 `ownerIds`；主任务负责人命中整条，子任务负责人命中裁剪；与重要度/搜索 AND |
| 原型中的统计卡与时间分布 | [02 §7](02-features.md) + [07 §8.1](07-backend-implementation.md) | SQL 聚合统计 |
| 原型中的历史进度与详情 diff | [01 §5.3](01-architecture.md) + [06 §7](06-database-design.md) + [08 §4.3](08-frontend-implementation.md) | revision 完整快照 + as-of 查询 + jsdiff/Vue 双列 |
| 原型中的链接重置/吊销/失效页 | [02 §3.3/§6](02-features.md) + [07 §7](07-backend-implementation.md) | share_links + auth_sessions 联动 |

## 2. 访问决策与待确认问题

### Q1 · 管理员从哪里访问（已确认）

管理员只能在服务主机操作。默认仅监听 127.0.0.1；管理员在成员管理页选择具体本机 LAN IP 后动态增加分享监听，LAN listener 上的 Admin API 一律拒绝。`network_config` 保存 shareBaseUrl，链接记录不保存完整 URL；IP 变化后新链接使用新地址，旧 URL 需重新分发。

### Q2 · 完整分享链接是否需要随时复制

推荐安全方案：raw token 只在生成/重置时返回，`share_links` 表只存哈希；刷新后仍可看到链接状态，但不能恢复旧 token，只能重置生成新链接。

原型差异：成员列表长期存在复制按钮。若必须随时复制，则需本地保存可恢复 secret。可选择受限权限存储保存 raw token，简单但数据库泄露即全部链接泄露；或引入本地密钥加密，复杂度更高且密钥与数据同机时收益有限。

### Q3 · 小任务的字段与可见范围（已确认）

后端统一带 taskId 的 assignment 模型，唯一性为 `(taskId,memberId)`；主任务 owner 能在个人页更新主任务进度/完整详情并新建、编辑、删除小任务，父任务进度不自动汇总。任务数据全员可见，subtask-only 成员也能看到完整父任务与全部小任务；写权限仍只给主任务 owner。

原型差异：小任务编辑只有单 owner，未展示 collaborator/detail。首版管理员编辑 UI 可保持原型精简；小任务可编辑描述、进度、重要度和预计完成，新建默认当前成员为 owner；任何任务分配与主任务其他字段不随之开放。

### Q4 · 删除与成员移除如何保留历史

推荐：任务软删除、成员归档；任务聚合保留 assignment ID，但查询按 `members.archived_at` 视为无效分配并显示待分配，历史 revision 与操作者显示名保留。首版无回收站，普通 UI 不展示已删除项。

备选：物理删除或级联重写所有任务行，前者丢失历史，后者引入跨聚合一致性，不推荐。推荐方案在当前视图中实现“移除成员即清除有效标记”，但不擦除历史。

### Q5 · 预计完成时间是否必填（已确认）

dueDate 允许 null 表示未设置，非 null 时必须是合法的 `YYYY-MM-DD`；null 的主任务不进入预计完成分布。

### Q6 · 看板成员筛选是否只看负责人

推荐严格沿用原型：筛选 owner，collaborator 不影响统计。若希望评估协作投入，应增加负责/协作角色筛选和独立口径，而不是把 collaborator 悄悄混入当前数字。

### Q7 · 主任务与进展保存的原子边界

管理员浮窗使用一个原子 editor API，主任务与小任务在同一个聚合写协议中提交；管理员单任务进度/详情写入也带聚合 version。成员个人页的进度保存与完整详情保存是独立 API，小任务通过新建/编辑/删除端点管理，均只接受 owner 主任务并携带父聚合 version；事项跟踪没有写入 API。写接口实际变更返回 revision，no-op 返回 revision=null。

代价：一个主任务组内的并发编辑更容易冲突，但小团队可接受，且冲突 UI 保留草稿。这里的原子性由单个 SQLite 事务（revision + 当前状态 + tip）保证，不把多个独立聚合合并成一个大事务。

### Q8 · 任务管理负责人筛选与看板成员筛选的关系（已确认）

任务管理的 `ownerIds` 是列表筛选：同时检查主任务和子任务负责人；主任务负责人命中时保留整条任务，只有子任务负责人命中时保留主任务并裁剪子任务。看板的 `memberIds` 仍是统计口径：只按主任务 owner 过滤，不改变任务卡内容。两个入口的命中集合不能互相复用，否则会出现看板数字随子任务筛选变化、或列表卡片被看板口径误导。筛选在服务端执行，与重要度、搜索取 AND，并在 cursor 分页前完成；成员只读事项跟踪因没有成员目录而不提供该入口。

## 3. 风险清单

| 风险 | 后果 | 设计缓解 |
| --- | --- | --- |
| 局域网用户直接打开管理端 | 全部数据与链接失控 | listenerKind + remoteAddress 双重校验；LAN Admin API 一律拒绝 |
| 默认或意外监听所有网卡 | 扩大 VPN/其他网络暴露面 | 默认仅 loopback；仅允许显式选择具体 LAN IP，拒绝 wildcard |
| LAN 动态启动失败仍生成链接 | 成员拿到不可达 URL | bind 成功后才保存 running/shareBaseUrl；失败回滚并显示 degraded |
| IP 变化后仍使用旧 base | 旧链接失效、配置漂移 | 启动检测并要求重选；新 URL 动态派生，token 不变但重新分发 |
| 只在前端过滤 A/B | 响应中仍含他人任务 | share Service/派生索引强制 memberId 范围，契约测试固定 |
| 负责人筛选只在前端或当前页执行 | 分页后漏结果，子任务裁剪与计数不一致 | `ownerIds` 进入服务端列表查询，过滤先于 cursor 分页；响应只含裁剪后的子任务 |
| 成员事项跟踪误开放个人页写能力 | 页面边界失效，成员可管理任务 | 写 API 仅校验 owner 主任务 progress/detail/subtasks；事项跟踪只有 GET，主任务其他字段拒绝 |
| collaborator 或第三层任务伪造写请求 | 越权修改进度/详情 | service 校验角色与资源类型，403 且无数据库变化 |
| 向成员开放成员管理/目录 | 泄露链接状态或分享凭证 | 不提供页面和 /share/members；任务内仅含脱敏成员摘要 |
| token 出现在日志/Referer/localStorage | 链接被复制冒用 | fragment + 交换后清除 + HttpOnly Cookie + no-referrer + 日志脱敏 |
| hash-only 与随时复制冲突 | UI 无法实现或安全倒退 | Q2 先拍板，再固定 share-link GET 契约 |
| 当前任务更新但历史遗漏 | diff 不可信 | RevisionService 唯一入口 + 单事务提交 revision/当前状态 + 故障注入 |
| 绕过事务或直接改库 | 当前状态与历史不一致 | 业务写入只经仓储/事务；doctor 校验 tip、序列与引用 |
| 数据库页损坏或 WAL 丢失 | 历史查询或恢复失败 | `integrity_check` + revision checksum；备份 `VACUUM INTO` 一致性快照 |
| schema 版本或 migration 失败 | 启动失败或数据不可读 | `user_version` 检查、迁移前备份、事务化 migration、失败拒绝启动 |
| 多实例/多请求同时写 | 事务冲突、version 覆盖 | 数据目录写锁 + 进程内队列 + `BEGIN IMMEDIATE` + 事务内 version 复查 |
| 跨聚合级联归档 | 部分任务更新、部分未更新 | 不级联重写；查询按 `members.archived_at` 排除归档成员 |
| 父子层级/成员角色被 API 绕过 | 聚合模型破坏 | JSON Schema + service 不变量 + 422 测试 |
| 运行中直接复制目录 | 备份包含不同时间点页或 WAL | 暂停写队列 + `VACUUM INTO` 一致性快照 + 副本校验后发布 |
| 自由文本/diff HTML 注入 XSS | 成员浏览器被执行脚本 | jsdiff 仅返回数据，Vue 文本渲染，禁 v-html/diff2html，CSP |
| 全量历史或大文本即时 diff 阻塞 | 看板卡顿、主线程长任务 | 当前页计算 + revisionId 缓存 + 结果限制；必要时后续 Worker |
| 首版过度实时化 | 架构复杂、问题难查 | 聚焦刷新 + 短轮询，SSE 留作增量 |
| 原型功能遗漏 | UI 完成但产品不对 | §1 追溯矩阵 + 浏览器主链路 |

## 4. 审查补齐记录与设计自检

本轮已按 SQLite 可实施性审查补齐：带 taskId 的 assignments、nullable RevisionResult、主/小任务 DTO/version、缺失 service 方法、`[start,end)` 历史边界、删除候选集合、团队全部任务的历史权限、created-then-deleted 优先级、稳定 cursor、归档与查询时效、LAN 连接关闭语义，以及 currentlyDeleted 徽章和置底展示。

## 5. 设计自检（builder check）

本轮按“没有看过对话的实现者能否继续”检查：

- 已回答：运行形态、技术栈、角色边界、数据范围、任务层级、字段、看板口径、历史算法、主要端点、SQLite schema、事务写、迁移、备份恢复和测试主链路。
- 已确认：SQLite 单库；当前状态关系化、历史保存完整聚合快照；时间段 diff 取 before/after，以 jsdiff diffLines 计算并由 Vue 自研双列渲染；auth-session 只保存认证会话；成员个人页 owner 更新进度/完整详情并管理小任务、协作只读，成员事项跟踪完全只读且无成员管理页；默认 loopback，按需动态启用具体 LAN IP 并派生分享 URL；任务管理负责人筛选采用服务端 `ownerIds`，主任务负责人命中保留整条任务，仅子任务负责人命中只保留对应子任务，且与重要度/搜索取交集。
- 设计者自行决定的小项：`better-sqlite3` 驱动、UUID、API v1 前缀、15 秒轮询、hash 路由、模块目录、token 32 字节、CSS/SVG 图表、revision checksum。实现可调整细节但不能破坏事务、备份与恢复边界。
- 仍需用户回答：Q2 会改变安全与 UI 契约；Q3/Q4/Q5/Q6/Q7 会改变字段、交互或统计口径。存储驱动与历史快照形态见 06 §11，未确认前不应开始完整实现。
- 无实施排期：遵守仓库流程树未初始化的约定，本稿不创建 roadmap、milestone 或 issue。

## 6. 设计验收场景

1. 一条命令在新数据目录启动，默认仅 loopback，本机浏览器进入管理端；动态开启具体 LAN IP 后成员可访问，LAN 上 Admin API 仍拒绝。
2. 局域网 A/B 使用不同链接，都有成员个人页和只读事项跟踪，都能看到团队全部任务；无成员管理页，写权限只给主任务 owner。
3. 管理员完成任务夹、成员、主任务和一层小任务维护，刷新/重启后保持；迁移后旧数据完整。
4. 成员 owner 只能在个人页保存主任务进度、编辑完整详情和管理小任务，collaborator 与其他成员只读；成员事项跟踪可看团队全部任务但完全只读；并发冲突有可见处理。
5. 看板统计、成员过滤、预计完成时间分布与原型口径一致。
6. 默认/自定义历史查询按 [start,end) 准确还原 before/after，start 恰好变更不漏算；空历史、区间内创建/删除不造假，当前已删除项显示徽章并置底。
7. 链接生成、重置、吊销与旧会话失效一致；残留 session 行也不能绕过 link 校验。
8. 故障注入覆盖事务提交前中止、migration 失败和进程重启，重启后无未定义半状态。
9. 在线备份可在新目录恢复，数据库完整性、外键、revision checksum 和引用关系完整；旧格式备份可导入。
10. 桌面与窄屏视觉对照原型，键盘、焦点和错误/空态可用。

## 7. 确认后的下一步

先根据 Q2–Q7 与 06 §11 修订本文档集，把其余推荐/待确认项改成明确结论；开发落地时再更新 `docs/architecture.md` 的产品技术形态，并把 proposed Agent Note 推进到 implemented。实施排期与流程树另行讨论，不在设计评审轮擅自初始化。
