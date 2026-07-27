# DEC-025 — Pagelet 采用消费感知的主动交付与空态 Action Ring

Decision ID: DEC-025
Status: Accepted
Updated: 2026-07-27
Authority: 用户于 2026-07-22 至 2026-07-27 对重复 Recall/Recap、Pet 空态与主动关闭提示后的安静状态逐项选择产品方案
Work item: B-121

## Context

Pagelet 已有“每个候选主动出现一次”和 Scope Recap 指纹抑制，但当前身份、
展示确认与持久化边界并不统一：一次运行、上下文或插件生命周期变化后，用户已经在
Bubble 或 Detail 看过的相同内容仍可能再次成为 Pet nudge。系统记住了“候选曾被
生成或本次会话曾被展示”，却没有稳定记住“用户已经看过这项交付”。

另一方面，当 Pagelet 状态正常但没有可交付内容时，短点 Pet 会反复打开同一条
Ready Empty Bubble 和 `Find related old notes`。这使 Pet 在没有新价值时变成一个
重复的单动作入口，而不是安静、自然的陪伴入口。

两个问题属于同一个注意力边界：有新的、未看过的价值时由 PA 交付；价值已消费或
空态已解释后，Pet 应退回用户主动控制。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 消费感知的主动去重；首次空态解释，之后短点 Action Ring | 直接消除重复打扰，同时保留新用户对安静状态的理解；Pet 在无内容时仍有价值 | 需要独立交付指纹、设备本地已看 ledger 与 Pet 点击状态解析 | Accepted；用户分别选择“首次解释后显示 Ring”“只抑制主动再推送”“设备本地”，并确认主动关闭提示后的安静状态也使用 Ring |
| B. 只使用 cooldown，并永久保留单动作空 Bubble | 实现最少 | 相同内容会在 cooldown 后重现，Pet 仍反复给出同一答案 | Rejected；不能解决用户指出的打扰 |
| C. 已看内容在所有入口隐藏，并跨设备同步 | 行为表面上最彻底 | 会让用户主动查找时失去旧内容，并引入同步冲突、隐式持久状态与更大数据生命周期 | Rejected；用户选择显式入口仍可见、已看状态仅当前设备生效 |

## Decision

选择 Option A，并规定：

1. Pagelet 为主动 Recall 与主动 Recap 分别建立 versioned
   `deliveryFingerprint`。`kind` 是指纹的一部分，Recall 与 Recap 不跨类型互相抑制。
   指纹由该类型规范化后的主要可见内容、来源集合及必要 scope identity 决定，排除
   run id、generatedAt、分数、候选临时 id、provider/model、评估缓存 key 与 action
   route 等不会让用户看到新内容的字段。
2. 只有携带单一 transient `deliveryReceipt` 的交付卡实际成为当前可见 Bubble 卡，
   或该 receipt 指向的 Detail 目标成功渲染时，才记为 `seen`。首卡与每次切卡分别提交
   自己的 receipt；Detail 不得因为 payload 包含多个候选而批量记 seen。创建候选、
   点亮 Pet、开始打开、隐藏 stack 卡或渲染失败都不算已看。可见即算已看，不增加
   停留时长或滚动完成门槛。
3. `seen` 只禁止同一 fingerprint 再次进入主动 Pet nudge 或主动 Bubble。Seen ledger
   不过滤或阻断用户主动运行 Discover/Review、打开可用的 Recap/Detail 或导航来源笔记；
   但它不新增历史内容仓库，也不保证 reload 后可恢复同一张生成卡。
4. 已看 ledger 只存当前设备、当前 Vault 的 schema/fingerprint version、kind、opaque
   fingerprint、seenAt 与 presentation surface，不存路径明文、正文、标题、摘要或
   why-now 文本，不承诺跨设备同步。v1 不设时间 TTL，最多保留 2,000 条并仅在容量上限
   按 oldest-seen 淘汰；本地数据被清除、损坏或条目被淘汰后，相同内容可能再次获得
   主动资格。内容、来源或 scope identity 发生实质变化会形成新 fingerprint；单纯
   重新评估、重启、切换笔记后返回或时间变化不会。
5. Ready Empty 或 Intentionally Quiet 的解释按语义和文案版本在当前设备展示一次。
   第一次短点 Pet 仍打开一条简短 Bubble；Bubble 实际可见后完成 acknowledgement。
6. 上述空态已 acknowledgement 后，短点 Pet 不再重放空 Bubble，改为打开
   `Capture / Review / Discover` Action Ring。有未看交付时短点仍打开 Bubble；
   Needs Setup、Preparing、Context Limited 等普通必要解释仍由 Bubble 承担。显式
   Recap 入口中已 eligible 的 `Recap Needs Retry` 仍优先于空态 Ring；后台失败本身
   保持安静，当前 Scope Recap command 在 Detail 渲染等价说明。520ms 长按在现有
   可交互状态下继续直接打开同一 Action Ring。
7. Action Ring 是 Pet 的瞬时命令面，不是新的内容层或任务队列。三个动作复用既有
   callback、provider/Data Boundary、写入与确认边界；本决定不授权新的自动运行或写入。

## Consequences

- Product behavior: Pagelet 从“候选出现过一次”升级为“用户看过后不再主动重复”；
  无新内容时，Pet 在解释一次后成为低负担的主动入口。
- Architecture / data / safety: 评估缓存身份、producer ticket 与交付身份必须分离；
  新 ledger 使用按设备 Vault identity 隔离的本地存储，只保存不含内容明文的 opaque hash。
- Compatibility / migration: 现有可同步 settings 中的 Recap suppression 不导入新
  seen ledger，也不解释为 device-local seen；升级后可能出现一次过渡性重现。新写入只
  使用设备本地 Vault storage。本地存储损坏或不可用时至少保留会话内去重并在
  diagnostics 暴露降级，不能写入 Markdown 补偿。
- Work created or removed: B-121 从 B-118 的延期空态观察项升级为独立产品范围；
  B-118 保持 Validated，不在原 tracker 内重开。用户随后已授权建立 B-121 Active
  Package 并完成实现与验证；仍未授权 commit、push、tag、publish 或 release。

## Revisit Trigger

- 用户证明同一来源的轻微改写仍形成可感知的重复打扰，需要不调用 AI 的近重复策略。
- 真实使用证明同一内容以 Recall 与 Recap 两种类型分别出现仍构成明显重复，需要单独
  决定是否允许跨 kind 抑制。
- 用户明确要求 Mac/iPhone 共享已看状态，并接受同步冲突、恢复与隐私生命周期设计。
- Action Ring 在真实桌面或 iPhone 上比一次性空态更难发现、误触更多或遮挡编辑区域。
- 设备本地 ledger 的容量或损坏率使旧内容频繁重新获得主动资格。

## Traceability

- Product Spec: [B-121 Pagelet Attention-Aware Delivery](../specs/pagelet-attention-aware-delivery-product-spec.md)
- Related current specs: [Bubble Readiness and Recall](../specs/pagelet-bubble-readiness-and-recall-product-spec.md)、[Quiet Recall](../specs/pa-quiet-recall-insight-timing-product-spec.md)、[Scope Recap](../specs/pa-scope-recap-theme-summary-product-spec.md)
- Architecture / SDD: [B-121 SDD](../../development/active/pagelet-attention-aware-delivery/sdd.md)
- Delivery track: [B-121 Active Package](../../development/active/pagelet-attention-aware-delivery/README.md)
- Supersedes / superseded by: supersedes B-118's deferred ordinary quiet-empty disposition and narrows the old session/producer-level once semantics; none otherwise
