# DEC-023 — Pagelet 标准有界 Provider 路径共享首次非阻断通知

Decision ID: DEC-023
Status: Accepted
Updated: 2026-07-21
Authority: 用户于 2026-07-21 选择方案 A，确认 SG-05/SG-06、B-119 1A、“首次实际调用恰为高风险时由完整阻断披露同时完成共享首次告知”、本记录定义的 foreground Review / generic background preload 风险分类，以及 generic preload 的显式 Data Boundary 敏感性判定是现行统一规则
Work item: B-118
Related work item: B-119

## Context

[DEC-017](./dec-017-default-background-recap-preparation.md) 在 2026-07-18 选择
Scope Recap 默认进行有界后台准备时，仍要求首次通过 `run / adjust / cancel` 明确授权，
并认定被动 Notice 不足。随后用户在 B-118 的 SG-05/SG-06 中决定：配置 AI provider
已经构成信任选择；标准有界 Pagelet provider 路径默认工作，首次只显示一次共享、非阻断
通知；更广、更敏感或高成本运行继续逐次确认。B-118 SDD/Tracker 与 B-119 Graph、
Pattern、Maintenance 规划采用后一个模型。2026-07-21 当日早期源码复核曾证明 B-118
runtime 尚未完整对齐：fresh install 仍被旧 authorization tuple 置为 preparation off，
shared notice 也尚未统一到每个 feature 的第一次实际 provider call；该缺口随后已按本
决定完成修复、review 与验证，当前交付状态以 B-118 Tracker 为准。

共享 first-use 还需要覆盖一个边界：第一次实际调用可能本身就是 broad、sensitive、
costly、whole-vault、out-of-envelope 或 excluded-scope override。此时高风险阻断披露
已经比普通非阻断通知更强；若两套披露不能合并，用户在同一次调用前会收到重复告知，
但若过早写入 shared flag，又可能把 Cancel、close 或未通过 gate 的 Adjust 误记为已告知。

由于后续决定只进入了 B-118 Tracker/SDD 和 B-119 文档，DEC-017、Scope Recap Product
Spec、B-118 Product Spec 与 Pagelet Product Design 仍保留旧授权条款，造成高优先级产品
合同与当前 runtime 互相冲突。

同一轮 completion review 又发现“broad Pagelet review / weekly scan”仍不足以指导
runtime：用户请求 `last7` 不代表实际会发送多份来源，而一个显式 opt-in、changed-only、
最近 7 天、4K 输入内、只读且严格限频的后台 preload，也不应因“weekly”字样被误判为
每次高风险阻断。风险必须依据过滤后的实际输入与执行 envelope，而不是请求标签；同时，
后台任务一旦越界不能弹出阻断 UI 打扰用户。

随后 implementation review 发现 runtime 以调用方直接声明
`sensitiveScope=false` 作为后台安全证明，但当前产品没有内容敏感度分类器。这无法诚实
证明实际来源不敏感，也没有说明未标记笔记应如何处理。为保持低维护与可执行性，敏感性
必须来自用户已经显式配置的共享 Data Boundary，而不是由调用方常量或后台 AI 猜测。

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

### Foreground Review 与 Generic Background Preload 风险分类

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 依据过滤后的实际来源与严格 preload envelope 分类 | `last7` 但实际仅 1 个允许来源仍低摩擦；窄后台准备不被“weekly”标签误伤；越界后台安静 fail closed | runtime 必须在 admission 前完成过滤、去重、计数与 envelope 检查 | Accepted |
| B. 只要请求 `last7` / weekly 或任何后台读取就视为高风险 | 规则表面简单 | 单来源 Review 反复弹窗；后台任务无法安全请求确认且破坏安静体验 | Rejected |

### Generic Background Preload 的敏感性判定

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 由共享 Data Boundary 的用户显式规则判定 | 复用 excluded folders/tags 与 generated-source policy；不引入黑盒内容猜测或额外标记负担；runtime 可按实际来源逐一证明 | 未被用户标记的敏感内容按普通允许来源处理 | Accepted |
| B. 只有逐篇显式标记为低敏感的笔记才可后台准备 | 最保守 | 标记负担高，generic preload 对多数用户近似不可用 | Rejected |
| C. 在建立正式敏感度分类器前禁用 generic preload | 不会后台发送潜在敏感正文 | 取消已选择的低摩擦后台价值，且内容分类器本身会引入新的黑盒风险 | Rejected |

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
9. Foreground Review 在 Data Boundary 过滤、排除与去重后，按本次即将发送的**实际允许
   来源数**分类：`<=1` 为 standard bounded；`>1` 为高风险，必须逐次显示
   `Run / Adjust / Cancel`。请求标签不替代实际计数；例如请求 `last7` 但最终只有 1 个
   实际允许来源，仍为 standard bounded。高风险确认前不得预留调用 quota 或成本；
   `Adjust` 后必须用新的实际允许来源集合重新分类。
10. Generic background preload 只有同时满足以下全部条件时才是 standard bounded：用户已
    显式 opt in；只处理 changed-only；来源限定最近 7 天；本次实际 provider 输入不超过
    既有 4K 上限且请求输出不超过既有 1K 上限；本任务实际 provider 调用不超过
    2 次/滚动小时、20 次/本地日；
    `allowWrite=false`；实际来源逐一通过共享 Data Boundary，且没有命中用户显式配置的
    excluded folder/tag、generated-source exclusion 或其他需要 override 的边界；不包含
    whole-vault 或 excluded-scope override。这里不运行关键词/AI 内容敏感度分类，也不接受
    调用方直接声明 `sensitiveScope=false` 作为证明；未命中显式边界的笔记按普通允许来源
    处理。2/hour 与 20/local-day 是跨 plugin reload、Pagelet off/on 仍成立的硬上限；仅可
    按 vault 持久化不含内容的调用时间戳，存储不可用或损坏时本轮 fail closed。任一条件
    不满足时，本次后台任务必须安静 skip / fail closed，不弹 blocking confirmation UI，
    不进行 provider call、quota/cost reservation 或 shared first-use flag mutation。
    changed-only 依据另一个 per-vault、per-path、仅含 path/mtime 的持久 watermark；
    reload 或 Pagelet off/on 不重置。只有真实 provider call 已发生、结果被接纳且 captured
    source snapshot 仍 current 的文件才推进 watermark；no-call/fail-closed 结果不标记
    analyzed，也不覆盖最近有效 cache。watermark 存储不可用或损坏时 fail closed；fresh
    opt-in 时存储 key 不存在是合法空基线。
    每个实际来源还必须在 provider seam 按本次刚读取的 Markdown 正文重新检查显式 body
    tag、frontmatter 与 path policy；MetadataCache 滞后不能让新加入的排除标记 fail open，
    leading frontmatter 无法可靠解析时跳过该来源。provider 输出的 finding 只有在
    `sourceFile` 精确匹配本次实际允许输入路径时才可接纳；缺失、未知或幻觉引用直接丢弃。
    Related-note enrichment 不得把本轮 changed batch 之外的来源加入后台 prompt；当前
    generic preload 因而不另做全索引 semantic enrichment。
11. 本合同中“broad / weekly scan 属于高风险”不包含第 10 条完整 envelope 内的窄
    changed-only preload。其他 foreground broad/weekly Review 仍按第 9 条实际来源数分类；
    其他后台 preload 越界按第 10 条安静跳过，不能升级为打断用户的交互式高风险运行。

## Consequences

- Product behavior: 标准有界 Pagelet 能力在 provider 配置后低摩擦工作，首次透明告知；
  首次恰为高风险时由完整阻断披露一次完成共享告知；用户仍可分别关闭能力，广范围或
  高风险 foreground 运行仍需逐次决定；严格有界的后台 preload 安静工作，越界则安静
  跳过。
- Architecture / data / safety: 共享 first-use state 只表达通知已展示，不授予写权限；所有
  来源过滤、实际来源计数、scope override、预算和 durable action gate 保持独立；generic
  preload 的非敏感证明必须由本次实际来源的共享 Data Boundary decision 推导，不能由
  调用方布尔常量自证；latest-body boundary check、持久 changed-only watermark 与 exact
  actual-input source grounding 防止 MetadataCache 滞后、reload 重发或模型引用幻觉扩大
  provider/cache 边界；
  foreground 高风险确认前零 quota/cost reservation，background 越界零调用、零提示。
- Compatibility / migration: 保留现有 opt-out、shared notification 与 Scope Recap state；
  不重置已通知用户，也不要求为本决定新增授权迁移。
- Work created or removed: 同步 DEC-017、Data Boundary、Scope Recap、B-118/B-119 与
  Pagelet 当前合同，并曾把 B-118 runtime reconciliation 退回 Implementing；用户随后
  明确授权修复与验证；DEC-023 scoped reconciliation 已验证，B-118 整体交付状态始终以
  Tracker 的当前记录为准。本决定本身不授权新的
  commit、push、tag 或 release。

## Revisit Trigger

- 真实隐私事件或 dogfood 证明标准有界后台读取仍需要 capability-specific 阻断确认。
- 用户无法理解首次通知、找不到关闭入口，或 opt-out 在升级后失效。
- 新 capability 无法定义清晰的标准 envelope，或需要默认读取 whole-vault/敏感来源。
- 真实数据证明单一实际来源仍具有不可接受的披露风险，或 4K / 2-hour / 20-day preload
  envelope 无法控制成本与打扰。
- provider first-use state 开始被错误复用为 write、Memory admission 或外部 action 权限。

## Traceability

- North Star: [PA Product North Star](../pa-product-north-star.md)
- Amended decision: [DEC-017](./dec-017-default-background-recap-preparation.md)
- Source decision package: [B-118 Tracker SG-05/SG-06](../../development/active/pagelet-ui-ux-optimization/tracker.md)
- Current specs: [PA Data Boundary](../specs/pa-data-boundary-product-spec.md)、[Scope Recap](../specs/pa-scope-recap-theme-summary-product-spec.md)、[B-118 Product Spec](../specs/pagelet-ui-ux-hardening-product-spec.md)
- B-119 adoption: [DEC-022](./dec-022-bounded-insight-enhancement-layer.md)、[B-119 Product Spec](../specs/pa-insight-enhancement-layer-product-spec.md)
- Quiet Recall retrieval scope: [DEC-024](./dec-024-quiet-recall-cold-semantic-retrieval.md)
- Historical external source: [SLA-11](https://linear.app/slateleaf/issue/SLA-11/规划-b-119-洞察增强层graph-pattern-maintenance)；仅作来源记录，不再同步
- Supersedes / superseded by: supersedes only DEC-017's original first-use blocking clause; none otherwise
