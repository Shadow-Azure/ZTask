# Development flow gates

English | [中文](README.md)

The flow tree is a three-layer document set — roadmap → milestone → issue — with structured data declared in `yaml flow` fences; the rules mirror the closed sets in `scripts/flow-lib.mjs`.

## Current state: uninitialized

ZTask has no flow tree yet: no roadmap, no `milestones/`, no `issues/`. Gate behavior: `pnpm verify:flow` reports "uninitialized, skipped" and passes; the `--diff` mode of PRs skips likewise when the base has no roadmap. Initialization is a separate decision — write the roadmap first, then open the tree.

## Layers and data

- roadmap: the `milestones:` list defines the milestone order and is the single sequencing authority.
- milestone: `milestones/m{id}-{slug}.md` with fields `id` / `title` / `status` (`planned` / `active` / `done`) / `github` (`{number, url}`, both null until synced).
- issue: `issues/{milestone}-{slug}.md` with fields `id` (stable `{milestone}-NN` number) / `milestone` / `depends` / `priority` (`P0` / `P1` / `P2`) / `status` (`backlog` / `ready` / `in-progress` / `done`) / `scope` (glob list) / `adr` / `github`.

## Rule highlights

- State machine: an issue moves only forward along backlog → ready → in-progress → done; dependencies must exist, live in earlier milestones and stay acyclic; a milestone reaches done only when all its issues are done.
- The Chinese body of an issue carries ten verbatim sections: 背景 / 目标 / 设计依据 / 实现内容 / 实施步骤 / 依赖与交付边界 / 独立验证 / 验收标准 / 门禁与 CI / 非目标.
- Commit and PR titles must carry `(#N)`; referenced issues must be ready / in-progress; files touched by the diff must fall inside the union of the referenced issues' scopes. No exemption channel.

## GitHub side

The only entry that writes GitHub is `pnpm flow:sync` (create objects, backfill numbers, align states); `pnpm verify:flow-online` only verifies that both sides agree. Tooling: `pnpm flow:new-issue` scaffolds an issue triplet.
