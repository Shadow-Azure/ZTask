# 03 · 前端架构与组件选型

> 目标是在不重设计原型的前提下，把单文件 HTML 迁移为可维护、可测试、真实接入 API 的 Vue 应用。

## 1. 技术选型

| 类别 | 推荐 | 用途与理由 |
| --- | --- | --- |
| 框架 | Vue 3 + TypeScript | Composition API 适合拆出树、看板、浮窗和分享视图逻辑 |
| 构建 | Vite | 开发 HMR，生产输出静态 dist 由 Fastify 同源托管 |
| 路由 | Vue Router | 管理页深链与 `/#/s/<token>` 成员入口；首版可沿用 hash 模式 |
| 服务端状态 | TanStack Query for Vue | 请求缓存、失效、重试、轮询与 mutation 生命周期 |
| 页面 UI 状态 | 局部 composable + 少量 Pinia | 选中任务夹、tab、筛选、树宽和浮窗草稿；不复制服务端实体 |
| 表单与校验 | 原生 Vue 表单 + 共享 schema/错误映射 | 控件数量可控，避免引入改变原型视觉的表单系统 |
| 样式 | 原型 CSS tokens + 组件 scoped CSS | 保持颜色、间距、卡片、tab 和浮窗基线 |
| diff | **jsdiff（npm `diff`）的 `diffLines`** | 已确认：计算 before/after 行级差异，Vue 自研双列文本渲染；不使用 diff2html/v-html |
| 测试 | Vitest + Vue Test Utils + Playwright | 纯函数、组件、关键浏览器链路三层验证 |

不引入 Element Plus/Ant Design Vue 作为首版基础皮肤。可以按需使用无样式辅助库，但任务卡、统计卡、按钮、浮窗和 tab 以原型 DOM/CSS 为视觉基准。

## 2. 路由与页面边界

| 路由 | 页面 | 数据权限 |
| --- | --- | --- |
| `/` | 重定向到 `/#/tracker` | 不加载业务数据 |
| `/#/tracker?folder=<id>&tab=tasks&owners=<ids>` | 管理员事项跟踪；owners 为空表示全部负责人 | admin API |
| `/#/tracker?folder=<id>&tab=dashboard&members=<ids>` | 管理员情况看板 | admin API |
| `/#/tracker?...&task=<id>` | 当前页面上叠加任务浮窗 | admin API |
| `/#/members` | 成员与分享链接管理 | admin API |
| `/#/s/<token>` | 分享令牌交换，成功进入 `/#/s/home` | 匿名交换，之后 share API |
| `/#/s/home` | 成员个人页：负责/协作任务，负责人管理进度/详情/小任务 | share API，owner 主任务进度/完整详情/小任务 |
| `/#/s/tracker?...` | 成员只读事项跟踪，含看板与只读详情 | share GET API，团队全部任务 |
| `/#/share-invalid` | 失效链接页 | 无业务数据 |

管理页中的 folder/tab/members/owners/task 是可分享、可后退的 UI 状态；owners 按成员 ID 稳定排序后写入 URL。搜索文本和临时浮窗草稿默认不进入 URL。成员 token 在交换成功后立即从地址栏移除，因此刷新后的路由为 `/#/s/home` 或 `/#/s/tracker`，由 Cookie 恢复会话；没有 `/#/s/members`。

管理员路由的导航 guard 只负责体验，真正权限由 API 决定。远程设备访问管理路由时显示“请从服务主机打开管理端”，不能通过前端绕过。

## 3. 推荐目录

```text
apps/web/src/
  main.ts                      应用装配，不承载业务请求
  App.vue                      路由出口与全局 toast/错误边界
  router/index.ts              管理/成员路由和深链解析
  api/
    http.ts                    fetch、同源凭证、错误模型、超时与取消
    queryClient.ts             QueryClient 默认策略
    queryKeys.ts               folder/task/member/dashboard 查询键工厂
    admin.ts                   管理端资源函数
    share.ts                   分享会话和成员任务函数
    generated/                 OpenAPI 生成类型，不手改
  stores/
    preferences.ts             树宽、折叠状态等本机 UI 偏好
  composables/
    useFolderSelection.ts      当前任务夹与后代范围
    useTaskEditor.ts           浮窗草稿、dirty、version 冲突
    useDashboard.ts            成员筛选、统计卡与时间范围
    useShareSession.ts         token 交换、恢复、失效处理
    useNetworkShare.ts         本机 IP、动态启停、running/degraded 状态
  pages/
    tracker/
      TrackerPage.vue
      components/
        FolderTree.vue
        FolderTreeNode.vue
        TaskBoard.vue
        TaskCard.vue
        SubtaskList.vue
        TaskEditorDialog.vue
        MemberMultiSelect.vue
        DashboardPanel.vue
        StatCard.vue
        DueDistributionChart.vue
        ProgressChangeQuery.vue
        ProgressDiff.vue
    members/
      MembersPage.vue
      components/MemberEditorDialog.vue
      components/ShareLinkCell.vue
      components/NetworkSharePanel.vue
    share/
      ShareSessionPage.vue        token 交换与会话恢复
      ShareLayout.vue           只提供成员个人页/事项跟踪两个导航
      MemberHomePage.vue        原型“成员链接 · 某某”页面
      components/MemberTaskCard.vue
      components/ShareInvalid.vue
  components/ui/               Button/Dialog/Toast/EmptyState 等薄组件
  styles/
    tokens.css                 原型 :root 设计令牌
    base.css                   reset、排版、焦点、滚动条
    utilities.css              少量通用布局，不做原子类大迁移
  test/                        MSW/fixtures/自定义渲染
```

页面专属组件 co-locate 在页面下；只有跨页面复用的基础组件进入 `components/ui`。TrackerPage 可通过 `access=admin|readonly` 复用信息架构，成员事项跟踪使用 share GET API 并强制只读；MembersPage 只供管理员使用，MemberHomePage 是独立的成员个人页，不与 MembersPage 复用；业务组件不直接拼接 fetch，统一通过 API 模块与 composable。

## 4. 状态归属

| 状态 | 权威位置 | 说明 |
| --- | --- | --- |
| 任务、成员、链接状态、看板 | 服务端 SQLite 存储 / TanStack Query cache | 不用 Pinia 再保存一份实体副本 |
| 当前 folder/tab/成员筛选/负责人筛选 | URL + 页面 composable | 可刷新、可后退、可复制管理页深链 |
| 树展开、树宽、子任务栏宽 | localStorage 偏好 + 内存 | 只改善本机体验，不是业务事实 |
| 管理员浮窗表单、未保存小任务 | `useTaskEditor` 草稿 | 保存前不写 query cache |
| 成员个人页进度/详情/小任务草稿 | MemberTaskCard 局部状态 | 仅 owner 主任务；保存成功才更新权威 cache |
| 分享 token | 仅交换前短暂存在于内存 | 不进入 Pinia/localStorage/query cache |
| 分享会话 | HttpOnly Cookie + 服务端 | 前端只保存脱敏的当前成员摘要 |

查询键至少包含权限域和资源参数，例如 `['admin','tasks',folderId,q,importance,ownerIds]`、`['admin','dashboard',folderId,memberIds]`、`['share','tasks']`。管理员与成员 cache 不共用实体 key，避免切换身份时复用越权数据。

## 5. 核心组件树

```text
TrackerPage
├─ AppHeader
├─ FolderTree
│  └─ FolderTreeNode（递归，仅任务夹）
│     └─ TaskTreeItem（打开浮窗，不展开第三层）
├─ PaneResizer
└─ TaskBoard
   ├─ BoardHeader / Tabs
   ├─ TaskManagementPanel
   │  ├─ TaskToolbar
   │  │  ├─ ImportanceFilter
   │  │  ├─ AssigneeFilter（仅管理员）
   │  │  └─ TaskSearch
   │  └─ TaskCard[]
   │     ├─ TaskSummary
   │     ├─ SubtaskList（只读）
   │     └─ ProgressDetail（完整文本）
   ├─ DashboardPanel
   │  ├─ MemberFilterChips
   │  ├─ StatCard[]
   │  ├─ DueDistributionChart
   │  └─ ProgressChangeQuery
   │     └─ ProgressDiff[]
   └─ TaskEditorDialog
      ├─ TaskFields
      ├─ Owner/Collaborator MultiSelect
      └─ SubtaskEditor[]
```

TaskCard 始终是只读组件，不接收 mutation 回调；管理员使用 TaskEditorDialog，成员只复用 TaskDetailDialog 的只读字段布局。`access=readonly` 时不渲染新建、编辑、删除、进度、详情追加或保存控件，即使任务属于当前成员也不能开启。成员个人页的 MemberTaskCard 是另一套有限编辑组件，只开放 owner 主任务进度、完整详情和小任务管理。

## 6. 请求与刷新策略

- 首屏按区块请求：树、当前任务列表可以并行；看板只有切到该 tab 才请求。
- `staleTime` 可设为 10–15 秒，窗口重新聚焦时失效当前资源；当前任务列表与成员个人页/只读事项跟踪可使用 15 秒轮询作为首版协作刷新。
- mutation 成功后以响应更新当前实体，并失效受影响的 tree、list、member counts 和 dashboard query。
- 切换 folder/tab 时取消不再需要的请求，避免慢响应覆盖新选择。
- 4xx 不自动重试；网络错误和 5xx 采用有限指数退避。mutation 不自动重放，除非接口明确幂等。
- 成员 401/403 统一清理内存会话并进入失效页，不把后端错误正文或 token 写入日志。

## 7. 样式与原型迁移

1. 先抽取原型 `:root` 的颜色、字体、边框、阴影、间距与尺寸，禁止各组件重新发明状态色。
2. 按 App shell、任务树、任务卡、看板、管理员成员页、成员个人页、只读壳和浮窗分段迁移，使用截图对照而非重新凭感觉设计。
3. 任务卡维持“标题/属性 + 进度”头部和“小任务/进展详情”双栏只读主体；小任务环形进度与树中的环形进度沿用原型。
4. 重要度：高红、中橙、低灰；进度完成使用绿色；diff 红删绿增。所有颜色同时有文本/图标，不仅靠颜色传达。
5. 浮窗采用 teleport + focus trap，支持 Escape、焦点归还和确认未保存草稿；不能直接把原型 overlay 的显示/隐藏当作完整可访问性实现。
6. 窄屏下树与任务板按原型断点调整，双栏详情和 diff 可转为单栏或内部滚动；不能以桌面截图为唯一验收。

## 8. 可访问性与安全渲染

- 树使用合适的 `tree/treeitem` 或等价键盘模型，展开、选中和进度有可读名称。
- 分栏拖拽同时支持左右方向键，保留原型 `role=separator` 与 `aria-valuenow`。
- 统计卡若可点击，使用 button 语义；tab 使用 tablist 键盘行为。
- 所有用户文本由 Vue 插值/`v-text` 渲染；禁止把任务详情、成员名或 diff 行传入 `v-html`。
- 复制链接必须由明确用户点击触发；失败时提供可选中文本，而不是假装复制成功。
- token 不写入前端错误监控、console 或分析事件。

## 9. 测试边界

| 层级 | 必须覆盖 |
| --- | --- |
| 纯函数 | folder 深链解析、统计桶、日期边界、version 冲突草稿归并、jsdiff change objects → 双列行映射、末尾换行/空行 |
| 组件 | 树选择/展开、只读卡无编辑控件、浮窗校验、小任务不能嵌套、成员多选、链接危险确认 |
| 权限体验 | 个人页 owner 可保存进度/详情并管理小任务、collaborator 只读；事项跟踪任何任务均无写控件；无成员管理路由；401 清理 cache |
| 浏览器 | 管理员建成员/任务→生成链接→成员在个人页更新负责事项与小任务→只读事项跟踪看到变化；A/B 视图隔离 |
| 视觉 | 桌面与窄屏的任务卡、浮窗、看板、成员个人页、只读事项跟踪、失效页，对照原型截图 |
