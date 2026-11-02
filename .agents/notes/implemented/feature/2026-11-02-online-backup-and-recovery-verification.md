# Agent Note: 在线备份一致性、恢复校验与 doctor 分类

Status: implemented

[English](2026-11-02-online-backup-and-recovery-verification.en.md) | 中文

## Problem

首版交付前必须证明「运行中备份不会混入不同时间点的文件」「恢复不会污染正式目录」「诊断不会悄悄修复不可解释的损坏」。[06](../../../../plan/fullstack-design/06-database-design.md) §10 与 [07](../../../../plan/fullstack-design/07-backend-implementation.md) §9 定了暂停写队列、临时目录校验、原子发布和 doctor 只读，但没有定触发方式、备份目录布局、失败后的清理与 doctor 的问题分级。这些边界决定备份能否作为交付物、恢复失败时是否留下半状态。

## Decision

- **备份由运行中的服务执行**：只有持有写队列的进程能保证一致性，因此提供 `POST /api/v1/admin/maintenance/backup`（受既有 Admin 本机守卫保护，LAN 403）；CLI `ztask backup` 通过 loopback 调用该端点，而不是抢占数据目录锁。并发备份返回 409 `BACKUP_IN_PROGRESS`。
- **快照流程**：`pauseWrites()`（暂停新 mutation，等待在途队列）→ 复制数据目录到 `tmp/backup-*`（排除 `locks/`、`tmp/`、`backups/`）→ 校验 manifest、JSON 解析、JSONL checksum 与 revision tip、引用关系 → 写 `backup.json` 报告 → `rename` 到 `backups/<UTC 时间戳>-<uuid>/` 原子发布 → 释放队列。任何一步失败都清理临时目录并恢复写入。
- **备份报告**：记录格式版本、应用版本、创建时间、团队时区、文件数/字节数、校验结果与问题列表；`backup.json` 与数据一起存放，供恢复/诊断复核。
- **恢复不原地覆盖**：`restoreFromBackup` 先对备份目录做完整校验，再复制到目标旁边临时目录、对临时目录执行 `initStore`（manifest/恢复/索引）验证，最后原子 `rename` 到目标目录；目标必须不存在或为空，失败不留下半恢复目录。
- **doctor 只读分级**：`doctor(dataDir)` 只扫描不写；问题分 `fixable`（JSONL 末尾半行、current 落后 revision——启动恢复会重建）与需要备份介入（current 领先/checksum 不一致、中间 checksum、引用缺失、manifest/network 损坏、文件结构损坏）。`validate.ok` 表示「无阻塞问题」，可自动修复的快照仍可备份与恢复，`issues` 完整上报。CLI 发现问题退出码 1，帮助新用户判断「重启即可」还是「从备份恢复」。
- **备份包含所有业务状态**：manifest、任务聚合与 revisions、folders/members、network.json、auth-sessions 一并复制（会话策略与分享链接随数据一致）；不包含锁文件与临时文件。

## Alternatives considered

- 停止服务后复制目录当在线备份：会把「运行中备份」变成停机操作，且无法保证复制期间没有写入 — 否决。
- CLI 备份直接抢数据目录锁：服务运行时会失败，无法满足在线备份 — 否决。
- 恢复直接解压/覆盖正式目录：中途失败会留下混合状态，无法回滚 — 否决。
- doctor 自动修复中间 checksum：会把「解释不了」的损坏伪装成修好，违背 06 §8.3 的拒绝静默修复 — 否决。
- 备份只存 current 不存 revisions：恢复后历史/diff 丢失，违反验收「历史一致」 — 否决。

## Consequences

- 备份是完整目录快照，体积随历史增长；首版不压缩、不清理旧备份，由用户自行管理。
- 备份期间 mutation 会短暂排队，HTTP 请求可能变慢；超时由客户端重试，不丢写。
- 恢复后的服务沿用备份中的会话与分享链接（未过期仍可用）；若需要「恢复即吊销」，必须另立安全策略。
- doctor 只报告不修复；「可自动修复」的判定必须在重启实际修复后复核，不能替代备份。
- 已知边界：暂停的是任务写队列，实体文件（members/folders/network/session）不在闸门内；备份可能包含「任务快照 + 稍新的实体文件」。
