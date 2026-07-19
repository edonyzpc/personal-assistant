# DEC-020 — Quiet Recall 对候选逐条独立 AI 评估

Decision ID: DEC-020
Status: Accepted
Updated: 2026-07-18
Authority: 用户于 2026-07-18 在 Pagelet v2.9 正式验证后的逐项产品讨论中选择方案 A
Work item: B-108

## Context

Quiet Recall 先用本地检索和评分找出少量候选，再由 AI 判断“为什么这篇旧笔记
现在值得出现”。需要决定的是：把所有候选放进一次 batch、先 batch 再逐条补强，
还是保持每个候选一次独立判断。

当前 runtime 最多生成 5 个候选，并逐条调用 provider；若 why-now 语言与来源笔记
不一致，该候选最多重试一次。因此一个 evaluation round 的显式最坏情况是 10 次
provider call。60 秒 cooldown 只限制 round 的启动频率，并不等于一次 round 只有一次
调用；当前 Recall 路径也没有专属的小时/日调用硬上限。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 逐候选独立评估 | 每个候选获得完整上下文和独立质量判断；一条失败或被拒绝不污染其他结果 | provider 调用数与首轮延迟最高 | Accepted；用户明确优先可用价值和候选隔离，而不是减少调用数 |
| B. 所有候选单次 batch | 调用数、成本和总延迟最低 | 一个畸形响应或失败会影响整批；候选间可能互相抢占输出质量 | Rejected；节省成本不足以抵消整批失败和质量耦合 |
| C. batch 初筛后逐条补强 | 在质量与成本之间折中 | 增加两阶段协议、解析和重试复杂度；初筛仍可能误杀有价值候选 | Rejected；不是本轮选择，可在真实成本触发器命中后复议 |

## Decision

选择 Option A：Quiet Recall 保持逐候选独立 AI 评估。这里的“独立”指每次初始
provider call 只判断一个候选；单个候选的失败、拒绝或语言重试不得让已完成的其他
候选失效，也不得把整轮视为失败。

正式边界：

- 候选生成与排序继续在本地完成。每个 eligible evaluation round 最多取排名最高的
  5 个候选进入 AI 质量判断。
- 每个候选只有在 AI 返回具体、可信、与当前上下文相关且有来源支撑的 why-now 后，
  才能成为主动 Recall Delivery。相似度或规则模板本身只表示“可发现”，不表示
  “现在值得提醒”。
- 每个候选最多进行 1 次初始调用；仅在 why-now 语言不匹配时允许再重试 1 次。
  因此单轮硬上限为 5 次初始调用、5 次语言重试，合计最多 10 次实际 provider call。
- 小时/日限额必须按实际 provider call（含语言重试）计数，而不是按 round 计数。
  精确额度、退避、并发与 timeout 由 B-108 SDD 在不改变逐候选语义的前提下固化；
  预算不足时按本地排名顺序评估，未评估候选保持静默，不用模板 why-now 补位。
- 60 秒 cooldown 是 evaluation round 的最低间隔，不替代实际 call 计数、小时/日
  限额或成本归因。诊断必须能区分 round、candidate attempt 与语言 retry。
- provider 未配置/不可用、预算耗尽、cooldown 阻止本轮 AI 判断，或某候选调用失败、
  空结果、格式错误、质量拒绝时，该候选不得形成主动 nudge。已有本地匹配仍可作为
  用户显式进入 `Discover` 的线索，但不能冒充质量已验证的 Recall。
- 可以缓存或去重未变化的 context-candidate fingerprint，避免重复付费；缓存不得把
  旧 why-now 迁移到不同上下文，也不得把多个候选合并成 batch 判断。
- Recall 仍不自动写入 Markdown、Memory 或任务；保存、关联等耐久动作继续需要用户
  明确选择。

## Consequences

- Product behavior: 用户看到的主动 Recall 保持高质量、具体且来源可核验；预算或
  provider 不可用时宁可安静，也不显示模板关联。
- Architecture / data / safety: runtime 需要为每次 Recall provider call（含语言重试）
  接入有界 limiter/cost tracker，并将“本地候选存在”与“已通过 AI why-now 门”分开。
- Compatibility / migration: 当前逐候选主路径可以保留；cooldown 下回退规则候选并
  继续 nudge、以及 Recall 只有 60 秒 round cooldown 而没有小时/日 hard cap 的行为
  不符合完整目标。
- Work created or removed: B-108 承接 limiter、质量门、缓存/去重、focused tests 与
  Obsidian smoke；本决定不授权 runtime 实现、commit、push 或 release。

## Revisit Trigger

- 在真实 dogfood 中，逐候选评估持续命中共享小时上限，导致高价值 Recall 经常
  无法完成。
- 成本或延迟数据显示 batch/分层方案能明显降低负担，并在独立 eval 中保持相同的
  单候选通过率、失败隔离和 why-now 质量。
- provider 原生支持可验证的逐项 structured output 与 partial retry，使 batch 不再
  存在整批失败风险。

## Traceability

- Product Spec: [PA Quiet Recall And Insight Timing](../specs/pa-quiet-recall-insight-timing-product-spec.md)
- Bubble contract: [Pagelet Bubble Readiness & Recall](../specs/pagelet-bubble-readiness-and-recall-product-spec.md)
- Product analysis: [Pagelet v2.9 dogfooding analysis](../pagelet-v29-dogfooding-analysis.md)
- Validation source: [Pagelet v2.9 validation handoff](../../development/handoff-pagelet-v29-validation.md)
- Active package: [B-108](../../development/active/pagelet-b108-dogfood-followup/README.md)
- Deferred original dogfood scope: [B-116](../../backlog.md#已延期的产品与工程工作)
