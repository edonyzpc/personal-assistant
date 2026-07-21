# Insight Enhancement Layer Accepted Discovery Summary

Document status: Current
Discovery outcome: Accepted
Updated: 2026-07-21
Work item: B-119
Authority: B-119 的问题、repo 证据和被替代方案 provenance；当前产品行为以 DEC-022 与 Approved Product Spec 为准。
Decision: [DEC-022](../../../product/decisions/dec-022-bounded-insight-enhancement-layer.md)
Product spec: [PA Insight Enhancement Layer Product Spec](../../../product/specs/pa-insight-enhancement-layer-product-spec.md)

## Problem And User Outcome

PA 的 Pattern Detection、Graph Discovery 与 Maintenance Review 已能从标签、链接、
目录、关键词和规则中生成确定的结构结果，但很难解释内容层面的隐含关系、冲突含义
与维护理由。目标不是用 AI 替换这些结果，而是在用户已有来源上提供更具体的“为什么
相关”，同时保持结果可忽略、成本有界和写入可逆。

原始 Discovery 同时评估了 Writing Insight / Statistics 语义分析。最终决定认为它与
“让自己的笔记自然浮现”的直接联系较弱，并会新增周级触发、持久状态与独立 UI，
因此不进入 B-119；后续入口为 [Backlog B-120](../../../backlog.md)。

## Verified Evidence

| Evidence | Repo surface | Implication |
| --- | --- | --- |
| Pattern 只产生 `recurring_tag`、`repeated_question`、`orphan_cluster` 等结构类型 | `src/pa/pattern-detection.ts` | AI 新候选需要独立语义类型，不能伪装成原 taxonomy |
| Graph 只产生四种既有 item，并优先使用用户结构 | `src/pa/graph-discovery.ts`、当前 Graph Product Spec | AI 只能补充四种现有用户语义，结构 item 固定优先 |
| Maintenance 本地规则生成 proposal；可执行 runtime 仅支持 move apply/undo | `src/pa/maintenance-review.ts`、`src/pa/maintenance-review-apply.ts` | AI 文本必须与 executable proposal 分离；不能放宽 validator 或写权限 |
| plugin 在读取来源后调用三类结构函数，再把结果交给 orchestrator | `src/plugin.ts` 的 `runGraphDiscovery`、`runMaintenanceReview`、`maybeRunPatternDetectionNudge` | enhancer 的自然集成点在 plugin-private pipeline，不需要反向扩展 host |
| Pattern 当前标准本地 envelope 为最近 14 天、最多 80 篇、至少 5 篇，3 天冷却 | `src/plugin.ts` 的 Pattern constants 与 collection | AI 只从该本地 corpus 再缩到最多 12 个 provider excerpts；不扩大父级触发 |
| Graph 当前只收集 active note 同文件夹最多 40 篇 | `collectGraphDiscoveryNotes()` | 该范围可作为标准手动 envelope；whole-vault 属于另行披露 |
| Maintenance 默认从 active note、同文件夹或最近 7 天最多 50 篇中扫描 | `collectMaintenanceReviewFiles()` | 先本地 scan 再选最多 12 个摘录，不能把 50 篇全文一次发送 |
| `findRelatedNotes()` 可使用 VSS hybrid search | `src/pagelet/PageletHost.ts` | 可用于候选缩小，但 embedding/provider call 需要独立记账 |
| `PageletRateLimiter` 接受一个 options object | `src/pagelet/pa-review-rate-limit.ts` | 正确形式为 `new PageletRateLimiter({ storage, config, coordinationKey })` |
| Pagelet 已有共享 provider first-use state | `settings.pagelet.pageletProviderFirstUseNotified` | B-119 复用一次非阻塞通知，不新建 capability authorization |
| Graph、Pattern、Maintenance 已有 Panel/Tab state、renderer 和 Detail clone | `src/pagelet/panel/types.ts`、`tab/types.ts`、`TabView.ts`、`PageletDetailView.ts` | 新 AI 字段必须同时覆盖 domain、payload clone、render、locales 和 reopen tests |
| North Star 与 Data Boundary 已定义 trust-by-default 和 broad/sensitive/costly gate | 当前 Product contracts | 标准有界运行默认开启；更广/敏感/高成本逐次确认 |

## Options And Outcome

| Option | Outcome | Reason |
| --- | --- | --- |
| 四项 Graph + Pattern + Maintenance + Writing 同包 | Rejected | Writing 新增 surface/trigger，扩大范围且较弱对齐 North Star |
| 只做 Graph + Pattern | Rejected | 无法改善已确认的维护解释和目标建议质量 |
| Graph + Pattern + Maintenance，Writing 延期 | Accepted | 三项共享来源、provider、Pagelet 和低负担 review 边界，能形成可验证的同类包 |
| AI 替换结构检测或自动执行 | Rejected | 黑箱、成本和 vault mutation 风险不可接受 |

## Discussion Outcome

| Date | Authority | Conclusion |
| --- | --- | --- |
| 2026-07-20 | 用户 | Graph、Pattern、Maintenance 进入同一个实现包；Writing Insight 延期 |
| 2026-07-20 | 用户 | 标准有界 provider path 默认开启并复用共享首次非阻塞通知；broad/sensitive/costly 逐次确认 |
| 2026-07-20 | 用户 | Maintenance AI 保持 preview；现有 move 可继续明确 confirm/apply/undo，rename/link/create 不获授权 |
| 2026-07-20 | Agent source/contract audit | 修正 host 依赖方向、RateLimiter 构造、UI clone/render、ephemeral DTO、embedding 归因和 AI-on-AI evidence 风险 |

## Superseded Discovery Assumptions

- “四项全部批准”和 Writing phase 已被 DEC-022 替代。
- 不新增 `insightEnhancement.firstUseNotified`；复用 shared Pagelet notice。
- 不在 `PageletHost` 增加 `enhanceGraph/Pattern/Maintenance` 反向方法。
- 不给可执行 `MaintenanceProposal` 直接塞 AI 文本，也不绕过
  `hasForbiddenPersistedTextFields()`；使用 ephemeral overlay。
- `@internal` 只是 TypeScript/doc 标记，不是 runtime persistence boundary。
- feature coupling 不接力 AI claim，只共享去重/结构/source identity，再读原笔记取证。
- “一次 generation call”不代表 VSS/embedding 无成本；两类 actual calls 分别归因。

## Current Routing

- Decision: [DEC-022](../../../product/decisions/dec-022-bounded-insight-enhancement-layer.md)
- Product Spec: [B-119 Product Spec](../../../product/specs/pa-insight-enhancement-layer-product-spec.md)
- Delivery Plan: [Plan](./plan.md)
- Tracker: [Tracker](./tracker.md)
- Engineering handoff: [Codex Handoff](./handoff-codex.md)
- Historical external source: [SLA-11](https://linear.app/slateleaf/issue/SLA-11/规划-b-119-洞察增强层graph-pattern-maintenance)；仅作来源记录，不再同步
