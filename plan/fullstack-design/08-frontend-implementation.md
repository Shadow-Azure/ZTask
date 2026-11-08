# 08 · 前端实现设计

> 前端实现以原型为验收基线。优先迁移真实数据流与权限体验，再逐项对齐像素和交互，不在迁移中另起一套产品形态。

## 1. 应用装配

`main.ts` 创建 Vue、Router、QueryClient 与少量偏好 store。App 不预取全库任务；每个页面按自身权限域请求。全局只注册错误提示、dialog/teleport 容器和必要样式。

开发环境 Vite proxy 只代理 `/api` 到 Fastify。生产环境 Fastify 提供 dist，API base 始终同源，不在构建时写死局域网 IP。

## 2. TrackerPage 数据流

### 2.1 初始化与深链

1. 从 route query 读取 folder/tab/members/task；无 folder 时选择树根节点或显示空态。
2. 按 access 从 admin/share API 请求 folder tree；若 URL folder 已删除或不在当前树中，回退到全部任务夹并替换 URL。成员树与管理端同构。
3. tab=tasks 时请求当前 folder 任务；tab=dashboard 时才请求 summary/changes。
4. task 参数存在时请求该任务并打开浮窗；无权限/不存在显示可关闭错误，不让整页崩溃。
5. 浏览器前进/后退只改变路由状态，不重复创建全局监听器。

### 2.2 FolderTree

树组件接收已构树的 DTO，不在组件内递归请求。folder 行 click 选择并展开，chevron click 只折叠；task 行 click 设置 route task。树中只读进度环用 SVG，包含 aria-label。

仅管理员可新建任务夹并在当前选中节点下插入 inline input；成员模式不渲染该入口。树宽偏好保存 localStorage，键盘和 pointer 都调用同一个 clamp 函数。

### 2.3 TaskBoard

`TaskManagementPanel` 的 query key 包含 folder/q/importance/ownerIds。所有筛选（包括搜索）都走服务端查询，避免分页后只过滤当前页；`ownerIds` 只用于管理员任务管理，成员只读事项跟踪不渲染该入口。

TaskCard 不直接接收整个 TaskEditor 草稿。点击标题路由到 task 深链；管理员打开 TaskEditorDialog，成员打开同布局的只读 TaskDetailDialog。管理员编辑成功后 tree count/progress、当前 list 和 dashboard 相关 query 失效。

### 2.4 负责人筛选

工具栏按“重要度筛选 → 负责人多选 → 搜索”排列。负责人控件复用管理员成员目录，支持按姓名/角色搜索、多选和清除；选中成员之间为 OR，空选表示全部。选中 ID 按稳定顺序写入 URL `owners`，刷新、后退和复制链接都恢复同一筛选；清除时删除该参数。

筛选在服务端执行，前端不下载全量任务再过滤。`GET /admin/tasks` 返回的 `subtasks` 已在“仅子任务负责人命中”时裁剪；前端用所选 `ownerIds` 与 `task.owners` 是否相交判断整条命中还是子任务命中。子任务命中时，卡片显示“已按负责人筛选，仅显示所选负责人负责的子任务”，完成数按返回的可见子任务计算；主任务负责人命中时行为与未筛选一致。

负责人、重要度和搜索始终取 AND；任一条件变化都重置 cursor 并刷新列表。筛选只影响列表响应；打开任务编辑浮窗仍请求完整聚合，不会把裁剪后的子任务当作完整任务保存。无结果时显示组合条件空态，任务树计数、看板和成员视图不受影响。成员只读事项跟踪没有成员目录，不渲染负责人筛选。

## 3. TaskEditorDialog

### 3.1 草稿模型

打开时深拷贝服务端 TaskEditor DTO；新小任务使用 `clientId`，不写回伪造的服务端 UUID。owners/collaborators 两个集合在 UI 互斥，删除某成员时同步清理另一边选择。

字段校验与后端一致：描述必填、至少 owner、progress 整数、dueDate 合法、小任务不能再添加子级。校验错误靠近字段显示，而不只 toast。

### 3.2 保存与冲突

- 保存调用一个原子 editor API，携带基准 version 和完整编辑意图。
- pending 时禁用重复提交；失败保留草稿。
- 409 时展示“服务器已有新版本”，提供查看最新与重新应用我的更改；不能自动强制覆盖。
- 成功后以响应替换 cache，关闭浮窗并清理 route task。
- 关闭有 dirty 草稿时二次确认；Escape/遮罩与关闭按钮遵循同一逻辑。

### 3.3 小任务

小任务编辑行只包含原型允许字段。展示进度环/条、负责人、重要度和预计完成；没有“添加小任务”按钮。删除已有小任务只是草稿中的删除意图，原子保存成功后才从 cache 消失。

## 4. DashboardPanel

### 4.1 成员筛选与统计卡

成员 chips 按 access 来自管理端/分享域脱敏目录，URL members 保持稳定排序。管理员与成员空选都代表团队整体；多选按 owner 口径缩小。切换筛选后 summary、selected distribution 和 changes 一起刷新，stat card 选中状态保留但无数据时显示空态。

统计卡按钮显示总数、高/中/低拆分与展开状态。图表可以用 CSS/SVG 实现原型堆叠柱，不必为单图引入大型图表库；每柱有文本总数和可读的 title/aria 描述。

### 4.2 时间范围

日期控件只负责选择 startDate/endDate/mode。默认“昨天至今”由服务器解析 now，前端显示返回的实际边界。自定义结束日包含整天。点击“更新至现在”重新执行默认查询，而非把旧时间戳加一。

### 4.3 ProgressDiff：jsdiff + Vue 双列渲染

技术选型已确认：使用 npm `diff` 包提供的 `diffLines(beforeText,afterText)` 计算差异，不使用原型手写 LCS，也不引入 diff2html/diff-match-patch。后端只提供完整 before/after，组件按以下流程处理：

1. `before=null` 时直接展示“区间内创建”和 after 快照，不把它当成空文本计算 diff。
2. 统一 CRLF/LF，但保留原有空格、空行和末尾换行语义，不做全量 trim 或 ignoreWhitespace。
3. 调用 `diffLines` 获得有序 change objects，把每个 added/removed/unchanged part 展平为保留换行信息的行操作。
4. 映射为左右两列：unchanged 两边显示原文；removed 左红右空；added 左空右绿；相邻 removed+added 表示修改并合理配对，避免错位。
5. 统计新增/删除行数，保留原型默认展开、单条与批量展开/折叠行为。
6. 所有任务文本与 diff 行都通过 Vue 插值/`v-text` 渲染，禁止 `v-html`，因此 `<script>` 等内容只能作为文本显示。

change object → 双列行的转换必须是独立纯函数，覆盖：新增、删除、修改、未变化、连续变更块、中文、emoji、空详情、纯空行、末尾换行、长行和整段替换。相同 before/after 不进入结果（服务端已过滤）。

性能上按当前查询页/可见任务计算，并以 before/after revisionId 缓存结果；避免一次为全量历史执行 diff。长结果分页/限制，超出现实预算的大文本先给提示，后续确有性能问题再引入 Web Worker，不作为首版依赖。

## 5. MembersPage（仅管理员）

MembersPage 只供管理员使用，不向成员链接开放。管理员 query 返回成员、计数和链接状态。

管理员页面额外挂载 NetworkSharePanel：加载可选本机 IP 与 running/degraded 状态，支持选择地址、开启、切换和关闭分享。开启成功前禁用复制新分享 URL 的动作；失败后保留当前可用状态并展示错误，不假装已开启。

- 仅管理员可打开新增/编辑 dialog，表单只维护 name/role/color。
- 点击生成链接时若 LAN 未运行，先打开网络配置引导；收到 running=true 和 shareBaseUrl 后再调用生成端点。
- ShareLinkCell 只在管理员 MembersPage 挂载，只接收脱敏状态。生成/rotate 成功后，完整 URL 在受控结果区展示并支持复制，明确提示 secret 的分发风险。
- 若确认 hash-only，页面刷新后没有 raw URL，复制按钮不再伪称能复制旧链接，而显示“重新生成以复制”；这是对原型需要确认的微小调整。
- 重置、吊销、归档均只在 admin 模式使用统一确认 Dialog，文案说明对旧链接/任务分配的影响。
- 成员归档成功后失效任务 tree/list/dashboard，因为有效分配和计数已变化。
- 切换 IP 成功后，页面中的新分享 URL 使用新 shareBaseUrl，并提示旧 URL 需要重新分发；关闭分享只显示网络离线，不把链接标成已吊销。

## 6. ShareLayout、成员个人页与只读事项跟踪

### 6.1 进入与会话恢复

```text
路由含 token
  → POST /share/session（不在 query cache 中保存 token）
  → replace 地址为 /#/s/home，清除 fragment secret
  → 查询 share/tasks

无 token 的 /#/s/home 或 /#/s/tracker
  → GET /share/session 尝试 Cookie 恢复
  → 401 则显示失效/需要新链接页
```

交换中显示加载，失败统一失效页。成功后 ShareLayout 只提供“成员个人页”和“事项跟踪”两个导航，不提供成员管理、链接管理或网络配置，也不存在 `/#/s/members`。

### 6.2 MemberHomePage（原型“成员链接 · 某某”）

页面显示当前成员身份，以及“我负责的”“我协作的”“其他成员的任务”三组任务卡；三组默认展开，标题可点击折叠/展开并保留计数。

owner 主任务的 MemberTaskCard：

- progress slider 只改本地草稿，点击“保存进度”调用 PATCH progress；pending 防重复提交，成功后更新 cache。
- 完整详情进入可编辑 textarea，点击“保存详情”调用 PATCH detail；当前文本可以修改，历史 revision 不可编辑。
- 小任务区域提供新建、编辑、删除操作，分别调用对应 subtasks 端点；只能一层；新建小任务默认当前成员为 owner，不提供任何任务的分配编辑。
- 所有提交都携带父聚合 version；409 保留进度/详情/小任务草稿并提示服务器已有新版本。
- 不渲染主任务描述、任何任务分配、主任务重要度/预计完成/所在任务夹、删除主任务或新建顶级任务控件。


collaborator 与其他成员卡片展示相同任务信息，但进度、详情和小任务管理控件禁用或不渲染；其他成员卡标“其他成员 · 只读”，小任务摘要只读。

### 6.3 只读事项跟踪

复用 TrackerPage 的树、任务卡、看板、详情和查询交互，`access=readonly`：

- 使用 share GET API，左树和看板已按 memberId 限定范围。
- 不渲染新建、编辑、删除、添加小任务、进度滑块、详情追加或保存按钮。
- 数据为团队全部任务，左树完整；点击任务打开只读详情，不创建 TaskEditor 草稿，也不注册 mutation；自己的任务同样只能去成员个人页更新。
- 查询、筛选、统计图和 diff 展开可以使用，因为只改变 UI/查询参数。

## 7. 轮询、缓存与隐私

- 当前可见列表聚焦刷新并可 15 秒轮询；浮窗编辑期间不自动用新响应覆盖草稿，只在背后发现 version 变化并提示。
- dashboard 切到后台 tab 时暂停轮询，恢复后失效刷新。
- 成员注销/失效时调用 `queryClient.removeQueries` 清理 share scope，防止后退看到旧私有内容。
- 不在 localStorage 中存任务列表、token、session verifier 或成员私密详情；localStorage 只存布局偏好。

## 8. 原型视觉验收清单

- 顶栏、左树右板、可调分栏、下划线 tab 与原型一致。
- 任务卡是统一只读卡，完整小任务与进展直接可见，无旧版行内编辑按钮残留。
- 小任务/树任务进度环、重要度颜色、逾期标签和空态一致。
- 看板三统计卡、堆叠柱、日期面板、双列 diff 与展开状态一致。
- 管理员成员表格、链接操作、确认弹窗、任务编辑浮窗和 toast 一致；成员个人页复用原型卡片与进度视觉，并扩展完整详情编辑和小任务管理交互。
- 成员壳只有成员个人页/事项跟踪两个导航，失效页不包含业务导航。
- 1280/1440 桌面及原型窄屏截图对照；键盘操作和 200% 文本缩放无关键内容丢失。

## 9. 浏览器端到端主链路

1. 管理员首次启动，创建 A/B、嵌套任务夹、主任务与小任务。
2. 为 A/B 生成不同链接，在两个隔离浏览器上下文打开。
3. 验证 A 看不到 B 的任务，直接访问管理路由和 B task URL 也失败。
4. A 在成员个人页保存进度、编辑完整详情并新建/编辑/删除小任务；B 的协作任务与其他成员任务只读。双方事项跟踪都能看到团队全部任务但均无写控件，越权写请求不能改变数据。
5. 管理员维护 A 的任务进度与详情；A 的只读看板和管理员看板都能看到团队全部任务的变化与 diff。
6. 重置 A 链接，旧页面下一请求失效，新链接可用；B 会话不受影响。
7. 重启服务，验证数据和会话策略；模拟并发编辑出现 409 且草稿不丢。
