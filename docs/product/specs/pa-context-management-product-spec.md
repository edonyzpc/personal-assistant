# PA Context Management Product Spec

Document status: Current
Updated: 2026-10-04
Work item: B-128
Decision: [DEC-032](../decisions/dec-032-context-reliability-and-conversation-continuity.md)
Authority: 已交付的 Context 可靠性、会话连续性及其与长期 Memory 的边界；B-128 构建绑定的验证记录保留为历史证据。

2026-10-04 Owner 的[可靠性后续授权](../../architecture/pa-agent-harness/pa-agent-harness-optimization-plan-2026-10-04.md#13-可靠性后续容量恢复与任务交付)将字符分区和辅助摘要总配额改为压力目标，并增加真实 provider overflow 的一次恢复。下列容量条款按当前行为修订；B-128 原始验收仍是历史证据，不代替本次检查。

## Problem And Product Outcome

用户应能持续讨论而不会因固定轮次丢失仍能容纳的历史；工具冗长内容应优先缩减；当前问题及现有权限不因压缩失真。重要的早期要求、后续修正及已讨论决定必须进入连续性评估，不能用预算成功替代用户体验证据。普通用户无需管理 context，符合“安静且可信”。

## Scope

### In Scope

- B-128/REQ-01: 原始历史满足完整请求容量估算时保留完整 escaped JSON；有压力时用来源有效摘要替换完整旧轮，最新完整轮和当前父稿保留，不固定十轮或静默丢弃历史。
- B-128/REQ-02: 按 assistant/model cycle 缩短旧的成功只读结果，最近两轮、Writing 准备和效果回执保持完整；没有有效摘要时保留原文或可逆表示，不伪造成功。
- B-128/REQ-03: 最终 provider 请求（包括 fallback 重建）统一测量正文、wrapper 与 schema；本地估算只触发压缩，不阻断完整合法请求。真实 provider context overflow 允许一次压缩后重试，不重放已执行效果。
- B-128/REQ-04: 第二次真实容量拒绝或配置没有可用输入窗口时准确解释，保留当前会话和原始证据，不显示通用网络故障、不自动创建会话。
- B-128/REQ-05: 聚合所有实际 provider 请求投影的 reduction outcome；在现有 Context UI 显示至多一个状态，budget limit 优先 compressed，零来源的纯历史压缩也能显示。
- B-128/REQ-06: 保存无正文的 historyCompressed/toolContextReduced/budgetLimited 布尔值，重载保持一致；检索来源、Memory 和 skipped scope 计数不被压缩回执改写。
- B-128/REQ-07: 验收连续投影、长对话、更改要求和已有讨论的延续。明确当前规则能保留的内容与已丢失内容；需要语义摘要时依据失败样例单独确定方案，不以扩大 Memory 功能替代。
- B-128/REQ-08: 不修改源 Chat、canonical transcript、来源和 Memory；当前指令/权限优先，旧授权不通过摘要成为新的执行权限。

### Non-goals

新增长期 Memory 行为、raw tool archive、恢复工具、执行 checkpoint、CAS、不可变目标/授权登记、token dashboard、自动新 Chat/handoff 不属于当前需求。新增 LLM 摘要调用不是排除项；Owner 已要求按连续性需求选型，成本随后优化。

### Semantic Continuity

- B-128/REQ-09: 历史原文超出本次容量时，优先检查完整可逆表示能否容纳；能容纳则保留全部历史并跳过摘要调用。仍超限时，先给结构化语义摘要预留空间，再放近期完整原文；摘要与原文覆盖区间互斥，优先保留用户要求、修正、决定、已完成事项、待办和未知。原始历史完整可重建。
- B-128/REQ-10: 旧工具或巨大工具结果被缩减时，摘要承接关键发现和失败原因，并保留工具、调用、错误、来源的真实标记。Memory currentness 改变后，旧摘要不能继续作为当前工具证据。
- B-128/REQ-11: 摘要复用当前 Chat 模型，无工具权限；完整输入预算、输出边界、分段、超时和取消有界。切换/删改/关闭/模型配置改变使缓存失效；重载从原始会话重建。无新持久化摘要或 Memory 写入。
- B-128/REQ-12: 用同一模型对照完整原文、确定性裁剪、摘要加近期原文的实际续答，并验证至少三次连续摘要更新；不能以 JSON/source-index 校验代替语义评测。

## User Flow And States

正常发送：当前问题 + 会话状态 + 按既有规则选择的 Memory/工具内容 → 完整投影与压力估算 → 必要时压缩 → 回答。未缩减时 UI 安静；缩减时 Context 区域提供单一简短说明；真实服务商容量拒绝先尝试一次恢复，再准确解释仍无法容纳的限制。桌面/移动采用同一既有 Chat surface。

## Trust, Data And Authority

源记录是事实依据，临时摘录只服务当前请求。已配置 provider、Memory 准入和 Operations 权限保持原边界。新增回执仅有布尔值，不保存 prompt/工具正文/摘要，删除沿现有 conversation 生命周期。规则摘录和语义摘要都不能赋予工具/写入权限。

## Acceptance Criteria

- B-128/AC-01: 超过十轮但能容纳的历史原文完整；压力下完整近期轮次优先于旧摘录，escaping 和 wrapper 完整。
- B-128/AC-02: 完整请求有压力时，至少三个 assistant/tool cycles 可压缩旧成功只读结果；摘要不成功仍保留完整输入，原始对象和效果事实不变。
- B-128/AC-03: fully formatted system/human、schema JSON-size estimate、安全余量各计一次；未知模型 fallback 和分区超限不提前拒绝；真实 overflow 不先以相同输入走 invoke fallback。
- B-128/AC-04: 连续真实 overflow 最多恢复一次，成功响应后重置，长任务后续独立溢出仍可恢复；已有摘要也按被拒请求申请更小投影。已完成效果不重做；连续第二次拒绝、来源撤销及取消准确结束，不自动创建会话。
- B-128/AC-05: 多 model invocation 重复缩减使用 OR 布尔聚合；零来源历史压缩可显示；每条回答只显示一个 reduction 状态。
- B-128/AC-06: live/save/reload reduction 一致，旧行兼容，既有 source/Memory/scope 计数不变，新增持久化字段无正文。
- B-128/AC-07: 有界长对话样例验证重要早期要求、近期修正、已确认决定、重复投影与无源数据写入；输出失败/限制而非宣称无限语义保留。语义性能需模型评测，静态字段断言不能替代。
- B-128/AC-08: 最新输入和权限不变，不能恢复旧权限，Memory 存储/提取不被 context reduction 调用或改写。
- B-128/AC-09: 完整历史原文或可逆表示 fit 时无摘要调用；可逆表示按真实 wrapper 后长度准入、逐字符可还原，预算缩小时重新判断。仍超限时摘要有预算和完整前缀覆盖，近期原文与摘要不重复；源前缀改变时拒绝旧摘要，超长输入分段且保留可追溯下标。
- B-128/AC-10: 旧工具中部关键发现和失败原因经语义摘要保留；任何 Memory 内容/来源变更后旧摘要不能进入最终请求，包含 fallback 重验证。
- B-128/AC-11: 空/非法/超长模型输出、超时和取消不写缓存；同会话 append 可复用有效前缀，删除/换会话/模型变化/关闭拒绝晚到结果；源码未增加摘要持久化或 Memory 写入。
- B-128/AC-12: 完整原文参考/裁剪/摘要对照覆盖早期要求、最新决定、已完成和待办、未知不捏造、权限不继承；至少三次摘要更新的实际回答保留当前约定，记录模型/fixture/输出/限制。

## Open Decisions

无待决定的 B-128 实施事项。Owner 已澄清 LLM 调用由技术需求决定，不存在待批准的成本门槛；语义摘要具有有损边界，不承诺无限保留。

## Delivered Scope And Limits

B-128 于 2026-09-06 按 Owner 明确的关闭授权完成收口。已交付完整原文/可逆历史优先、结构化会话和工具摘要、最终请求准入、本地超限说明及可持久化的无正文 Context 回执；原始会话、当前权限和长期 Memory 所有权保持独立。

分支验收包含 218 suites / 5677 tests、lint/build/type-check、独立 review 与 Obsidian test-vault 验证。同一已配置模型的原 9 个合成场景通过源、摘要、实际入模与回答对照，连续三次摘要覆盖 28→48→68 条消息；默认预算回归保留零历史摘要调用。精确构建、失败候选和范围限制见 [验证证据](../../archive/2026/b-128-context-management-validation.md)。该证据不等同于后续 master 合并后的验证；集成结果以实际 Git 历史和该次验证为准，也不代表已发布。

两项非阻塞 P3 独立延后：请求纯 JSON 时，模型仍可能附加说明或代码围栏（[B-130](../../backlog.md#已延期的产品与工程工作)）；部分摘要存在跨字段同义重复（[B-131](../../backlog.md#已延期的产品与工程工作)）。两者均保留原始失败/输出依据，按具体消费或容量问题重启，不继续扩大模型矩阵、真实用户数据或 Memory 范围。

## Durable Traceability

- Architecture contracts: [PA Agent](../../architecture/pa-agent-architecture-plan.md#context-management), [Context Pager](./pa-context-pager-product-spec.md)
- Decision and historical rationale: [DEC-032](../decisions/dec-032-context-reliability-and-conversation-continuity.md), [Research provenance](../../archive/2026/b-128-context-management-research.md)

| Requirement / AC | Regression contract |
| --- | --- |
| B-128/REQ-01 / B-128/AC-01; B-128/REQ-02 / B-128/AC-02 | [Context projection](../../../__tests__/pa-agent-context.test.ts), [Runtime history](../../../__tests__/pa-agent-runtime-chat-history.test.ts) |
| B-128/REQ-03 / B-128/AC-03; B-128/REQ-04 / B-128/AC-04 | [Request admission](../../../__tests__/pa-agent-context-admission.test.ts), [Loop](../../../__tests__/pa-agent-loop.test.ts), [Fallback](../../../__tests__/pa-agent-stream-fallback.test.ts) |
| B-128/REQ-05 / B-128/AC-05; B-128/REQ-06 / B-128/AC-06 | [Context Pager](../../../__tests__/context-pager.test.ts), [Chat view](../../../__tests__/chat-view.test.ts), [History store](../../../__tests__/chat-history-store.test.ts), [History manager](../../../__tests__/chat-history-manager.test.ts) |
| B-128/REQ-07 / B-128/AC-07; B-128/REQ-08 / B-128/AC-08 | [Continuity and source preservation](../../../__tests__/pa-agent-context-continuity.test.ts), [Chat lifecycle](../../../__tests__/chat-service.test.ts) |
| B-128/REQ-09 / B-128/AC-09; B-128/REQ-10 / B-128/AC-10; B-128/REQ-11 / B-128/AC-11 | [Summarizer](../../../__tests__/pa-agent-context-summarizer.test.ts), [Summary projection](../../../__tests__/pa-agent-context-summary-projection.test.ts), [Chat lifecycle](../../../__tests__/chat-service.test.ts) |
| B-128/REQ-12 / B-128/AC-12 | [Actual model-input capture](../../../__tests__/context-continuity-smoke-runner-script.test.ts), [Build-bound semantic evidence](../../archive/2026/b-128-context-management-validation.md) |
