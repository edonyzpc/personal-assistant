# PA Context Management Product Spec

Document status: Approved
Updated: 2026-09-05
Work item: B-128
Decision: [DEC-032](../decisions/dec-032-context-reliability-and-conversation-continuity.md)
Authority: Context 可靠性、会话连续性及其与长期 Memory 的边界；执行证据仅见 Tracker。

## Problem And Product Outcome

用户应能持续讨论而不会因固定轮次丢失仍能容纳的历史；工具冗长内容应优先缩减；当前问题及现有权限不因压缩失真。重要的早期要求、后续修正及已讨论决定必须进入连续性评估，不能用预算成功替代用户体验证据。普通用户无需管理 context，符合“安静且可信”。

## Scope

### In Scope

- B-128/REQ-01: 原始历史满足预算时保留完整 escaped JSON；有压力时保留最近完整对话，先删减旧摘录再牺牲近期原文，不固定十轮。
- B-128/REQ-02: 按 assistant/model cycle 缩短旧工具结果，最近 cycle 尽可能完整；硬上限兜底不得损坏 wrapper、伪造成功或声称不可见原文可恢复。
- B-128/REQ-03: 最终 provider 请求（包括 streaming fallback 重建）使用完整本地字符门；有序缩减后仍超限时不发送该次请求，且不截短当前输入、当前 runtime/tool/write 边界。同一 run 的此前调用可能已经发送，不能声称整轮零 provider 调用。
- B-128/REQ-04: 本地超限显示可理解的缩短请求/开启新对话说明，不显示通用网络故障，不自动创建会话。
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

正常发送：当前问题 + 会话状态 + 按既有规则选择的 Memory/工具内容 → 投影 → 最终预算检查 → 回答。未缩减时 UI 安静；缩减时 Context 区域提供单一简短说明；无法容纳当前不可裁剪内容时停止发送并解释。桌面/移动采用同一既有 Chat surface。

## Trust, Data And Authority

源记录是事实依据，临时摘录只服务当前请求。已配置 provider、Memory 准入和 Operations 权限保持原边界。新增回执仅有布尔值，不保存 prompt/工具正文/摘要，删除沿现有 conversation 生命周期。规则摘录和语义摘要都不能赋予工具/写入权限。

## Acceptance Criteria

- B-128/AC-01: 超过十轮但能容纳的历史原文完整；压力下完整近期轮次优先于旧摘录，escaping 和 wrapper 完整。
- B-128/AC-02: 一条 user + 至少三个 assistant/tool cycles 触发旧结果 soft compaction；巨大单结果有界；成功/失败、来源和截短标记真实，原始对象不变。
- B-128/AC-03: fully formatted system/human、schema JSON-size estimate、安全余量各计一次；stream/invoke fallback 超限不发送，强缩减有界且按顺序执行。
- B-128/AC-04: Loop → Chat 保留 local overflow 原因，展示 EN/ZH 用户文案并不执行自动重试/新会话。
- B-128/AC-05: 多 model invocation 重复缩减使用 OR 布尔聚合；零来源历史压缩可显示；每条回答只显示一个 reduction 状态。
- B-128/AC-06: live/save/reload reduction 一致，旧行兼容，既有 source/Memory/scope 计数不变，新增持久化字段无正文。
- B-128/AC-07: 有界长对话样例验证重要早期要求、近期修正、已确认决定、重复投影与无源数据写入；输出失败/限制而非宣称无限语义保留。语义性能需模型评测，静态字段断言不能替代。
- B-128/AC-08: 最新输入和权限不变，不能恢复旧权限，Memory 存储/提取不被 context reduction 调用或改写。
- B-128/AC-09: 完整历史原文或可逆表示 fit 时无摘要调用；可逆表示按真实 wrapper 后长度准入、逐字符可还原，预算缩小时重新判断。仍超限时摘要有预算和完整前缀覆盖，近期原文与摘要不重复；源前缀改变时拒绝旧摘要，超长输入分段且保留可追溯下标。
- B-128/AC-10: 旧工具中部关键发现和失败原因经语义摘要保留；任何 Memory 内容/来源变更后旧摘要不能进入最终请求，包含 fallback 重验证。
- B-128/AC-11: 空/非法/超长模型输出、超时和取消不写缓存；同会话 append 可复用有效前缀，删除/换会话/模型变化/关闭拒绝晚到结果；源码未增加摘要持久化或 Memory 写入。
- B-128/AC-12: 完整原文参考/裁剪/摘要对照覆盖早期要求、最新决定、已完成和待办、未知不捏造、权限不继承；至少三次摘要更新的实际回答保留当前约定，记录模型/fixture/输出/限制。

## Open Decisions

Owner 已澄清 LLM 调用由技术需求决定，不存在待批准的成本门槛。按 DEC-032 和 SDD 实施并验证；记录模型摘要固有的有损边界，不承诺无限保留。

## Delivery Handoff

- Active Package: [Context management](../../development/active/context-management/README.md)
- Architecture contracts: [PA Agent](../../architecture/pa-agent-architecture-plan.md), [Context Pager](./pa-context-pager-product-spec.md)
- Validation evidence: [Build-bound synthetic records](../../archive/2026/b-128-context-management-validation.md)
- Release / rollout boundary: Owner 已接受定向语义验收、问题修复及模块化本地提交；master 集成、push、正式 closeout 和 release 分别处理。
