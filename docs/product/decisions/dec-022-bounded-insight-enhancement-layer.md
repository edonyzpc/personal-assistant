# DEC-022 — 以有界、来源支持的 AI 层增强 Graph、Pattern 与 Maintenance

Decision ID: DEC-022
Status: Accepted
Updated: 2026-07-21
Authority: 用户于 2026-07-20 明确选择 Graph + Pattern + Maintenance，延期 Writing Insight，并确认默认启用与 Maintenance 写入边界
Work item: B-119
Provider boundary: [DEC-023](./dec-023-shared-pagelet-provider-first-use.md)

## Context

基于 commit `658c5282` 的 Discovery 和 handoff，当前 Graph Discovery、Pattern
Detection 与 Maintenance Review 已能从链接、标签、目录、关键词和规则中生成有来源
的结构结果，但对语义关系、冲突含义和维护理由的解释仍有限。VSS、Pagelet provider
调用、成本记录、Panel/Tab 渲染和现有 Maintenance move apply/undo 已提供可复用基础。

原方案把 Writing Insight 一并放入同一实现包，并建议新建独立授权状态、把 enhancer
方法扩展到 `PageletHost`、直接给可持久对象添加 AI 文本。复核后发现这些做法会扩大
UI、授权、持久化和派生结论耦合面，也会让与“让自己的笔记自然浮现”联系较弱的周级
写作分析拖大第一轮验证范围。

本决定同时受以下现行合同约束：

- [PA Product North Star](../pa-product-north-star.md) 要求默认结果可忽略、来源可查，
  provider 配置后有界能力默认工作，并以首次非阻塞通知保持透明。
- [PA Data Boundary](../specs/pa-data-boundary-product-spec.md) 要求排除范围在 provider
  调用前生效，广范围、敏感或高成本运行仍需逐次确认。
- [Lightweight Graph Discovery](../specs/pa-lightweight-graph-discovery-product-spec.md)
  要求用户结构优先、AI 边为弱建议、Graph 只作为局部解释层。
- 当前 Maintenance runtime 只有 move proposal 可以在明确确认后 apply，并支持 undo；
  rename、link、create 等更宽写入没有因此获得授权。

原始产品信号来自 [historical external source SLA-11](https://linear.app/slateleaf/issue/SLA-11/规划-b-119-洞察增强层graph-pattern-maintenance)；当前不再维护外部状态镜像。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. Graph + Pattern + Maintenance + Writing 同包 | 一次覆盖四类洞察 | 新增独立 Writing surface 与生命周期；第一轮难以区分“笔记返回”价值和泛化分析价值 | Rejected；范围和验证面过大 |
| B. 只做 Graph + Pattern | 最贴近跨笔记发现，最小实现面 | Maintenance 仍停留在较弱的标题、链接和目录理由 | Rejected；丢失已经明确需要的维护解释价值 |
| C. Graph + Pattern + Maintenance 同包，Writing 延期 | 覆盖发现、模式和维护三个相邻闭环；复用现有 surface 与动作边界 | 仍需严格控制 provider、派生结论、持久化与 UI clone/render | Accepted |
| D. 用 AI 替换结构检测或直接执行建议 | 表面上更智能、步骤更少 | 黑箱、成本和误写风险高；弱化已有来源与可逆边界 | Rejected；违反 North Star 与现行写入合同 |

## Decision

选择 Option C，并固化以下产品边界：

1. B-119 只交付 Graph Discovery、Pattern Detection 与 Maintenance Review 的 AI
   增强；Writing Insight 不属于本 Active Package，转入 [Backlog B-120](../../backlog.md)。
2. 三类增强都是“结构结果之后的可选叠加层”。结构检测必须先完成且独立可用；AI
   失败、超时、预算耗尽、provider 缺失或被用户关闭时，继续返回原结构结果。
3. 每个 AI 结论必须重新落到原始来源笔记。跨 feature 只允许共享去重 ID、结构类型和
   来源元数据；不得把一个 AI 结论当成另一个 AI 结论的事实来源。
4. 配置 provider 后，有界标准运行的增强默认开启，并复用 Pagelet 共享的首次非阻塞
   provider 通知；不再创建 feature-specific 首次授权。用户可在 Settings 分别关闭
   三项能力。广范围、敏感或高成本运行仍需 `run / adjust / cancel` 的逐次确认。
5. 自动 Pattern 与手动 Graph/Maintenance 使用分离的调用/成本预算。生成调用和可能
   触发的 embedding/VSS 调用必须分别归因，不能用“单次增强”掩盖实际 provider 次数。
6. Graph、Pattern 与 Maintenance 的默认输出只读、可忽略且不形成未来债务。只有
   用户明确 `Keep / Later` 时才能进入既有 Saved Insight / Review Queue 路径。
7. Maintenance AI 只提供预览和理由。AI folder 建议只有转换为现有、受校验的 move
   preview 后，才能由用户明确确认并使用现有 undo；AI title、link、rename、create 或
   其他更宽写入均不在 B-119 授权内。

## Consequences

- Product behavior: 用户在现有 Graph、Pattern、Maintenance surface 中看到更具体、
  有来源的语义解释；不新增 Writing section，也不把忽略变成待办。
- Architecture / data / safety: enhancer 保持 plugin-private，输入同时包含结构结果和
  已过滤的原始来源；瞬时 AI overlay 与可持久对象分离，复用共享 Data Boundary、
  provider notice、成本记录和现有 move apply/undo。
- Compatibility / migration: 三项能力默认开启但受父级 Pagelet/Pattern 触发条件约束；
  不迁移或重置现有 provider 通知、Review Queue、Graph edge 或 Maintenance action state。
- Work created or removed: 创建 Approved Product Spec 与 plan-only Active Package；
  Writing Insight 进入 B-120。本文不授权 runtime 修改、commit、push、tag 或 release。

## Revisit Trigger

- B-119 dogfood 证明独立的周级 Writing Insight 能提供现有 Recall/Recap 无法覆盖、且
  有来源和低负担的价值时，重新评审 B-120。
- 实际成本或延迟数据显示标准预算无法在价值与负担间取得平衡时，调整 SDD budget。
- 用户需要 rename、link、create、批量 move 或其他 vault mutation 时，必须另开
  Decision，并经过 Write Action Framework / Operations Agent 权限边界。
- AI overlay 需要跨会话持久化或开始影响后续检索排序时，必须先定义新的生命周期和
  清理合同。

## Traceability

- Discovery: [Accepted Discovery Summary](../../development/active/insight-enhancement-layer/discovery.md)；原路径迁移见 [Disposition Log](../../archive/disposition-log.md)
- Product Spec: [Insight Enhancement Layer Product Spec](../specs/pa-insight-enhancement-layer-product-spec.md)
- Shared provider boundary: [DEC-023](./dec-023-shared-pagelet-provider-first-use.md)
- Active Package: [B-119 Feature Home](../../development/active/insight-enhancement-layer/README.md)
- Architecture / SDD: 实现获授权后在 Active Package 创建 `sdd.md`
- Backlog / successor decision: [B-120 Writing Insight](../../backlog.md)
- Historical external source: [SLA-11](https://linear.app/slateleaf/issue/SLA-11/规划-b-119-洞察增强层graph-pattern-maintenance)；仅作来源记录，不再同步
- Supersedes / superseded by: none
