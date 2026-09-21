# DEC-040 — 以任务完成为目标的可恢复 Agent 执行

Decision ID: DEC-040
Status: Accepted
Updated: 2026-09-22
Authority: Owner 在 2026-09-21 逐项确认 D1–D8，随后授权按 B-144 方案完成开发、验证与 closeout；本决定记录稳定产品边界，不作为发布凭据。
Work item: B-144

## Context

[空回答事故与修复证据](../../development/validation/pa-agent-empty-answer-diagnosis-2026-09-21.md)确认：来源准入失败被 SDK 重试、idle 覆盖请求准备、工具失败过早收尾、正文交付与完成状态不一致。已交付修复制止已知故障，但未改变通用 loop 与领域策略的职责分配。另一设备的 `<tool_calls>` 截图没有原始 provider payload，不能由此断言其唯一根因。

Owner 要求从架构层面支持长任务、自主纠错，并降低 writing 对普通 Chat 的影响。方向遵守 [North Star](../pa-product-north-star.md)：用户自然提问，宿主保证来源、权限、真实结果及持久动作边界。

## Options Considered

| Option | Benefits | Costs / risks | Disposition |
| --- | --- | --- | --- |
| 仅增大超时、逐项增加特殊重试 | 改动局部 | 去重、强制收尾、来源与写作终止仍可能阻止恢复 | 不作为目标方案 |
| 主 Agent 自主恢复，宿主守执行边界，领域模块交付产物 | 任务可继续，职责清晰，可复用当前能力 | 需重构跨层终态、来源版本和调度 | Owner 确认 |
| 无期限、无授权或无执行结果保护 | 表面自由 | 失联、重复副作用、越权和无进展循环 | 不采用 |
| 后台使用更小执行预算 | 资源占用较少 | 正常后台任务可能被提前终止 | Owner 明确否决；后台同样以完成任务为主 |
| 单次模型/同步远程操作默认 10 分钟 | 容忍分钟级操作 | 不符合 Owner 选择 | Owner 明确改为 30 分钟 |
| 跨重载自动续跑所有任务 | 长任务可自动延续 | 持久检查点、未知副作用与重放责任扩大 | 本次不包含；选择运行期间恢复、重载后用户继续 |

## Decision

- **D1 材料版本**：普通 Chat 默认基于本轮已读取、获准使用的版本回答。普通笔记修改或 Memory 后台更新不自动重读、中断或撤回正文。明确要求最新内容、准备写入或授权变化时核对对应条件；内容新鲜度与授权撤销分开。
- **D2 自主纠错**：主 Agent 在既有授权和来源范围内修正参数、重读、换工具及调整策略。普通失败成为观察，不直接关闭工具或强制收尾。需要新增授权、关键用户判断或持续无法推进时请求介入；副作用结果未知先核实。
- **D3 任务预算**：取消前台、后台 Agent 统一短时长强制收尾。正常任务以完成为主；保留有依据的资源边界、无进展保护及取消。后台身份本身不构成更小预算的理由；任务范围有限，不因持续新事件无限扩展。
- **D4 操作期限**：模型调用和普通同步远程工具单次尝试默认 **30 分钟（1,800,000 ms）**，具体能力可覆盖。期限覆盖实际开始至完整结束；排队另计；SDK/网络/外层期限一致。达到期限进入恢复流程，不直接宣布整个任务失败。短本地操作与明确异步任务采用对应生命周期。
- **D5 Writing 分离**：同一主 Agent 按意图使用完整写作能力。普通回答直接交付；选中文字或长回答不隐式进入写作生命周期。版本、预览、保存归写作领域；可修正的产物验证失败返回主 Agent。
- **D6 真实结果**：成功恢复的问题只保留过程/debug 记录，不成为最终警告。仍有影响则具体说明；必需目标未完成标记部分完成或未完成；等待确认不等于动作成功。交付确认后再发布统一终态。
- **D7 受控并发**：至少允许一个前台 Chat 与一个后台 Agent 同时推进，各自保留机会；按真实 provider 能力限制物理并发。仅冲突资源和写操作串行协调。等待/退避不占用不必要的名额，不取消已经发出的后台请求来让路。
- **D8 恢复范围**：保证同一次插件运行期间恢复。重载/重启后的未完成任务如实表示中断，由用户选择继续；利用已有安全历史、产物和操作记录，不直接重放。已提交写入、付费或远程异步操作先核实结果；不建设通用跨重载自动任务引擎。

### 与现行契约的关系

本决定窄范围修订 DEC-034、DEC-037 及现行 runtime 契约中的普通 Chat 新鲜度、恢复、时限、调度、writing 耦合和结果表达。B-144 已实现这些边界；当前 Architecture、源码与回归测试描述并保护现行行为。

不撤销逐次物理 dispatch 的授权检查、来源范围、Forget/排除、上下文压缩来源链、写入确认与冲突处理、Undo、图片付费操作的 acceptance-unknown 保护。Pagelet frozen anchor、质量门、只读范围与 quiet no-insight 仍有效。独立 Memory 提取/索引维护的触发与成本授权不因本决定扩大；VSS 写队列保持独占。

## Consequences

- Product behavior: 长任务与可恢复失败自然继续；用户看到的是实际交付与剩余影响。
- Architecture / data / safety: 分离材料版本与动态授权；恢复、去重、领域交付及调度分别负责自己的事实。
- Compatibility / migration: 保留 native 写作协议、旧作品/history reader、现有操作记录；不自动重放旧 run。
- Work created or removed: B-144 已替换强制收尾和特殊恢复分支并完成 closeout；不重开 B-135/B-140 已关闭交付。

## Revisit Trigger

- 实际 provider/工具无法满足长操作、取消或状态核实，需改变用户可见承诺。
- 同次运行恢复不足，Owner 明确要求跨重载、跨设备自动续跑。
- 可观察成本或无进展证据要求新的默认资源策略；不能仅因后台身份收紧预算。

## Traceability

- Product Spec: [B-144](../specs/pa-recoverable-agent-execution-product-spec.md)
- Architecture: [PA Agent current architecture](../../architecture/pa-agent-architecture-plan.md), [Runtime lifecycle](../../architecture/pa-agent-runtime-lifecycle-plan.md)
- Related decisions: [DEC-034](./dec-034-unified-agent-task-execution.md), [DEC-037](./dec-037-pa-agent-essential-capabilities.md), [DEC-038](./dec-038-chat-image-generation.md)
- Supersedes: 上述决策的明确局部边界；不整体替代或归档这些决策。
