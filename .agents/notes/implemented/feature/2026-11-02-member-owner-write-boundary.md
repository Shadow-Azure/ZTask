# Agent Note: 成员写入边界：负责人最小写与聚合版本

Status: implemented

[English](2026-11-02-member-owner-write-boundary.en.md) | 中文

## Problem

成员个人页需要写入，但成员权限远小于管理员。[02](../../../../plan/fullstack-design/02-features.md) §4.2–4.3 与 [05](../../../../plan/fullstack-design/05-api-design.md) §6.6–6.10 定了「负责人可改进度/详情/小任务、协作人只读」的端点与字段，[07](../../../../plan/fullstack-design/07-backend-implementation.md) §3 定了写路径要过聚合队列与 revision；但设计没有定清四个实现边界：owner 的判定口径、小任务 owner 是否可由成员指定、409 时服务端是否替用户合并草稿、以及「没有有效变化」是否也追加 revision。这四点直接决定成员写会不会越权、会不会制造假历史。

## Decision

- **只认主任务 owner**：`assignments` 中 `(taskId = 主任务, kind = owner, memberId = 会话成员)` 才可写；不可见任务（无关成员、软删、小任务 id）一律 404 `TASK_NOT_FOUND`；可见但非 owner（主任务 collaborator、仅小任务被分配者）403 `OWNER_REQUIRED`。
- **写面最小化**：只开放 `progress`、`detail`、`subtasks` 五个端点；主任务描述、分配、重要度、预计完成、`folderId`、删除主任务、新建顶级任务全部不开放。JSON schema `additionalProperties:false` 先拦，服务层再拒绝未知字段（小任务显式拒绝 `owner`/`ownerId`）。
- **小任务规则**：只能一层；创建时 owner 强制为当前成员；编辑不能改 owner；删除为软删除并移除该小任务的 assignments；`subtaskId` 必须属于路径上的父主任务。
- **版本与 revision**：所有写操作必须携带聚合 `version`，不等则 409 `TASK_VERSION_CONFLICT` 且 `details.current` 为当前成员可见 DTO。写路径统一走 `taskStore.commit`，actor 为 `{ kind: "member", memberId, name }`，changeKind 为 progress/detail/subtask。使用 `canonicalJson` 做变更检测：无有效变化不提交、不追加 revision，返回 `revision: null`。
- **响应口径**：统一用分享域 `toMemberTask`，与成员 GET 同构，不泄露管理端字段。前端 409 只保留进度/详情/小任务草稿并提示刷新，不做自动合并。

## Alternatives considered

- 复用管理端 `PATCH /admin/tasks/{id}`：会同时开放描述、分配、重要度等字段，等于把管理员能力下放给成员 — 否决。
- 允许成员指定小任务 owner 或协作人：与「最小写入」冲突，也绕过管理员的分配权 — 否决。
- 409 时服务端按字段自动合并：无法判断用户意图（尤其是完整详情替换），会产生静默丢写 — 否决；前端保留草稿、由用户刷新后重提。
- 详情只能追加（旧原型）：设计 02 §4.2 已明确允许编辑完整当前文本并追加快照，追加输入被替换为可编辑 textarea — 否决旧交互。
- 成员写也产生 `admin` 类型 revision：会让历史无法区分本人与管理员操作 — 否决。

## Consequences

- 成员写与管理员写共享同一聚合、version 与 revision 协议，冲突语义一致。
- 小任务 owner 恒为自己；若将来要「负责人分配小任务」，需要另立 issue 并先改权限模型。
- 前端冲突只能提示刷新，草稿不自动合并；这是为了避免静默覆盖服务端新版本。
- 归档成员的会话在 #18 已被拒绝，成员写无需再单独判断归档，但服务层仍只按 owner 关系授权。
