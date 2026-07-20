# DEC-021 — 按真实界面证据分阶段修复 Pagelet UI/UX 漂移

Decision ID: DEC-021
Status: Accepted
Updated: 2026-07-19
Authority: 用户于 2026-07-19 要求把当日 UI/UX 审查与桌面/iPhone 实测完整交接给 Claude Code，并用于后续优化开发
Work item: B-118

## Context

2026-07-19 针对当天 commits 的真实桌面和 iPhone 审查证明：自动化与既有 beta
验证通过，不等于当前可见交互仍满足产品合同。当前至少有两个核心失败：iPhone
长按菜单项的触摸会额外到达 Pet 根交互，prepared Recap 首屏没有直接交付实际
洞察。

同一轮审查还记录了 Scope Recap 授权弹窗关闭、Reduce Motion、Quiet Recall
动作/反馈/设置、首次 provider disclosure、异步状态收敛、低字号可读性和桌面
Bubble 定位等风险。另一方面，iPhone 竖屏、真实横屏 safe area、44×44 触控目标、
短点开关和长按菜单出现/自动收起已有正向证据，修复不能把这些通过项无差别重做。

部分审查建议超出了“修复已复现 UI 漂移”的授权范围，并与现行合同存在张力：
Quiet/Balanced 的精确展示频率与迁移未定；Recall Bubble 与 Quiet Recall 的动作表
并不一致；Retrieval Habit Profile 对反馈的学习必须先 opt in；Saved Insight 已允许
用户选择 `Later` 后形成 Review Queue item 或 lightweight saved draft；共享 Data
Boundary 采用 first-use 加 broad/sensitive/costly 再披露，以及 excluded scope 的
显式 per-run override，而不是每个 feature 自建授权体系。B-118 不能替用户补出这些
新的产品、隐私或数据保留决定。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 维持 B-108 已验证状态，只补更多自动化 | 改动最少 | 无法修复已在真机复现的核心触控与首屏价值失败 | Rejected；把历史测试误当成当前用户证据 |
| B. 趁机重做 Pagelet 视觉、动作和设置架构 | 可统一处理全部历史问题 | 范围过大，也会静默决定频率、授权、反馈和队列语义 | Rejected；不符合最小、可信修复原则 |
| C. 先修有证据的 P1/P2 漂移，再做有界视觉 polish；未决产品边界设置 stop gate | 恢复核心体验且不越权 | 需要按 slice 保留证据和阻断点 | Accepted；与“安静且可信”和用户交接意图一致 |

## Decision

选择 Option C，并以 B-118 作为新的 L3 Pagelet UI/UX hardening track：

1. 按 `P1 核心触控与首屏价值 -> P2 信任、motion、状态与可达性 -> P3 有界视觉
   polish` 分阶段修复；每个阶段独立测试、review、桌面 smoke 与真机回归。
2. iPhone 菜单动作不得额外触发 Pet 根 `onToggleBubble`。Capture、Review、Discover
   自己的 downstream callback 仍可按现行实现与合同打开或更新 Bubble、Panel 或
   Modal；“根切换为零”不能误写成“整个 Bubble 永远不变化”。
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
   - Data Boundary 继续使用 first-use 与 broad/sensitive/costly disclosure；excluded
     scope 只有显式 per-run override 后才能包含。B-118 不创建 feature-specific
     authorization。
   - Retrieval Habit Profile 继续默认关闭，只有显式启用或完成轻量 first-use notice
     才能收集反馈并影响排序。
   - Saved Insight 继续允许用户选择 `Later / Keep` 后创建 Review Queue item 或
     lightweight saved draft；B-118 不规定固定 snooze 时长，也不取消该语义。
7. 以下事项是实现 stop gate，不在 DEC-021 中替用户做决定。Claude Code 遇到相应
   slice 必须停下并请求产品决定；不依赖该决定的触控、Recap、motion、状态与布局
   工作可以继续：
   - `SG-01`：Quiet/Balanced 的精确 display/context caps、旧设置迁移、与 generic
     hints 父门的映射及文案承诺。
   - `SG-02`：Recall Bubble 的最终 primary/secondary action taxonomy，`View`、
     `Open source`、`Link/Save/Later` 的优先级与 Bubble/Detail/Panel 落点。
   - `SG-03`：Dismiss/Not relevant 的负反馈粒度、保留期、对已 opt-in RHP 的权重；
     不得预设 exact-source-only、90 天或零权重。
   - `SG-04`：Later 的具体 snooze、是否及何时进入 Review Queue / Saved Insight
     draft；不得预设 24 小时或 no-queue。
   - `SG-05`：共享 Data Boundary 授权在 Recall/Discover/Recap 间的复用条件、版本
     迁移、未来 proactive included/skipped scope、local clue 升级 AI why-now 的判据
     与 UI 形态；在决定前只执行现行 shared contract。
   - `SG-06`：Scope Recap Modal 的 `Run` 是仅本次运行，还是同时授权以后有界后台
     准备；X/Escape 等非显式关闭后何时可再次询问。被动关闭不构成 affirmative
     provider authorization，也不得直接触发 provider call，但持久提示状态与重询
     间隔必须先决定。
   - `SG-07`：Explicit Discover 的最终路由、Quiet Recall 用户名称、普通
     Intentionally Quiet Bubble 的首次 3 秒价值方案。
8. 不新增自动写入、队列模型、全局 UI 架构、provider 调用或 release 行为。任何
   durable write 继续遵循现有确认与写入边界。

## Consequences

- Product behavior: B-118 可以先恢复已被真实证据否定的核心交互和首屏价值，但
  不能借“polish”静默重定义频率、授权、反馈、队列或写入行为。
- Architecture / data / safety: touch ownership、background working lifecycle、
  reduced-motion 和布局可在现有合同内修复；需要新持久字段或学习语义的 slice 受
  stop gate 阻断。
- Compatibility / migration: 已通过的移动布局和显式关闭偏好必须保留；DEC-021
  不授权任何 Quiet Recall 设置迁移。
- Work created or removed: 创建 B-118 Product Spec、Active Package 与 Claude Code
  handoff；实现、commit、push、tag 与 release 仍按各自授权边界执行。

## Revisit Trigger

- 真机回归显示菜单隔离需要重构 Pet 根事件模型，而非局部修复。
- Recap 首屏无法在不重复调用 provider 的情况下读取 fresh artifact。
- 某个 stop gate 已获得用户决定，需要建立或更新对应 Decision/Product Spec。
- active-leaf 定位在 Obsidian 多窗格/侧栏组合中产生新的遮挡。

## Traceability

- Product Spec: [Pagelet UI/UX Hardening Product Spec](../specs/pagelet-ui-ux-hardening-product-spec.md)
- Active Package: [B-118 Feature Home](../../development/active/pagelet-ui-ux-optimization/README.md)
- Implementation handoff: [Claude Code handoff](../../development/active/pagelet-ui-ux-optimization/handoff-claude-code.md)
- Preceding decisions: [DEC-017](./dec-017-default-background-recap-preparation.md), [DEC-018](./dec-018-quality-gated-scope-recap-hints.md), [DEC-020](./dec-020-independent-quiet-recall-evaluation.md)
- Existing contracts: [Scope Recap](../specs/pa-scope-recap-theme-summary-product-spec.md), [Quiet Recall](../specs/pa-quiet-recall-insight-timing-product-spec.md), [Bubble](../specs/pagelet-bubble-readiness-and-recall-product-spec.md)
- Trust contracts: [Data Boundary](../specs/pa-data-boundary-product-spec.md), [Retrieval Habit Profile](../specs/pa-retrieval-habit-profile-product-spec.md), [Saved Insight](../specs/pa-saved-insight-ledger-product-spec.md)
