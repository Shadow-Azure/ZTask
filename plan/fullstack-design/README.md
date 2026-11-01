# ZTask 前后端整体设计（讨论稿）

> 状态：2026-11-01 持续评审；主要持久化已确认为“分聚合 JSON + JSONL”。本文档集不是实施排期，也不初始化开发流程树。
> 产品原型：[m1-01 UI 原型](../m1-01-ui-prototype/ztask-prototype.html)。
> 使用架构参考：`/Users/zn-ice/2026/deepseek-harness`；文档组织参考：`/Users/zn-ice/2026/harness-evolution/plans/fullstack-design`。

## 一句话方案

ZTask 是一个由 `ztask serve` 启动的本地团队进度服务：一个 Node.js 进程同时提供 Vue Web UI 与 Fastify API，业务数据按聚合保存为可读 JSON，并用 JSONL 追加完整历史快照；管理员在本机查看和操作事项跟踪、成员管理；成员通过局域网独立高熵链接进入个人页和只读事项跟踪，在个人页更新自己负责任务的进度、编辑完整详情并管理小任务，数据仍按成员相关范围隔离。

## 文档地图

```text
01 总体架构：进程、访问边界、数据流与部署
  ▼
02 功能拆分：原型功能、角色权限、业务口径
  ├──► 03 前端架构：Vue 组件、路由、状态与样式
  ├──► 04 后端架构：Fastify 模块、鉴权与聚合写协议
  │         ├──► 05 API 设计：前后端契约
  │         └──► 06 文件存储设计：JSON/JSONL、恢复与迁移
  │                   ▼
  │            07 后端实现设计：服务算法与测试
  ├──► 08 前端实现设计：页面数据流与交互落地
  └──────► 09 Review 指南：追溯、风险与待确认问题
```

| 文档 | 回答的问题 | 建议读者 |
| --- | --- | --- |
| [01 总体架构](01-architecture.md) | 为什么采用单进程本地服务与文件聚合，权限边界如何成立 | 所有人先读 |
| [02 功能点拆分](02-features.md) | 原型功能如何变成真实能力，统计口径是什么 | 产品评审 |
| [03 前端架构](03-frontend-architecture.md) | Vue 技术栈、目录、组件和状态如何组织 | 前端实现前 |
| [04 后端架构](04-backend-architecture.md) | Fastify 分层、身份模型、写队列与文件协议如何落地 | 后端实现前 |
| [05 API 设计](05-api-design.md) | 管理员端与成员端如何通信，错误和并发契约是什么 | 写任一端前 |
| [06 文件存储设计](06-database-design.md) | JSON/JSONL 格式、完整快照、原子写、恢复与备份如何设计 | 写后端前 |
| [07 后端实现设计](07-backend-implementation.md) | 树查询、成员过滤、分享令牌、历史比较与故障注入如何实现 | 后端评审 |
| [08 前端实现设计](08-frontend-implementation.md) | 原型页面如何映射为组件、请求和交互 | 前端评审 |
| [09 Review 指南](09-review-guide.md) | 需求是否全覆盖，有哪些风险与待拍板问题 | 讨论时先看 |

## 技术决策状态

| 决策 | 当前方案 | 状态/理由 |
| --- | --- | --- |
| 产品形态 | 本地 CLI + 单进程 Web 服务，不做桌面壳 | 推荐；与 DeepSeek Harness 的使用方式一致 |
| 全栈语言 | Node.js 22 + TypeScript + pnpm workspace | 推荐；沿用仓库工具链 |
| 前端 | Vue 3 + Vite + Vue Router + TanStack Query | 推荐；组件化实现原型，分离服务端与界面状态 |
| 后端 | Fastify 模块化单体 | 推荐；轻量、schema 校验成熟 |
| 主要持久化 | 分聚合 JSON + JSONL | **已确认**；纯 JS、文件可读、按任务追加历史与恢复 |
| 历史模型 | 每次有效任务变更追加完整聚合快照 | **已确认**；起止快照即时 diff，不做纯事件重放 |
| 认证会话 | `auth-sessions/<sessionId>.json` + HttpOnly Cookie | 推荐；只存 verifierHash，link 状态兜底吊销 |
| UI | 迁移原型设计令牌与布局，不引入重塑视觉的 UI 套件 | 推荐；优先遵从原型 |
| 管理员身份与网络 | 默认仅 loopback；按需动态增加具体 LAN IP 监听，LAN 上 Admin API 一律拒绝 | **已确认**；本机管理、局域网只读分享 |
| 分享地址 | `network.json` 保存 shareBaseUrl，链接生成时动态拼接 | **已确认**；切换 IP 不重写 token，旧 URL 重新分发 |
| 成员身份与页面 | 高熵令牌换会话；个人页 + 只读事项跟踪，无成员管理页 | **已确认**；负责人仅个人页更新进度/完整详情/小任务，协作只读 |
| 多人同步 | 聚焦刷新 + 短轮询 + optimistic version | 推荐；首版不引入 SSE/WebSocket |

## 仍需讨论的产品问题

1. 分享令牌若只存哈希，完整链接只能在生成/重置时复制一次；随时复制需要可恢复 secret 或调整交互。
2. 小任务的协作人员与详情字段是否和主任务完全统一；负责人可在个人页管理小任务。
3. 删除是否采用软删除以保留历史；推荐软删除任务、归档成员，普通页面隐藏，历史保留。

上述未确认项在 [09 §2](09-review-guide.md#2-访问决策与待确认问题) 集中列出；存储方案不再属于待确认项。

## 调研依据

本设计参考 DeepSeek Harness 的 CLI 启动、明确绑定地址、同源静态前端/API 和本地文件持久化思路，但不继承其 React、Cordis 或 Agent Session 格式。文件方案重点参考以下官方资料：

- [JSON Lines](https://jsonlines.org/)：每行一个完整 JSON 值，适合追加日志与流式处理。
- [jsdiff](https://github.com/kpdecker/jsdiff)：已确认的 `diffLines` 行级差异计算库；Vue 自研双列渲染，不采用 HTML 字符串注入式展示。
- [Conf](https://github.com/sindresorhus/conf)：原子写、schema 与 migration 的参考；官方明确其全量 JSON 定位是配置而非业务数据库，因此不采用单文件全库。
- [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile)：单写者锁、stale/compromised 处理与限制。
- [NeDB](https://github.com/seald/nedb)：纯 JS append-only 持久化与 compaction 的备选参考。
- [PouchDB revision/conflict](https://pouchdb.com/guides/documents.html)：文档版本冲突模型的参考。
- [Fastify Hooks](https://fastify.dev/docs/latest/Reference/Hooks/)：路由前统一身份和权限边界。
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)：CSPRNG、随机会话、Cookie 与哈希存储原则。
- [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) 与 [Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy)：会话 Cookie 与引用信息泄露防护。
- [SQLite 应用文件格式分析](https://www.sqlite.org/appfileformat.html)：仅用于理解事务、增量写和多进程协调等被文件方案转移到应用层的问题，不是产品选型。
