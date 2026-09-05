# Context Management Software Design Document

Document status: Approved
Updated: 2026-09-05
Work item: B-128
Authority: DEC-032 与 Owner 对“LLM 排除并非决策、按需求选型、成本后优化”的澄清。摘要技术细节由本任务完成，不再设置调用成本批准门。
Product spec: [Context Management](../../../product/specs/pa-context-management-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Current Source Baseline

已核对 `PaAgentContextManager.forPrompt`、`PaAgentContextCompactor.microCompact/compactChatHistory`、`PaAgentContextProjector.projectUserInput`、`PaAgentContextBudget.snapshot`。`PaAgentRuntime.buildPaAgentCanonicalModelInput` 组装变量；`createPaAgentAnswerStreamPrompt` 使用 LangChain system/human templates；`streamWithInvokeFallback` 在实际 stream/invoke 前重建输入。`PaAgentLoop` 的 `turn_end.metadata.metrics` 承载 model diagnostics；Chat 使用 `contextTrace`，`ChatHistoryManager` 和 `PersistedContextTrace` 承载 save/reload。

## Design And Data Flow

1. Hygiene 后的 transcript 按 assistant/model cycle 分组，软阈值优先缩短旧 cycle；硬 cap 兜底也必须有真实完整标记，短 placeholder 不得放大原结果。所有修改只作用于 clone。
2. Projector 先完整序列化历史；能放入即使用既有原文格式。原文超限时尝试完整历史的可逆相邻重复表示，按实际 JSON、边界转义与 wrapper 后长度判断；能放入则保留全文，优先于语义摘要。仍放不下才使用语义摘要及最近完整轮次，或原确定性降级路径。旧摘录优先删除，无不可变开场锚点。
3. Runtime 在实际 provider 调用前格式化 system/human 文本，计一次最终字符串 + bound schema JSON length + 固定 wrapper reserve。超过本地 120000 chars 时触发一次有界 ordered rebuild；该局部门不承诺 provider-token fit。
4. 有序 rebuild：软缩减旧工具 → 硬缩减旧工具 → 缩减/清除旧 history digest → 删最旧完整 raw turns → 最后才硬截近期工具。不可裁剪的是当前 input、runtime/tool/write 边界及既有受限 Memory/Pagelet 注入。每一步需要最终 formatted request 复算，不能重复计 canonical variables。
5. stream/invoke fallback 每次实际请求都使用同一 guard。记录各次投影结果；不可约超限抛出 `PaAgentContextOverflowError`，Loop 输出 `context_local_overflow` diagnostic，Chat 用独立 EN/ZH 文案呈现。启动辅助分类前另做当前输入和最小模板的 lower-bound 检查。后续请求被拒绝不表示此前请求未发送，UI 不作整轮未发送承诺。
6. Projection outcome：`historyCompressed`、`toolResultsCompacted`、`toolResultsHardTruncated`、`budgetLimited`、`admission`。单次计数只作诊断；run receipt 使用 `historyCompressed`、`toolContextReduced`、`budgetLimited` 三布尔 OR。仅聚合实际尝试发送且 admission 为 fit 的投影，不把初始 metrics-only preview 或被拒绝投影计为 provider 已使用；local overflow 使用独立错误解释。
7. `ContextReductionReceipt` 在 `ContextTrace`/`PersistedContextTrace` 中用 additive `reduction` 保存。Chat 消费 lifecycle metrics 后创建 zero-source trace；不伪造成 contextUsed/statusOnly，不改来源/Memory/scope 计数。UI 显示 budget limit 优先于 compressed，未发生 reduction 时不新增行。

## Interfaces And Ownership

### Semantic Context Preparation

采用现有 configured Chat model 的工具无关 JSON 摘要，保持 custom PA Loop
及同步 Manager/Projector。`PaAgentContextSummarizer` 由 ChatService 持有；
standalone Runtime 自己拥有一份并负责 dispose。缓存保存精确 role/content
源前缀或 tool-result 源快照，避免把长度、轮数或无碰撞保证的短 hash 当作有效性依据。

- `planHistoryContext` 与 Projector 共享完整历史 fit 判断：原文 fit 时保留既有格式；否则完整可逆表示 fit 时同样返回 `full`，`prepareHistory` 不调用摘要模型。两种完整形式都不 fit 才预留至多 8000 字符的摘要空间，确定完整回合边界上的单一 prefix 与 raw tail。最终预算变小时重新判断，不能复用先前较宽预算的投影。
- 内部调用可通过 `historyBudgetChars` 仅下调本轮历史分配，默认和最大值仍为既有 60000 字符；不增加设置或放宽整体请求上限。preview、摘要准备、最终投影及 fallback 使用同一预算；诊断记录最终历史分配。定向验收沿用现有模型和场景，通过该入口实际触发语义路径，不修改生产压缩算法或只伪造摘要准备预算。
- `prepareHistory`：JSON 条目携带类别与全局源消息下标，按时间保留要求、修正、决定、完成/待办/未知，不能将助手假设升级为用户决定。完整摘要请求限定 16000 字符（含模板、旧摘要、源及余量），优先完整回合，超大消息以字符区间无遗漏分段。该批次限制来自真实模型在约 48k 输入中漏读嵌入要求的失败证据；不因重复背景推断整条无效。普通 append 可复用相同源前缀，删改从原文重建。
- 延迟优化（2026-09-05 Owner 授权）：保留按源顺序携带旧状态的串行更新、详细语义提示和完整 16k 请求预算，要求模型直接输出紧凑 JSON，每项有效信息只在合适字段保留一次。清理旧摘要中的重复背景与没有新增状态的确认回复，同时保留具体要求、完成/待办状态、未知归因及权限历史。仅移除格式空白的候选仍将背景逐批加入 facts，并在完成场景触发 30s 期限，因此冗余控制与“completed 仅含确认成功完成的工作”必须一并修复。并行局部提取反复漏掉最新修正；短提示增加单批材料量后，完成/未知/工具证据又出现遗漏，因此两种实验均撤回，不将其提速作为验收结果。严格结构、全局引用及最新状态规则保持。验证继续使用原配置模型与 9 个 fixture，不增加模型或真实用户数据。
- 仅调整提示仍反复漏读重复背景中的具体状态，因此摘要请求增加可逆的相邻重复表示：`content` 可以是原字符串，或 `{encoding: "adjacent-repeats-v1", segments: [{text, count}]}`。按顺序拼接 `text.repeat(count)` 必须逐字符恢复原文；只合并连续完全相同的句/行片段，不按关键词抽取、不删除独立内容、不改变顺序或重复次数。仅在完整 JSON 表示确实更小时采用；无重复或无收益时发送原字符串。`index`、`role`、`start/end` 始终属于原始消息，canonical 原文、源快照、缓存和最终 raw tail 均不使用该编码。
- 预算按实际编码后的完整请求测量，仍不得超过 16k。每条原始源消息在一次准备内最多线性扫描编码一次；完整消息装不下时退回原字符串分段，二分预算查找及代理字符边界裁切不再触发编码，避免非单调长度和反复扫描。重复次数属于历史数据，不产生工具或写入权限。该表示用于减少重复内容占据的请求空间与注意力，语义摘要仍是有损模型产物，不能从编码可逆性推导语义无损。
- 定向语义复核发现紧凑排列的多条编码源仍可能被误读为全空；摘要请求的源 JSON 保留缩进和结构边界，输出仍要求紧凑 JSON。排版开销计入同一个 16k 请求上限，必要时自然分批；明确“无新增信息”仅描述所在段落，不擦除其他段落或旧状态，所有 segment 的文本均需检查。无源材料丢弃或额外持久化。
- 完整可逆历史投影直接置于原 `chat_history` data-only wrapper。先 JSON 序列化再转义边界，保留正文中关闭标签的原始大小写；解码后逐字符恢复所有原始 role/content。原始 `ChatMessage.content` 仍是字符串，不能把用户文本里形似编码的 JSON 当编码解析。Answer system prompt 解释真实外层编码对象及其次数，segment 文本仍是历史数据。完整编码投影记 `historyCompressed=true`，但省略数、摘录数及语义摘要字符数均为零；不把它伪称为 LLM 摘要。该路径主要消除不必要的摘要等待，不能证明未实际执行的语义 fallback 路径质量。
- 六字段描述当前工作状态，不是追加式事件日志。用户后续修正替换旧有效约束/选择；必要的旧记录必须明确标为失效/撤销，不能并列为当前约束。用户确认完成、失败未完成、未开始及未知分别保留归因；助手对背景的概括不能擦除用户明确要求或确认。历史许可/撤销只作历史证据，当前限制单独承接。
- `prepareTool`：单独承接将被缩减的工具发现，默认至多 1500 字符；保留成功/错误状态和来源引用，不能生成执行权限。返回内容继续置于 untrusted tool envelope。
- 摘要调用本身使用完整消息预算、输出 token 上限和 run-linked signal；一次历史准备上限 30s，单工具上限 12s，整个 model-turn 摘要准备上限 30s，并服从原 run 的软硬期限。时限用于保留回答和取消能力，不是成本审批门。
- 摘要模型创建后、每个 tool-summary 请求实际发出前，以独立源快照和摘要 signal 调用既有 `MemoryEvidenceRegistry.prepareTranscript` 检查对应 Memory 源。被比较的源快照不能注册为 registry live reference；检查使用第二份 clone。取消/过期检查不能迟到更新证据，也不能因可选摘要超时把整个 run 的 Memory 永久撤销。全部摘要完成后再次 `prepareForProviderRetry`，最后同步组装和预算准入。新鲜性变化后的旧摘要无效；invoke fallback 只使用仍有效缓存，不重新触发摘要调用。
- 语义摘要以完整 JSON block 使用，预留空间后再选近期原文；不做字符串硬切，不与其覆盖前缀的规则摘录或原文重复。最终请求不可约超限仍明确拒绝。
- 摘要非法/最终全空/超长/超时回退当前确定性策略；无有效旧摘要时允许空中间批次继续读取后续源，已有有效摘要被全清空则拒绝该次更新。取消停止并释放本地资源。结构和来源下标校验只证明形式和关联，语义正确性由真实模型对照评测判断。

ChatView 删除、clear/new、restore、handoff replacement、close 使 service
generation 失效；配置 provider/baseURL/model 改变也 reset。重载从现有持久化
Chat 原文重建，无新增摘要持久化、后台任务、Memory 索引或权限登记。

- Compactor/Projector：工具和历史的纯投影，暴露实际 soft/hard/omitted 统计及预算控制；保留现有公开入口，移除固定十轮运行策略。
- Manager/Budget：组合纯投影及有界强缩减；接收 Runtime 的最终请求测量回调以包含模板/schema，不依赖 provider 或 storage。
- Runtime/Loop：真实请求门、fallback 重建和 typed overflow，保留取消/时限/Memory currentness preflight。
- Chat/Context Trace/History：无正文 run receipt 的 OR、显示、保存和重载。
- MemoryManager/VSS/governed selector/extraction scheduler：无修改，不接收 compaction summary。

## Lifecycle And Cleanup

不新增 observer/background worker/store。摘要调用使用可清理的 deadline 和取消监听；每次同步投影从 canonical 源重建并校验摘要来源，统计不递归累计同一结果。fallback 仍受同一 run signal、deadline 和 currentness guard 约束。

## Data, Privacy, Permission And Cost

语义准备复用已配置 Chat provider/model，增加必要的摘要调用；输出和源快照只在会话缓存中，不新增落盘字段。仅现有会话 metadata 新增布尔值；缩减文本说明工具、结果、来源和缺省详情，不指示重复执行有副作用工具。摘要属于会话状态，长期 Memory 无变更。

## Compatibility, Migration And Rollback

旧 trace 缺少 reduction 时等同三项 false，无 schema migration。沿用既有 Chat DOM/CSS 和移动布局；字段白名单序列化。投影、guard、UI bridge 可独立回滚；不删除原始历史或改 Memory index。强缩减前后需要验证 source/control snapshot 不变。

## Test Matrix

| Requirement / AC | Unit / integration | App smoke | Failure / fallback | Evidence target |
| --- | --- | --- | --- | --- |
| B-128/REQ-01 / B-128/AC-01; B-128/REQ-02 / B-128/AC-02 | pa-agent-context; runtime-chat-history | long history + tool-rich path | oversized recent result, escaping, mutation | T-01 |
| B-128/REQ-03 / B-128/AC-03; B-128/REQ-04 / B-128/AC-04 | runtime request tests + pa-agent-loop | local overflow explanation | rejected attempt makes no provider call; earlier stream may have run | T-02 |
| B-128/REQ-05 / B-128/AC-05; B-128/REQ-06 / B-128/AC-06 | context-pager; chat-view; history-manager/store | zero-source receipt + reload | old rows, duplicate metrics | T-03 |
| B-128/REQ-07 / B-128/AC-07; B-128/REQ-08 / B-128/AC-08 | continuity fixtures, repeated projection, current policy | representative continuation | old requirement/correction loss honestly reported | T-04 |
| B-128/REQ-09 / B-128/AC-09; B-128/REQ-10 / B-128/AC-10 | summarizer, summary-projection, chat-service | early requirements, corrections, tool findings | invalid sources, lost evidence, error vs success | T-06 |
| B-128/REQ-11 / B-128/AC-11 | summarizer, chat-view, chat-service | cancellation and reload | source/config changes, timeout, invalid JSON, fallback reuse | T-07 |
| B-128/REQ-12 / B-128/AC-12 | deterministic fixtures plus isolated evaluation runner | full-history / deterministic / semantic comparison and three updates | semantic drift, incomplete tasks, unknown facts, old permissions | T-08 |

## Open Design Findings

当前没有等待成本批准的设计门。摘要漂移、来源新鲜性、取消/缓存失效及真实模型连续性是本轮必须验证的技术风险；不能从短 runtime 或 JSON 合法推导语义质量通过。

## Approval

- Design authority: 2026-09-05 Owner 接受路线并要求推进，及 DEC-032；本任务制定其兼容实施细节。
- Approved on: 2026-09-05
- Authorized implementation scope: Context 可靠性、结构化会话/工具摘要、现有回执和连续性评测；2026-09-05 Owner 追加“先完成延迟优化，扩大验证先不做”。按技术验证结果减少摘要等待，调用成本优化仍后置；沿用当前模型与既有合成样本。无 Git/publication/closeout 或更宽 Memory 行为授权。
- Subsequent scope: Owner 随后要求“按照建议推进 b-128 的完成状态”，接受同模型定向语义验收、实际问题修复及模块化本地提交；不扩展模型/真实用户数据矩阵，master 集成、push、发布及正式 closeout 仍分别处理。
