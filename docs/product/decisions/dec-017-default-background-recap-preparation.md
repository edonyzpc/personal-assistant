# DEC-017 — Scope Recap 默认进行有界后台准备

Decision ID: DEC-017
Status: Accepted
Updated: 2026-07-18
Authority: 用户于 2026-07-18 在 Pagelet v2.9 正式验证后的逐项产品讨论中选择方案 C
Work item: B-108

## Context

Scope Recap 的产品价值是帮助用户重新进入一组零散笔记，不必重新阅读全部
内容，就能看见跨笔记主题、冲突、开放问题与原始来源。Pagelet v2.9 正式验证
证明 provider 已能生成有来源的中文洞察，但当前呈现链路没有稳定交付这些内容，
后台准备与设置语义也不一致。

当前 runtime 有两条不同的内部路径：通用 Pagelet review preload 受
`preloadEnabled` 控制，而 prepared Scope Recap 使用独立 scheduler。后者会在
Pagelet 打开、当前笔记活动或 idle 时准备 Recap，却不读取通用 preload 开关。
本决定治理的是 **Scope Recap 的提前准备行为**，不等于把通用 review preload
默认打开，也不接受两套相互矛盾的用户设置。

如果只在用户点击后才开始生成，用户会在最需要重新进入上下文时等待；如果
完全取消后台准备，Scope Recap 的即时价值会被削弱。用户明确选择：当 Recap
本身有价值时，PA 应提前准备，使用户被适时告知或点击后立即获得真正有价值的
内容。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 保留后台准备但默认关闭 | 成本和数据发送由用户逐项开启 | 默认体验仍可能在点击后等待，价值到达过晚 | Rejected；不符合“有价值内容应即时出现”的用户预期 |
| B. 完全取消后台准备 | 最简单，后台无 provider 成本 | 每次主动查看都可能等待，无法形成零步骤或一步价值路径 | Rejected；牺牲 Scope Recap 的核心体验 |
| C. 默认进行有界后台准备 | 点击即得，也允许未来以低打扰方式主动返回价值 | 会在点击前读取笔记并产生 provider 成本，需要清晰披露、预算和关闭能力 | Accepted；即时价值优先，但必须受信任边界约束 |

## Decision

选择 Option C：在 Pagelet 与 AI provider 已配置，并且用户通过 Data Boundary 的
`run / adjust / cancel` 首次披露明确授权 provider-backed 后台笔记读取后，Scope
Recap 的有界后台准备默认开启。被动 Notice 或仅仅配置 provider 不构成授权。

生效边界：

- 只准备当前工作上下文、近期变化或其他高意图 scope；不得持续总结整个 vault、
  每个文件夹、每个标签或每次保存。
- 后台结果必须通过内容质量、来源覆盖、stale 状态与 Data Boundary 检查；没有
  真正洞察时不制造 Recap delivery。
- 结果保持为可清除的本地 derived artifact/cache，不自动写 Markdown，不触发
  vault 修改或其他 action。
- 用户点击 Scope Recap 或对应 Pagelet 入口时，已有 fresh artifact 必须直接呈现
  有来源的实际洞察，不能再次等待同一轮 provider 生成。
- 后台 provider 调用、发送范围、额度使用和最近准备状态必须透明、可诊断；用户
  可以关闭后台准备并清除 derived cache。
- Prepared Scope Recap 必须有可单独归因的调用与成本预算。实现可以复用通用
  background runtime，但不能把 Recap 调用无提示地混入 generic preload 配额；
  具体单轮/小时上限由 B-108 后续预算决定约束。
- “准备好后是否默认主动提示”已由
  [DEC-018](./dec-018-quality-gated-scope-recap-hints.md) 解决：只有新的、高质量、
  可验证 Recap 洞察默认轻提示，其余结果静默缓存。
- 通用 Pagelet review preload 是否默认开启不在本决定范围内。实现可以复用或
  合并内部 engine，但面向用户必须把 Scope Recap 提前准备呈现为一个一致、可
  关闭的产品行为，而不是暴露两个含义不同的 `preload` 开关。

## Consequences

- Product behavior: Scope Recap 从用户点击后才开始工作的工具，变成默认提前准备
  的“重返上下文”能力。
- Architecture / data / safety: runtime 需要统一设置语义、scope/change detection、
  provider budget、derived cache、失效规则和数据/成本披露；后台路径继续
  `allowWrite=false`。
- Compatibility / migration: 需要为既有通用 `preloadEnabled` 与独立 Recap
  scheduler 定义迁移；现有显式关闭偏好必须继续受到尊重，升级不能把用户已经
  关闭的相关后台能力静默改回开启。
- Work created or removed: B-108 继续承接产品呈现、调用预算和正式
  验证；本次决定不授权 runtime 实现、commit、push 或 release。

## Revisit Trigger

- Dogfood 显示多数 prepared Recap 没有形成可点击的真实价值。
- 后台 provider 成本、延迟、移动端资源占用或隐私事件超过可接受边界。
- 用户关闭率或重复 dismiss 证明默认开启造成的负担高于即时价值。
- provider 或本地模型能力允许以明显更低成本实现同等点击即得体验。

## Traceability

- Source signal: [Linear SLA-11](https://linear.app/slateleaf/issue/SLA-11/idea-%E9%87%8D%E6%96%B0%E8%AF%84%E5%AE%A1-insight-%E5%A6%82%E4%BD%95%E8%A7%A3%E5%86%B3-obsidian-%E4%BD%BF%E7%94%A8%E7%97%9B%E7%82%B9)
- Product Spec: [PA Scope Recap And Theme Summary](../specs/pa-scope-recap-theme-summary-product-spec.md)
- Follow-up decisions: [DEC-018](./dec-018-quality-gated-scope-recap-hints.md), [DEC-019](./dec-019-honest-layered-recap-fallback.md)
- Product design: [Pagelet Product Design](../pagelet-product-design.md)
- Validation source: [Pagelet v2.9 validation handoff](../../development/handoff-pagelet-v29-validation.md)
- Active package: [B-108](../../development/active/pagelet-b108-dogfood-followup/README.md)
- Deferred original dogfood scope: [B-115](../../backlog.md#已延期的产品与工程工作)
