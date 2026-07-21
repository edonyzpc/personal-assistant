# DEC-024 — Quiet Recall 冷语义检索计入既有实际调用预算

Decision ID: DEC-024
Status: Accepted
Updated: 2026-07-21
Authority: 用户于 2026-07-21 在 B-118 runtime 修复的逐项产品讨论中选择方案 A
Work item: B-118

## Context

Quiet Recall 的核心价值包括发现没有共同标签、链接或明显关键词，但语义上与当前
笔记相关的旧笔记。当前架构可以在本地 Memory/VSS index 中执行向量检索，但冷查询
仍需先向已配置 provider 生成 query embedding；只有完成这次调用后，runtime 才能
知道是否存在纯语义候选。

这与 B-118 原 `RR-05` 的笼统表述冲突：如果把“最终没有候选”一律定义为 provider
call 为 0，就无法在当前 API 下先发现纯语义候选。需要在保留 North Star 的语义发现
价值、维持真实成本边界与降低实现扩张之间作出明确选择。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 把冷 query embedding 定义为受控的真实 Quiet Recall provider call | 保留纯语义发现；复用现有 index、DEC-023 admission 与实际调用预算；不增加新架构 | 检索为空时仍会消耗一次现有额度与可能成本，必须拆清零调用承诺 | Accepted；用户明确选择保留纯语义候选，并接受已披露、受预算约束的一次冷检索调用 |
| B. 新增完全本地的 document-to-document vector API | 冷检索为空时可保持字面零 provider call | 需要新的 VSS 能力，并处理活动笔记未索引、过期向量、模型变化与 index 不可用；扩大 B-118 | Rejected；不是当前修复所需的最小可信边界 |
| C. 只使用 metadata 候选 | 可以维持无候选时零调用 | 无法发现只有语义相关的旧笔记，削弱“需要时自然浮现”的核心价值 | Rejected；metadata 不能冒充 semantic relevance |

## Decision

选择 Option A，并规定：

1. Quiet Recall 保留纯语义候选生成。Memory/VSS index ready 时，runtime 可以为当前
   eligible query 执行至多一次冷 query embedding，再在本地 index 中检索和混合排序。
2. 冷 query embedding 是一次真实 Pagelet provider call。调用前必须依次通过当前
   capability、provider、Data Boundary、eligible source/query、Memory index ready、
   cooldown、Quiet Recall 实际调用预算的非落账 capacity check 与 source/current-run
   revalidation；真实 invocation
   必须经过 [DEC-023](./dec-023-shared-pagelet-provider-first-use.md) 的共享 first-use
   admission。只有 admission 完成且 invocation immediately next 时才落账实际调用 slot；
   高风险 affirmative Run 前不得落账 call/cost。任何调用前 gate 失败都不显示 notice、
   不写 shared flag、不产生调用或成本。高风险 UI 前的 capacity check 只用于决定是否
   值得询问；affirmative Run 后必须重新做 final capacity/source revalidation。最终 check、
   shared flag/slot commit 与 invocation 必须由同一 serialized admission seam 协调；
   notice/flag 后不得再留下可失败或可等待的 no-call gate。
3. 这次 embedding attempt 计入 Quiet Recall 现有 `10 / rolling hour`、`50 / local day`
   总实际调用预算，不新增额度或独立 bucket。后续每候选初始 evaluator 与允许的一次
   language retry 继续计入同一 bucket；预算不足时按本地排名停止，不能超额补齐。
   DEC-020 的 evaluator 阶段仍最多 5 次初始调用加 5 次语言重试，但冷 embedding 已
   消耗一个现有小时/日 slot，因此不会形成额外的第 11 个可用小时额度。
4. 若冷语义检索返回零候选，本轮 downstream evaluator/generation call 为 0；已经发生
   的 embedding attempt 仍计数，若它也是 Pagelet 首次实际调用，则 DEC-023 shared
   first-use flag 保持已通知状态。网络失败、timeout 或 provider 拒绝同样按真实 attempt
   计数，不因没有候选而回滚额度或通知。
5. 若存在有效的精确 query embedding cache hit，可以直接执行本地检索，不产生新的 provider call；
   cache key 只由 exact query 与 embedding profile/provider/model identity 决定，hit 后
   仍必须在当前 index 重跑本地检索，并重新验证 source、Data Boundary 与 current run。
   query/profile 不匹配、failed/aborted/rejected attempt 不得复用；provider 结果或候选
   在当前 source/run revalidation 失败后必须丢弃，不得形成 Recall/nudge。
6. 以下路径仍严格为 0 provider call：没有 eligible source 或有效 query、Memory index
   未 ready、capability 关闭、provider 未配置/不可用、Data Boundary 拒绝、冷检索
   admission 前的 cooldown 或 budget 拒绝，以及任何首次 invocation 前的 source/
   current-run 失效。
7. index unavailable 时，metadata 关系只可在用户显式进入 Discover 后作为本地
   `Local related clue / 本地关联线索` fallback。它不得标记为 semantic relevance，
   不得获得 AI why-now/Recall styling，不得进入主动 Recall stack 或触发 `nudge`。
8. 本决定不扩大可发送来源、provider 信任、Memory admission、持久化、vault/Markdown
   写入或外部 action 权限；broad/sensitive/costly/whole-vault/out-of-envelope/excluded
   override 仍遵守现行逐次阻断合同。

## Consequences

- Product behavior: Quiet Recall 能继续发现真正的语义关联；用户可能在最终零候选时
  仍消耗一次已披露的冷检索调用，但不会再发生 evaluator/generation 调用。
- Architecture / data / safety: query embedding、candidate evaluator 与 language retry
  必须共用 Quiet Recall 实际调用 limiter，并在每个 provider seam 复用 DEC-023
  admission 与 source/current-run revalidation；metadata fallback 与 semantic result
  必须是不同类型和呈现路径。
- Compatibility / migration: 不新增设置、预算字段、first-use state 或 VSS 持久对象；
  既有 `pageletProviderFirstUseNotified`、capability opt-out、10/50 bucket 与 evaluator
  cache 继续使用。若实现 bounded in-memory exact query-embedding cache，它只是可重建
  优化，不形成新的持久数据或授权状态。
- Work created or removed: B-118 F-10/F-11 共用的 RR-05 拆分为调用前零调用、冷检索
  空结果、index-unavailable local fallback 与 evaluator-unavailable local clue；F-10 负责
  shared admission，F-11 负责 pure-semantic/source-race/cache 回归。本决定不授权
  commit、push、tag、publish 或 release。

## Revisit Trigger

- PA 获得经过验证的本地 query embedding 或 document-to-document vector API，能在
  不发送 query 的前提下维持同等 pure-semantic recall 质量。
- dogfood 证明冷检索空结果长期消耗大部分 10/50 额度，显著挤压高价值 evaluator。
- pure-semantic 候选的通过率或 why-now 质量不足以证明该调用的成本与隐私负担。

## Traceability

- North Star: [PA Product North Star](../pa-product-north-star.md)
- Related decisions: [DEC-020](./dec-020-independent-quiet-recall-evaluation.md)、[DEC-023](./dec-023-shared-pagelet-provider-first-use.md)
- Product Specs: [Quiet Recall](../specs/pa-quiet-recall-insight-timing-product-spec.md)、[Bubble](../specs/pagelet-bubble-readiness-and-recall-product-spec.md)、[B-118](../specs/pagelet-ui-ux-hardening-product-spec.md)、[Data Boundary](../specs/pa-data-boundary-product-spec.md)、[Eval Harness](../specs/pa-eval-harness-product-spec.md)
- Architecture / SDD: [Pagelet Product Design](../pagelet-product-design.md)、[B-118 SDD](../../development/active/pagelet-ui-ux-optimization/sdd.md)
- Active Package: [B-118 Feature Home](../../development/active/pagelet-ui-ux-optimization/README.md)、[Tracker](../../development/active/pagelet-ui-ux-optimization/tracker.md)
- Supersedes / superseded by: narrows B-118 `RR-05` only; none otherwise
