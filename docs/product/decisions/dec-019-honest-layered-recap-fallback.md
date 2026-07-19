# DEC-019 — Scope Recap 失败时采用分层诚实降级

Decision ID: DEC-019
Status: Accepted
Updated: 2026-07-18
Authority: 用户于 2026-07-18 在 Pagelet v2.9 正式验证后的逐项产品讨论中选择方案 C
Work item: B-108

## Context

[DEC-017](./dec-017-default-background-recap-preparation.md) 要求 Scope Recap
提前准备、点击即得；[DEC-018](./dec-018-quality-gated-scope-recap-hints.md)
要求只有高价值新洞察才主动轻提示。仍需确定 AI 暂时不可用、调用异常、返回空
结果或未通过质量门时，PA 应该用规则摘要填补、完全空白，还是提供不冒充洞察的
即时本地信息。

当前 runtime 会在 insight 为空或调用异常时生成 fresh 的来源数量摘要，并可能把它
转换为 Recap Delivery。这既不是真正洞察，也会覆盖“点击即得”的可信含义。另一
个极端是只显示失败，让用户在主动重新进入上下文时完全落空。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 用规则摘要继续交付 Recap | 始终看起来有内容 | 容易把 tag、数量或模板化概览伪装成洞察，重复当前“正确但无用”的问题 | Rejected；可用性不能以虚假价值换取 |
| B. 没有可靠洞察就只显示失败 | 语义最纯粹 | 用户主动点击时没有任何重新进入 scope 的帮助 | Rejected；过于脆弱，也浪费本地已知的真实范围信息 |
| C. 分层诚实降级 | 优先真实洞察；失败时仍即时提供可核验的本地范围方向，同时明确没有可靠洞察 | 需要把 insight artifact、attempt status 与 explanation fallback 分开 | Accepted；兼顾点击即得与安静可信 |

## Decision

选择 Option C：Scope Recap 的 AI 洞察与本地范围概览是两种不同产品状态。AI
失败时不得把本地概览包装成 Recap insight，但用户主动打开时也不必面对等待或
空白。

后台准备边界：

- provider 未配置/不可用、调用异常或超时、空/畸形输出、无可验证洞察、质量门
  拒绝，都记为一次 `no reliable insight` attempt。
- 这些 attempt 不得创建 fresh Recap Delivery、`ready` 状态或 Pet nudge，也不得
  用来源数量摘要覆盖 last valid artifact。
- last valid artifact 与 last attempt status 分开保存。只有 artifact 仍匹配当前
  scope/source snapshot、Data Boundary 且未过期时，才可继续作为真实 Recap
  立即展示；失败本身不使仍有效的 artifact 失效。
- 后台可在 DEC-017 的预算内退避重试，但保持安静，不制造反复错误提示。

用户主动打开边界：

- 先查找当前 scope 仍有效的 last valid source-backed artifact；存在时立即展示，
  不因最近一次后台 attempt 失败而降级成空状态。
- 若没有有效 artifact，立即显示 **Recap explanation state**，而不是隐式启动一次
  foreground 调用或显示 spinner。这个状态明确说明“这次没有生成可靠回顾”。
- explanation state 可以展示有实际定向价值的本地事实：当前 scope/时间范围、
  有界的最近变更或纳入来源标题与链接、跳过/边界状态。它不能生成主题、冲突、
  推断或行动建议，也不能用 tag、计数或模板化 summary 冒充 insight。
- 若本地范围本身也没有足够信息，就保持简短诚实，不用填充文案制造价值感。
- 提供清晰的 `重试` 与 `查看来源` 行动。只有用户点击 `重试` 后才进入显式
  foreground 调用和进度态；未配置 AI 时，主行动改为前往设置。
- 普通 UI 不暴露 provider、schema 或 error code 等内部术语；诊断面可以记录最后
  attempt 的时间、类别、scope 与成本。显式重试失败时保留已有内容，并给出非破坏
  性反馈。

## Consequences

- Product behavior: Scope Recap 的点击结果形成“有效旧洞察 → 本地范围方向 →
  诚实空状态”的降级梯度，不等待、不伪装。
- Architecture / data / safety: runtime 需要分离 last valid artifact、last attempt
  status 与 local scope overview；overview 继续受 Data Boundary 约束且不发起 AI
  调用、不写 Markdown。
- Compatibility / migration: 当前把空 insight 映射为 fresh summary delivery 的行为
  不符合本决定；迁移不能删除仍有效 artifact，也不能把 explanation candidate 放入
  proactive hint pool。
- Work created or removed: B-108 继续承接实现、focused tests 与 app smoke；本次
  决定不授权 runtime 实现、commit、push 或 release。

## Revisit Trigger

- 本地范围概览仍被用户理解为 AI 洞察或被证明没有任何重新进入上下文的价值。
- last valid artifact 的有效性判断造成过期内容误报为当前结论。
- 失败/空结果长期占比过高，说明 provider、prompt 或 scope 质量需要优先修复。
- 本地模型能够在不扩大数据/成本风险的情况下稳定产出同等 source-backed 洞察。

## Traceability

- Preceding decisions: [DEC-017](./dec-017-default-background-recap-preparation.md), [DEC-018](./dec-018-quality-gated-scope-recap-hints.md)
- Product Spec: [PA Scope Recap And Theme Summary](../specs/pa-scope-recap-theme-summary-product-spec.md)
- Bubble contract: [Pagelet Bubble Readiness & Recall](../specs/pagelet-bubble-readiness-and-recall-product-spec.md)
- Product design: [Pagelet Product Design](../pagelet-product-design.md)
- Validation source: [Pagelet v2.9 validation handoff](../../development/handoff-pagelet-v29-validation.md)
- Active package: [B-108](../../development/active/pagelet-b108-dogfood-followup/README.md)
- Deferred original dogfood scope: [B-116](../../backlog.md#已延期的产品与工程工作)
