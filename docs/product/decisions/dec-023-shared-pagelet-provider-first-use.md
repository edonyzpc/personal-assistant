# DEC-023 — Pagelet 标准有界 Provider 路径共享首次非阻断通知

Decision ID: DEC-023
Status: Accepted
Updated: 2026-07-21
Authority: 用户于 2026-07-21 选择方案 A，确认 SG-05/SG-06、B-119 1A，以及“首次实际调用恰为高风险时由完整阻断披露同时完成共享首次告知”是现行统一规则
Work item: B-118
Related work item: B-119

## Context

[DEC-017](./dec-017-default-background-recap-preparation.md) 在 2026-07-18 选择
Scope Recap 默认进行有界后台准备时，仍要求首次通过 `run / adjust / cancel` 明确授权，
并认定被动 Notice 不足。随后用户在 B-118 的 SG-05/SG-06 中决定：配置 AI provider
已经构成信任选择；标准有界 Pagelet provider 路径默认工作，首次只显示一次共享、非阻断
通知；更广、更敏感或高成本运行继续逐次确认。B-118 SDD/Tracker 与 B-119 Graph、
Pattern、Maintenance 规划采用后一个模型，但 2026-07-21 当前源码复核证明 B-118
runtime 尚未完整对齐：fresh install 仍被旧 authorization tuple 置为 preparation off，
shared notice 也尚未统一到每个 feature 的第一次实际 provider call。

共享 first-use 还需要覆盖一个边界：第一次实际调用可能本身就是 broad、sensitive、
costly、whole-vault、out-of-envelope 或 excluded-scope override。此时高风险阻断披露
已经比普通非阻断通知更强；若两套披露不能合并，用户在同一次调用前会收到重复告知，
但若过早写入 shared flag，又可能把 Cancel、close 或未通过 gate 的 Adjust 误记为已告知。

由于后续决定只进入了 B-118 Tracker/SDD 和 B-119 文档，DEC-017、Scope Recap Product
Spec、B-118 Product Spec 与 Pagelet Product Design 仍保留旧授权条款，造成高优先级产品
合同与当前 runtime 互相冲突。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 所有标准有界 Pagelet provider 路径共享首次非阻断通知 | 与 North Star、SG-05/SG-06 和 B-119 1A 一致，并定义 current runtime reconciliation target；没有重复 Modal 或平行授权状态 | 必须同步旧 Decision/Spec，并保持 broad/sensitive/costly gate 清楚 | Accepted |
| B. Scope Recap 保留首次阻断授权例外 | 延续 DEC-017 原始隐私姿态 | 当前 runtime 需回退；同类有界读取出现不一致；shared first-use 无法代表 Recap | Rejected |

### 首次实际调用恰为高风险

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 完整高风险阻断披露同时完成 shared first-use | 同一次调用只告知一次；阻断披露强度高于普通 notice；可在真实调用 seam 精确写 flag | 必须定义完整披露内容与 Run/Adjust/Cancel 的 flag timing | Accepted |
| B. 高风险确认与 shared first-use 始终分开 | 两种机制机械独立 | 同一调用可能重复提示；用户已经看过更强披露后仍会再收到普通 notice | Rejected |

## Decision

选择 Option A，并规定：

1. 当 Pagelet 与 AI provider 已配置、对应 capability 开启、来源通过 Data Boundary 且运行
   保持在该 capability 的标准有界 envelope 内时，provider-backed note reading 默认可运行。
2. 第一次实际 Pagelet provider 调用前显示一次共享、非阻断通知，说明允许的笔记摘录可能
   发送给已配置 provider、可能产生 API 成本，以及关闭入口；通知后当前 eligible run
   继续执行。
3. Scope Recap、Quiet Recall、Discover，以及 B-119 Graph、Pattern、Maintenance 共用
   `pageletProviderFirstUseNotified` 语义。不得创建、重置或迁移为 feature-specific
   first-use authorization state。
4. 用户已经关闭的 capability 或后台准备偏好在 reload/upgrade 后继续关闭；本决定不把
   opt-out 静默改回开启，也不绕过 provider missing、无 eligible sources 或 Data Boundary
   deny 的 fail-closed gate。
5. broad、sensitive、costly、whole-vault、超出标准 envelope 或 excluded-scope override
   运行，仍必须在任何 provider call 或 cost reservation 前逐次显示 allowed note
   excerpts/data、scope、provider、可能成本、capability 关闭入口，并提供
   `run / adjust / cancel`。
6. 若第一次实际 Pagelet provider 调用恰为上述高风险运行，且该阻断披露完整覆盖第 5
   条内容，它同时完成 shared first-use disclosure，不再追加普通非阻断 notice。只有用户
   明确选择 `Run`、所有 gate 通过且真实 provider invocation 即将发生时，才把
   `pageletProviderFirstUseNotified` 设为 `true`。`Cancel`、被动关闭或未重新通过 gate
   的 `Adjust` 不改 flag；`Adjust` 后仍为高风险则再次通过高风险 gate，降为标准有界则走
   普通 shared notice。该 flag 已为 `true` 也不免除后续高风险运行的逐次确认。
7. provider 信任不等于持久化或写权限。Memory Prepare/Update、Memory admission、vault
   mutation、Markdown、外部 action 与其他高后果行为继续遵守各自的明确确认合同。
8. 本决定只替代 DEC-017 的“首次阻断授权 / 被动 Notice 不足”条款；Scope Recap 默认
   有界后台准备、独立预算、质量门、持久 opt-out、只读 derived artifact 等其余决定继续
   有效。

## Consequences

- Product behavior: 标准有界 Pagelet 能力在 provider 配置后低摩擦工作，首次透明告知；
  首次恰为高风险时由完整阻断披露一次完成共享告知；用户仍可分别关闭能力，广范围或
  高风险运行仍需逐次决定。
- Architecture / data / safety: 共享 first-use state 只表达通知已展示，不授予写权限；所有
  来源过滤、scope override、预算和 durable action gate 保持独立。
- Compatibility / migration: 保留现有 opt-out、shared notification 与 Scope Recap state；
  不重置已通知用户，也不要求为本决定新增授权迁移。
- Work created or removed: 同步 DEC-017、Data Boundary、Scope Recap、B-118/B-119 与
  Pagelet 当前合同，并把 B-118 runtime reconciliation 重新标记为待实现；本决定本身
  不授权新的 runtime、commit、push、tag 或 release。

## Revisit Trigger

- 真实隐私事件或 dogfood 证明标准有界后台读取仍需要 capability-specific 阻断确认。
- 用户无法理解首次通知、找不到关闭入口，或 opt-out 在升级后失效。
- 新 capability 无法定义清晰的标准 envelope，或需要默认读取 whole-vault/敏感来源。
- provider first-use state 开始被错误复用为 write、Memory admission 或外部 action 权限。

## Traceability

- North Star: [PA Product North Star](../pa-product-north-star.md)
- Amended decision: [DEC-017](./dec-017-default-background-recap-preparation.md)
- Source decision package: [B-118 Tracker SG-05/SG-06](../../development/active/pagelet-ui-ux-optimization/tracker.md)
- Current specs: [PA Data Boundary](../specs/pa-data-boundary-product-spec.md)、[Scope Recap](../specs/pa-scope-recap-theme-summary-product-spec.md)、[B-118 Product Spec](../specs/pagelet-ui-ux-hardening-product-spec.md)
- B-119 adoption: [DEC-022](./dec-022-bounded-insight-enhancement-layer.md)、[B-119 Product Spec](../specs/pa-insight-enhancement-layer-product-spec.md)
- External mirror: [Linear SLA-11](https://linear.app/slateleaf/issue/SLA-11/规划-b-119-洞察增强层graph-pattern-maintenance)
- Supersedes / superseded by: supersedes only DEC-017's original first-use blocking clause; none otherwise
