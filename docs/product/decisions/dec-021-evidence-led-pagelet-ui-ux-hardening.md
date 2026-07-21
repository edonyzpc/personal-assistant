# DEC-021 — 按真实界面证据分阶段修复 Pagelet UI/UX 漂移

Decision ID: DEC-021
Status: Accepted
Updated: 2026-07-21
Authority: 用户于 2026-07-19 要求把当日 UI/UX 审查与桌面/iPhone 实测完整交接给 Claude Code，并用于后续优化开发；2026-07-21 选择 DEC-023 方案 A，补齐 Review/preload 风险分类
Work item: B-118
Scoped resolution: SG-01 至 SG-04、SG-07a/SG-07b 已由用户于 2026-07-20
解决，SG-07c 已延期；SG-05/SG-06 由
[DEC-023](./dec-023-shared-pagelet-provider-first-use.md) 于 2026-07-21 统一，当前无
未决 SG product stop gate
Scoped semantic resolution: [DEC-024 — Quiet Recall cold semantic retrieval](./dec-024-quiet-recall-cold-semantic-retrieval.md)

## Context

2026-07-19 针对当天 commits 的真实桌面和 iPhone 审查证明：自动化与既有 beta
验证通过，不等于当前可见交互仍满足产品合同。当前至少有两个核心失败：iPhone
长按菜单项的触摸会额外到达 Pet 根交互，prepared Recap 首屏没有直接交付实际
洞察。

同一轮审查还记录了 Scope Recap 授权弹窗关闭、Reduce Motion、Quiet Recall
动作/反馈/设置、首次 provider disclosure、异步状态收敛、低字号可读性和桌面
Bubble 定位等风险。另一方面，iPhone 竖屏、真实横屏 safe area、44×44 触控目标、
短点开关和长按菜单出现/自动收起已有正向证据，修复不能把这些通过项无差别重做。

作为 2026-07-19 的审查来源记录，部分建议当时超出了“修复已复现 UI 漂移”的授权
范围，并与现行合同存在张力：Quiet/Balanced 的精确展示频率与迁移尚未决定；Recall
Bubble 与 Quiet Recall 的动作表并不一致；Retrieval Habit Profile 对反馈的学习必须
先 opt in；Saved Insight 已允许用户选择 `Later` 后形成 Review Queue item 或
lightweight saved draft；共享 Data Boundary 采用 first-use 加 broad/sensitive/costly
再披露，以及 excluded scope 的显式 per-run override，而不是每个 feature 自建授权
体系。B-118 当时不能替用户补出这些新的产品、隐私或数据保留决定；用户随后于
2026-07-20 解决 SG-01 至 SG-04、SG-07a/SG-07b，并把 SG-07c 延期。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 维持 B-108 已验证状态，只补更多自动化 | 改动最少 | 无法修复已在真机复现的核心触控与首屏价值失败 | Rejected；把历史测试误当成当前用户证据 |
| B. 趁机重做 Pagelet 视觉、动作和设置架构 | 可统一处理全部历史问题 | 范围过大，也会静默决定频率、授权、反馈和队列语义 | Rejected；不符合最小、可信修复原则 |
| C. 先修有证据的 P1/P2 漂移，再做有界视觉 polish；当时未决的产品边界设置 stop gate | 恢复核心体验且不越权 | 需要按 slice 保留证据和阻断点 | Accepted；2026-07-20 后相关 gate 按下文 resolution 执行 |

## Decision

选择 Option C，并以 B-118 作为新的 L3 Pagelet UI/UX hardening track：

1. 按 `P1 核心触控与首屏价值 -> P2 信任、motion、状态与可达性 -> P3 有界视觉
   polish` 分阶段修复；每个阶段独立测试、review、桌面 smoke 与真机回归。
2. iPhone 菜单动作不得额外触发 Pet 根 `onToggleBubble`。Capture、Review、Discover
   自己的 downstream callback 仍可按现行实现与合同打开或更新 Bubble、Panel 或
   Detail；“根切换为零”不能误写成“整个 Bubble 永远不变化”。
3. prepared Recap 首屏必须交付 fresh、source-backed 的具体 observation；通用
   ready 文案不能代替内容。该项执行 DEC-018 和现行 Scope Recap 合同，不创设新
   Recap 语义。
4. 修复必须保留已有正向证据：移动 safe area、44×44 目标、短点与长按基本行为、
   明暗主题和既有显式 Panel/Tab 路径。视觉 polish 不授权全局重构。
   `prefers-reduced-motion: reduce` 的 B-118 范围同时覆盖 Pet 装饰动画、Bubble
   open/close scale/translate 与 rich action hover 位移；停 motion 不能隐藏状态或动作。
5. B-118 的自动化、Inspector、桌面视觉、iPhone 视觉、用户手指触控和 QuickTime
   横屏证据必须分开标记；一种证据不能冒充另一种。provider-backed 路径默认使用
   provider-free fixture，无法建立无发送 seam 时标记 `BLOCKED`，不静默调用。
6. 共享合同继续优先于 B-118 的修复建议：
   - Data Boundary 的标准有界 Pagelet provider path 共用一次非阻断 first-use
     notice；broad/sensitive/costly/whole-vault 与 excluded override 仍逐次阻断。
     B-118 不创建或重置 feature-specific first-use state。
   - Retrieval Habit Profile 继续默认关闭，只有显式启用或完成轻量 first-use notice
     才能收集反馈并影响排序；Quiet Recall 的 `Dismiss` 仅在此边界内成为具体
     candidate 的弱信号。
   - Quiet Recall Bubble 的 `Later` 进入既有 Review Queue；`Link / Save` 仍留在
     Recall Detail Tab，不新增平行 queue 或 snooze 模型。
7. 2026-07-19 提出的 SG-01 至 SG-04、SG-07 不再是未决 gate：当前实现必须执行
   2026-07-20 的 resolution；SG-07c 的 ordinary Quiet Bubble empty-state redesign
   已移出 B-118，不阻断其余 slice。SG-05/SG-06 只执行 DEC-023。
8. 不新增自动写入、队列模型、全局 UI 架构、DEC-020/DEC-024 之外的 provider
   调用或 release 行为。任何 durable write 继续遵循现有确认与写入边界。

## SG-01..04 / SG-07 Resolution (2026-07-20)

2026-07-19 审查中记录的下列项目仅作为决策 provenance 保留；用户于 2026-07-20
给出当前产品 resolution，因此它们不再是 B-118 的未决实现 gate：

- `SG-01`：Quiet Recall 仅 `Off / On` 两档，默认 Off，不另设 frequency cap；由
  quality gate、quiet hours、Focus Mode 与每 candidate 一次共同控制噪声。旧
  `bubbleNudgesEnabled=true` 迁移为 On，false、缺失或其他状态迁移为 Off；Quiet
  Recall 与 generic hints、Scope Recap preparation/hints 解耦。
- `SG-02`：Quiet Recall Bubble 固定为 `View / Later / Dismiss`；`Link / Save` 留在
  Recall Detail Tab，View 使用当前候选进入 Tab 且不得重跑 provider。
- `SG-03`：Dismiss 只对当前具体 candidate 形成弱信号；RHP 关闭时零收集、零写入、
  零排序影响，被动关闭保持中性。
- `SG-04`：Later 进入既有 Review Queue，表达用户明确的 return intent。
- `SG-07a`：英文保留 `Quiet Recall`，中文使用“相关回顾”。
- `SG-07b`：显式 Discover 保持进入 Panel，不改变现有 IA。
- `SG-07c`：普通 Quiet Bubble empty state 保持现状，redesign 延期并进入 Backlog；
  该延期不阻断 B-118。

## SG-05 / SG-06 Scoped Resolution (2026-07-21)

用户选择方案 A，并由
[DEC-023](./dec-023-shared-pagelet-provider-first-use.md) 正式更新当前产品合同：

- Scope Recap、Recall、Discover 与 B-119 标准有界 provider path 共用一次非阻断
  first-use notice；通知显示后运行继续，不保留 Scope Recap 授权 Modal。
- 用户已有 opt-out 继续有效；任一 feature 不得创建、迁移或重置自己的首次状态。
- broad/sensitive/costly/whole-vault 与 excluded override 仍须在 provider call 和 cost
  reservation 前逐次 blocking `run / adjust / cancel`。
- 若第一次实际调用恰为高风险，完整 blocking disclosure 只在 affirmative Run 后、
  调用即将发生时同时完成 shared first-use，不追加第二条 notice；后续高风险仍逐次确认。
- provider trust 不授予 Memory admission、写入、Markdown 或 external action 权限。
- foreground Review 按过滤、去重后的实际允许来源数分类：`<=1` 为 standard bounded，
  `>1` 才逐次阻断；请求 `last7` 但实际允许来源只有 1 个仍属 standard bounded，确认前
  不预留 quota/cost。
- generic background preload 只有在显式 opt-in、changed-only、最近 7 天、实际输入
  `<=4K`、请求输出 `<=1K`、调用 `<=2/rolling-hour` 与 `<=20/local-day`、
  `allowWrite=false`、actual-source shared Data Boundary allow 且无 whole-vault、
  excluded override 时才属 standard bounded；任一越界都安静 skip，
  不弹 blocking UI。“broad/weekly scan high-risk”不包含这个窄 envelope。

DEC-021 最初将 SG-05/SG-06 记录为 stop gates 的文字属于 2026-07-19 审查来源与
决策过程证据；从 2026-07-21 起，执行以 DEC-023、B-118 Product Spec/SDD/Tracker
为准。DEC-023 独立拥有 provider first-use 与 Review/preload 风险分类语义，DEC-021
不重复扩展它。

## Consequences

- Product behavior: B-118 在恢复核心交互与首屏价值的同时，落实 Off/On Quiet
  Recall、View/Later/Dismiss、candidate-specific weak dismiss、Review Queue Later、
  中英文名称与 Discover Panel resolution；不借“polish”扩展这些语义。
- Architecture / data / safety: touch ownership、background working lifecycle、
  reduced-motion 和布局可在现有合同内修复；Dismiss 只有在 RHP 已启用时才能成为
  当前 candidate 的弱信号，provider trust 由 DEC-023 控制，Quiet Recall cold semantic
  retrieval 与 10/50 total budget 由 DEC-024 控制。
- Compatibility / migration: 已通过的移动布局和显式关闭偏好必须保留；旧
  `bubbleNudgesEnabled=true` 迁移为 On，false、缺失或其他状态迁移为 Off，且不得
  联动 generic hints、Recap 或 RHP。
- Work created or removed: 创建 B-118 Product Spec、Active Package 与 Claude Code
  handoff；用户已授权 B-118 runtime 修复与验证，commit、push、tag 与 release 仍按
  各自授权边界执行。

## Revisit Trigger

- 真机回归显示菜单隔离需要重构 Pet 根事件模型，而非局部修复。
- Recap 首屏无法在不重复调用 provider 的情况下读取 fresh artifact。
- dogfood 证明 Off/On 配合既定 quality/quiet/focus/per-candidate gates 仍无法控制
  噪声，或现有 Review Queue 承接 Later 明显增加管理负担。
- active-leaf 定位在 Obsidian 多窗格/侧栏组合中产生新的遮挡。

## Traceability

- Product Spec: [Pagelet UI/UX Hardening Product Spec](../specs/pagelet-ui-ux-hardening-product-spec.md)
- Active Package: [B-118 Feature Home](../../development/active/pagelet-ui-ux-optimization/README.md)
- Implementation handoff: [Claude Code handoff](../../development/active/pagelet-ui-ux-optimization/handoff-claude-code.md)
- Preceding decisions: [DEC-017](./dec-017-default-background-recap-preparation.md), [DEC-018](./dec-018-quality-gated-scope-recap-hints.md), [DEC-020](./dec-020-independent-quiet-recall-evaluation.md)
- Scoped provider resolution: [DEC-023](./dec-023-shared-pagelet-provider-first-use.md)
- Scoped semantic resolution: [DEC-024](./dec-024-quiet-recall-cold-semantic-retrieval.md)
- Existing contracts: [Scope Recap](../specs/pa-scope-recap-theme-summary-product-spec.md), [Quiet Recall](../specs/pa-quiet-recall-insight-timing-product-spec.md), [Bubble](../specs/pagelet-bubble-readiness-and-recall-product-spec.md)
- Trust contracts: [Data Boundary](../specs/pa-data-boundary-product-spec.md), [Retrieval Habit Profile](../specs/pa-retrieval-habit-profile-product-spec.md), [Saved Insight](../specs/pa-saved-insight-ledger-product-spec.md)
