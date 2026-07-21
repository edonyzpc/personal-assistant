# DEC-018 — Scope Recap 仅在高价值时主动轻提示

Decision ID: DEC-018
Status: Accepted
Updated: 2026-07-21
Authority: 用户于 2026-07-18 在 Pagelet v2.9 正式验证后的逐项产品讨论中选择方案 C
Work item: B-108

## Context

[DEC-017](./dec-017-default-background-recap-preparation.md) 已确认 Scope Recap
在 provider 已配置、能力未关闭且来源合规时默认进行有界后台准备；首次实际
provider 调用遵循 [DEC-023](./dec-023-shared-pagelet-provider-first-use.md) 的共享非
阻断通知，让用户点击时不必等待。仍需
决定：fresh prepared Recap 就绪后，Pagelet 是每次主动提示、始终保持安静，还是
只在内容真正值得打断注意力时提示。

始终提示会提高可发现性，但会把“自然浮现”变成通知噪声；始终静默则可能让已经
付出 provider 成本的高价值内容长期不可见。用户选择让产品价值与安静约束同时
成为门槛。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 每个 prepared Recap 都提示 | 可发现性最高 | 泛化摘要、重复结果和低价值内容也会争夺注意力 | Rejected；把“准备完成”错误等同于“值得打扰” |
| B. 永不主动提示 | 最安静 | 高价值 Recap 可能长期不可见，后台成本难以转化为用户价值 | Rejected；没有兑现主动回归的产品潜力 |
| C. 仅高质量新洞察轻提示 | 让真正有价值的内容自然浮现，同时把噪声留在后台 | 需要明确质量门、去重和抑制状态 | Accepted；符合“安静且可信”与 3 秒价值门 |

## Decision

选择 Option C：在 DEC-017 的有界后台准备满足运行条件后，**高价值 Scope Recap
轻提示默认开启**；首次 provider 调用的共享通知不是提示开关的前置授权。只有
新的、fresh、当前 scope 相关、可验证且具体的跨笔记
洞察通过质量门时，Pet 才进入一次 `nudge` 状态。

质量门必须同时满足：

- Recap 至少包含一条实际结构化洞察，而不是 scope summary、来源数量、tag 计数
  或“已准备好回顾”的占位文案。
- 被提示的洞察至少引用两篇不同的 source notes；单笔记摘要仍可在用户点击时
  查看，但不足以主动提示。
- 洞察说明具体的 tension、变化、开放问题或其他“为什么值得现在看”的关系，
  不能只有主题复述。
- Recap 与 active scope 一致，`staleStatus=fresh`，且没有被 Data Boundary、低
  覆盖、provider failure 或内容质量拒绝。
- 同一 artifact/insight fingerprint 尚未展示、dismiss 或处于 Later 窗口；quiet
  hours、Focus Mode 与全局冷却均允许提示。

交付边界：

- Pet 只使用轻量状态变化和提示点；不自动打开 Bubble，不弹 modal，不播放声音，
  不抢焦点，不显示待处理数量，并尊重 reduced motion。
- 每个 artifact/insight fingerprint 最多主动提示一次。重复后台周期不能重新制造
  提示；Later 只暂停当前结果，Dismiss 抑制同一结果。
- fingerprint 必须对同一实质洞察保持稳定：至少基于规范化 scope、洞察内容和
  source identity，排除 `generatedAt`、`preparedAt` 或每轮 cache ID；具体规范化
  算法与 Later 时长由 B-108 SDD 固化。
- 点击 Pet 后立即显示最强的一条具体 Recap observation，并可进入 Panel/Tab 查看
  完整洞察与来源；不能只显示“PA prepared a recap”。
- 用户可以关闭“高价值回顾提醒”，同时保留 DEC-017 的后台准备与点击即得。
- 本决定只改变 Scope Recap 的提示默认。Quiet Recall、Pattern 与 generic review
  的既有 `proactiveHints` 默认保持不变，不能因实现复用而被静默开启。

## Consequences

- Product behavior: Scope Recap 从“静默缓存或每次提醒”收敛为“价值达到门槛才
  自然浮现”。
- Architecture / data / safety: runtime 需要 Recap-specific quality gate、artifact
  fingerprint、view/dismiss/later 状态、quiet/focus/cooldown 检查，以及与 generic
  `proactiveHints` 分离的控制语义。
- Compatibility / migration: 当前单一 `proactiveHints` 设置不能直接代表新契约；
  迁移不得因此默认开启 Quiet Recall、Pattern 或 generic review 提示。
- Work created or removed: B-108 继续承接实现与 app smoke；本次决定不授权
  runtime 实现、commit、push 或 release。

## Revisit Trigger

- 高价值提示仍产生高 dismiss/关闭率或明显编辑干扰。
- 3 秒价值测试显示静默点击比主动提示带来更高信任与重复使用。
- 质量门长期几乎不触发，证明 Recap 内容或触发时机仍未达到产品价值。
- 新的跨 feature 提示策略可以在不扩大噪声的前提下安全统一控制。

## Traceability

- Preceding decision: [DEC-017](./dec-017-default-background-recap-preparation.md)
- Shared first-use boundary: [DEC-023](./dec-023-shared-pagelet-provider-first-use.md)
- Failure fallback decision: [DEC-019](./dec-019-honest-layered-recap-fallback.md)
- Product Spec: [PA Scope Recap And Theme Summary](../specs/pa-scope-recap-theme-summary-product-spec.md)
- Bubble contract: [Pagelet Bubble Readiness & Recall](../specs/pagelet-bubble-readiness-and-recall-product-spec.md)
- Product design: [Pagelet Product Design](../pagelet-product-design.md)
- Validation source: [Pagelet v2.9 validation handoff](../../archive/2026/pagelet-b108-dogfood-followup/handoff-pagelet-v29-validation.md)
- Archived package: [B-108](../../archive/2026/pagelet-b108-dogfood-followup/README.md)
- Deferred original dogfood scope: [B-116](../../backlog.md#已延期的产品与工程工作)
