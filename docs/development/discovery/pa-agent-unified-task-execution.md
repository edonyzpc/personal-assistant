# PA Agent Unified Task Execution — Solution Brief

Document status: Current
Delivery status: Needs Decision
Updated: 2026-09-09
Work item: B-135
Authority: 用户已认可的方向、2026-09-09 明确的默认学习与个性化边界、源码事实及候选机制；产品选择、技术设计与实际交付分别标明。

## 1. Outcome And Authority

2026-09-09 后续承接：[DEC-034](../../product/decisions/dec-034-unified-agent-task-execution.md)、[B-135 Product Spec](../../product/specs/pa-unified-task-execution-product-spec.md)与[B-135 Feature Home](../active/unified-task-execution/README.md)已建立。本 Brief 保留原故障证据、讨论理由与尚未决的技术选项；执行状态和全部新增任务只看[B-135 Tracker](../active/unified-task-execution/tracker.md)。文中的候选架构不能越过该 Tracker 的真实决策记录。

用户于 2026-09-08 明确要求：写作意图、Memory/Web/current-note 需求等语义判断由模型完成，本地语义规则整理为 prompt；写作统一到主 Agent，保留作品、准确保存和风格治理。随后认可该方向，要求从产品、架构、程序实现角度讨论、交叉验证并形成新方案。

推荐 **主 Agent 带着有效个性化背景理解任务 + 按真实需要取材 + 终局作品交付 + 宿主执行校验**。不补关键词，不增加独立分类模型再强制执行分类标签。资料声明是否保留及其执行位置仍待设计，不把每轮清空上下文作为前提。

- 目标：用户自然提出咨询、检索、创作、修改和保存需求；结果可读，作品可独立操作，资料与动作边界可信。
- 已认可：模型负责语义；去除本地关键词对任务路径的强制分类；统一任务决策，保留现有产品能力。
- 2026-09-08 产物：候选方案、原故障的App只读取证、源码诊断和离线验证。2026-09-09 最初续议明确了§1.1的两项产品选择，当时的方案更新仅修改文档；后续用户逐项决定并授权实施，实际实现、模型调用及验证证据统一见 B-135 Tracker，不以当时的文档范围描述后续执行。
- 后续决策：native 专用作品通道、Operations 语义提议、学习默认与旧值迁移、既有画像读取解耦及明确格式版本边界已有 Owner 真实答复，见 DEC-034 和 Tracker D2/D3、D5、D8、D10、D11。来源投影、预算、语义质量及兼容仍须完成工程验证；产品选择不等于验收通过，第 12 节的历史候选说明须结合这些后续决定阅读。
- 范围：Chat 语义路由、资料准入/投影、作品及相邻续写/风格/来源归属。Pagelet 自主调度、VSS 检索算法、Memory 自动维护、图片格式/存储政策不重新设计。

遵循 [North Star](../../product/pa-product-north-star.md)：用户不管理任务模式；旧笔记按需返回；生成不自动保存，保存不自动学习风格。

### 1.1 2026-09-09 已确认的产品修订

本节记录本轮用户选择及其承接，不回填为2026-09-08已批准，也不把新目标写成现有实现。

| Choice / user evidence | Confirmed boundary | Owning contract / follow-through |
| --- | --- | --- |
| D7 默认学习：“长期记忆提取和习惯学习分别默认关闭，须由用户主动开启”改为“默认打开满足功能需要” | 两项能力分别默认开启，作为PA正常功能提供，无需先找到开关逐项启用；按实际需要和既有调度运行，首次透明说明，可分别关闭、暂停和管理 | [DEC-034](../../product/decisions/dec-034-unified-agent-task-execution.md)、[B-135/REQ-17、AC-17](../../product/specs/pa-unified-task-execution-product-spec.md)；默认、准入、迁移、实现与组合验收全部由[B-135 Tracker](../active/unified-task-execution/tracker.md)承接，旧任务不新增阶段 |
| D1 产品边界：“只用当前笔记”不应排除“个人画像、既有 Memory 和已授权风格样例”，它们是PA差异化能力的关键 | 限制本次任务取材，保留PA理解用户和表达偏好的背景；不得把其他来源事实伪装成当前笔记内容 | 本文§5.1/5.2、B-135/REQ-03/04/09及§9案例；范围机制仍为候选 |

由此固定以下方案约束：

- 默认开启不等于每轮都提取、全量注入或无限后台调用；保留调度、预算、取消、来源资格、暂停和遗忘。附加vaultInsights、网络/写入权限及更高后果处理不因默认改变而自动开放。
- 学习默认、提取内容准入、既有Memory使用与显式风格授权分别处理。本次要求、AI生成、保存或局部修改不能自动形成长期风格；有效且匹配场景的风格仍可使用，当前要求优先。
- 默认策略不是“用户曾点击同意”的事实。后续迁移不能伪造确认时间或授权动作；旧默认未开启、有效主动关闭/暂停、来源不明旧值须在 B-135 设计中区分。Owner 2026-09-09 D8 已确认：无明确用户关闭证据的旧 false（含来源不明）迁移为开启，明确关闭/有效暂停保留；不把该策略写成历史授权事实。
- 撤回2026-09-08 D1中“所有个性化内容先移除、声明后再补入”的统一前置方案。常规Chat保留有效个性化背景与对话连续性；不能仅因“只用当前笔记”关闭整类Memory或风格，也不一律增加准备轮。
- 模型负责理解任务和材料用途；宿主负责真实来源、权限、完整性、版本及保存。新增取材仍受本次要求限制，真正关闭/排除/撤销不能被默认策略或模型声明覆盖。

2026-09-09 的源码核对还明确了三个设计前提：可靠交付须独立于native协议验收（§5.7）；长期提取与已授权风格不可误绑为同一开关（§6）；新来源机制须保留[DEC-032](../../product/decisions/dec-032-context-reliability-and-conversation-continuity.md)的完整历史优先及摘要连续性（§5.2）。无独立任务分类模型，不等于取消现有必要摘要、query rewrite或rerank调用。

## 2. Baseline And Evidence

源码基线：`codex/chat-image-management-b129`，`9f88eb5f6d7a8ba4496f3345863362a59020516a`。本次此前已实时查询远端同名分支并核对一致；这只描述审查输入，不声称后续远端不变。

上述身份属于2026-09-08故障诊断及§9.1证据。2026-09-09文档修订前实时核对的local master与origin/master均为`c923ee22089ef3e669b275718bce6052e98d7749`。现有写作识别、恢复展示与finish延后传递仍在；设置已落地旧默认关闭/consent准入，尚未实现§1.1新默认。旧测试仅证明它们当时的输入，不作为本次新方案PASS或新App取证。

| Evidence | Grade | Source / implication |
| --- | --- | --- |
| 原句“我好久好久没有写博客了，你有什么文章话题的建议吗？”命中“写博客了，你有什么文章” | Confirmed | [writing-output](../../../src/ai-services/writing-output.ts) 实际函数返回 true，无需既有写作上下文 |
| beta.5 已输出 10 个选题和结尾建议，JSON停在下个字段开头 | Confirmed | 当前App精确requestId的`writingRecovery.rawText`为836字符且JSON解析失败，尾部与用户粘贴一致；排除仅复制选区不完整 |
| warning 使作品进入 recovery，Chat 隐藏普通正文 | Confirmed | [bridge](../../../src/ai-services/pa-agent-stream-bridge.ts)、[ChatView](../../../src/chat/chat-view.ts)；展示与成版耦合 |
| 可选模型分类仍回退本地规则，结果限制工具、强制补查 | Confirmed | [required policy](../../../src/ai-services/pa-agent-required-capability-policy.ts)、[control policy](../../../src/ai-services/pa-agent-control-policy.ts)、[runtime](../../../src/ai-services/pa-agent-runtime.ts) |
| 主 Agent 已有“足够上下文直接答，需要时调用工具”指导 | Confirmed | [prompts](../../../src/ai-services/pa-agent-prompts.ts)；复用现有 loop，无需新增 Agent |
| 独立来源正则/current-note参数覆盖、自动Personal入模、风格前置依赖仍在 | Confirmed | [prepare helpers](../../../src/ai-services/chat-tool-prepare-helpers.ts)、[tool factories](../../../src/ai-services/chat-tool-factories.ts)、runtime、[projector](../../../src/ai-services/context/PaAgentContextProjector.ts) |
| 续写、风格场景及 Chat Memory 来源分类也使用关键词 | Confirmed | [style service](../../../src/chat/writing-style-service.ts)、[admission](../../../src/pa/chat-memory-admission.ts)、ChatView |
| 正文分离、固定版本、显式保存和独立风格授权必须保留 | Confirmed | [DEC-030](../../product/decisions/dec-030-multimodal-chat-image-copywriting.md)、[B-129 Spec](../../product/specs/pa-multimodal-chat-product-spec.md)、[Architecture](../../architecture/multimodal-chat-architecture.md) |
| 新方案准确率/速度一定更高 | Unverified | 待验收目标，不由静态分析或mock推导 |
| 原事件有4次实际Memory检索及4个重复调用；末轮由宿主硬期限结束 | Confirmed | 原始run仍在当前App内存，非rehydrated；见§2.1。精确模型净耗时、原始SSE结束帧/usage仍未知 |
| 百炼API调用日志未见请求失败 | User-reported | 用户2026-09-08补充；尚未取得对应最后回答的逐请求记录。与本地deadline一致，不等于provider正常stop、完整JSON或客户端完整接收 |
| qwen3.8-max新native作品协议的效果 | Unknown | 原事件不能替代新协议的provider验证 |

历史：`b6c67987` 引入写作识别；`7c71292` 的旧 B-129 SDD §4.2 选择最终文本 JSON，以分离正文、准确保存且不增加分类调用。旧 Tracker D-11 解决“假定已有 artifact 通道、实际缺少完成协议”的缺口。这解释作品边界的需要，不证明关键词分类不可替代。

### 2.1 JSON不完整：原事件取证与因果分层

用户补充故障发生在当前电脑、阿里云百炼API。2026-09-08通过Obsidian CLI只读目标Chat，匹配`writing_821ecfd0a30447c5ae985ef6f2a473ee`，取得非历史重建的`run_mtshaxoy_jaxvs56n`。已加载manifest为`2.10.0-beta.5`；当前配置为qwen / qwen3.8-max / DashScope兼容接口、thinking开启、Debug关闭。当前配置不是逐请求原始参数证明，manifest也不单独证明bundle字节身份；核心链路已与beta.5源码核对。取证未重跑提问、改设置或调用provider，也未复制笔记/思考正文及凭据。

| 原run阶段 | 相对首条assistant创建时刻 | 现场事实 |
| --- | --- | --- |
| 第1轮 | 0 ms | 2个search_memory，均success；执行耗时28,756/26,897 ms，其中一个已返回evidence/relevant且needsMoreEvidence=false |
| 第2轮 | 36,167 ms | 1个search_memory，success，28,923 ms，evidence/relevant |
| 第3轮 | 72,690 ms | 1个search_memory，success，28,757 ms，evidence/relevant |
| 第4轮 | 125,867 ms | 4个search_memory均duplicate_skipped，无第二次工具执行 |
| 最后回答 | 133,552 ms | 无工具；`stopReason=wall_clock_exceeded`，`providerCompletion=unknown`；整轮completed_with_warning，recovery reason=incomplete |

相邻开始时刻的差包含模型、工具和调度，不能称为模型净耗时；同批工具耗时可能重叠，不能相加作为墙钟。第一轮有一个partial结果，但当前completion policy没有“旧partial未清债务”：后续成功证据不被它强制补查。第四轮全duplicate与`duplicate_only`触发final-only的源码条件一致，原controlSnapshot未保留。以180秒loop默认预算估算，最后回答开始时尚有约46秒；**本例不能归因为“第165秒才开始、只给15秒写作”**。

结论分三层：

1. **已证实的直接终止机制：**PA在硬期限结束了最后响应的接收/等待，保留的JSON未闭合；这不能单独证明provider仍在生成或服务端恰在此处截断。前四轮模型生成、检索及调度累计到相对133.6秒，恢复提示不是单纯格式校验后伪造的超时。
2. **证据最支持的因果链：**误入写作协议 → 多轮模型/检索消耗共同预算 → 最终JSON尚未完成时宿主结束接收 → 不成版且正文被恢复提示替代。正文语义写完不等于后续字段、对象和provider结束事件已完成。
3. **仍不能排除的组合原因：**provider先因length/格式错误结束，或完成后尾部传输异常，随后PA也到期限。未保留原始SSE结束帧和usage，`unknown`不足以排除这些组合；不虚称已知道服务端生成到哪一个字符。

用户随后查百炼API调用日志，未见请求失败。该证据使“平台将本次调用记录为API故障”的解释缺少支持，进一步把排查重点放在PA预算与响应交付；它不推翻已确认的本地deadline，也不把未知提升为正常stop。百炼[模型监控文档](https://help.aliyun.com/zh/model-studio/model-telemetry)区分日志状态0（请求成功但客户端/用户主动中断）、200成功、4xx及5xx；未取得原记录前，不推定本次为0或200，也不把0自动对应为这次PA超时。成功响应仍需单独查看finish_reason及结构，不能由“无失败”排除length或正常stop但JSON非法。

一个PA run会包含多次provider调用；平台记录须按provider请求ID、调用时间、模型及阶段匹配到最后回答，不能用此前检索/重排的成功覆盖它。若已有对应响应：length支持输出限额解释；正常stop且服务端JSON完整、客户端rawText更短支持接收/归并问题；正常stop且服务端本身未闭合支持格式问题。仅状态成功无法选择这三者。对照优先使用现有数据，不为此默认开启含完整Prompt/Response的推理日志。

### 2.2 已验证机制与替代解释

| Mechanism | Evidence / conclusion |
| --- | --- |
| 硬期限截断接收 | [chunk consumer](../../../src/ai-services/pa-agent-chunk-consumer.ts)在计时器或next结果越线时拒绝后续chunk；[loop](../../../src/ai-services/pa-agent-loop.ts)abort并保留已收到文本。离线probe已复现body闭合但下字段未完的前缀被保留 |
| 软截止与硬截止不同 | 默认loop总预算180秒，预留15秒包含其中。普通incremental轮在软期限可能被abort、已有文字重分类，再开final-only；提前由duplicate触发的final-only使用当时剩余预算，不固定只有15秒。该软中断是独立设计风险，不是本例已证明的触发点 |
| 完成证据在尾部丢失 | [runtime](../../../src/ai-services/pa-agent-runtime.ts)的`streamWithInvokeFallback`先局部记录finish，等stream正常EOF才发provider_completion；finish后的异常/超时可使下游unknown。离线probe已复现“完整JSON+stop已到，tail抛错→正文仍完整但完成证据丢失”。loop即使收到completion也仍等待done |
| provider输出限额 | 最终回答建模没有显式传maxTokens，只有摘要等其他调用有单独输出预算；120,000字符是本地prompt预算，不是回答token上限。不能用正文长度猜出服务端截断；需同一请求的finish_reason、实发限额与usage |
| 格式遵循失败 | 旧envelope由prompt要求，无强制结构化响应模式；provider正常stop也可能产生不合法JSON。应独立记为schema/格式失败，不能都叫超时 |
| 字符串流与恢复UI | 字符串content原样追加，bridge用join("")，recovery/modal原样保留；超长历史是拒绝而非切尾。未发现这些路径故意删去最后字段 |
| 数组content的保真缺陷 | `stringifyModelContent`对数组执行join("\n").trim()；离线probe证实可在JSON字符串内部插入换行而破坏语法。未证明百炼本例走该形状，不能当作本例根因 |
| stream→invoke | 仅无reasoning/正文/工具输出之前的失败可fallback；有输出后不再invoke，所以不会自动补JSON尾，也未发现将两次回答混合的路径 |
| 生成后历史投影 | 当前canonical末条text为124字符恢复提示，rawText为836字符。原因是[history转换](../../../src/ai-services/pa-agent-history.ts)用committedFinalText替换writing正文，避免raw envelope回流；不是adapter少接收了712字符。诊断必须在该投影之前取hash/长度 |
| 计时起点不一致 | runtime hardAt起于startup前，loop预算起于稍后的构造时刻；不能据默认180秒推导精确用户墙钟。需统一绝对截止来源，记录startup与各阶段；该偏移未被证明导致本例 |

百炼官方[Chat Completions参考](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)区分stop、length、tool_calls；函数参数也必须校验，native调用不能保证JSON永不截断。官方[流式协议示例](https://help.aliyun.com/zh/model-studio/stream)明确展示stop之后仍有usage及[DONE]。官方[思考模式文档](https://help.aliyun.com/zh/model-studio/deep-thinking)说明qwen3.8-max支持思考及输出预算；当前thinking开启只能证明要记录思考成本，不能证明它是耗时主因。以上按2026-09-08查阅的接口文档解释，不猜模型默认限额，不自动关闭用户思考设置。

### 2.3 最小诊断边界

复用现有`PA Agent timing`及生命周期事件，在历史内容转换前产生有字段白名单的单run诊断：run/turn/message/request身份、transport、各轮开始/准备/首reasoning/首正文/最后正文/finish/EOF/abort时刻、进入final-only原因及剩余预算、真实工具耗时/跳过原因、实发输出与思考控制、provider原始结束枚举和字段缺失、真实usage、正文长度/可选hash、格式与恢复原因。缺失保留unknown，不能写0；不记录正文、思考、工具参数、笔记路径、凭据或图片。数字usage采用严格白名单，不全局放松现有token键脱敏。

请求身份应区分PA逻辑run/turn与每次物理调用的provider请求ID，标注回答、摘要、重排及stream→invoke尝试；可得时保存平台关联ID与HTTP状态。HTTP/平台调用状态、provider生成结束原因、客户端接收状态分别记录，不能把200、平台无失败或本地unknown当成完整交付证明。关联失败明确标未知；不采集API Key或任意响应header。

取证时Debug关闭；现存Chat对象未保留原始finish/usage、模型净耗时及精确结束时刻，当前配置不证明故障时的Debug状态。重开历史还会进一步丢失原run transcript，因此后续取证先检查原run是否还在，不能拿rehydrated数据冒充原始事件。若要持久保留诊断，需要另行明确有界字段、保留期与旧reader兼容；本方案首选当前内存/现有Debug，不默认新增完整事件日志或遥测上传。

## 3. Candidate Requirements And Acceptance

以下为讨论形成的原始16项身份，已由[B-135 Product Spec](../../product/specs/pa-unified-task-execution-product-spec.md)承接，并新增REQ/AC-17覆盖默认学习全量改动。不表示执行已开始；当前需求解释以Spec为准。

| Requirement | Acceptance outcome |
| --- | --- |
| B-135/REQ-01 — 主 Agent 语义决策 | B-135/AC-01：原句、否定、引用、写作背景和图片理解正常回答；咨询不因词命中自动成版；混合“建议并起草”同一任务完成 |
| B-135/REQ-02 — 按真实证据需求取材 | B-135/AC-02：充分上下文直接答；需要资料时正确取材；不因预测名单重复补查；失败/零结果如实说明 |
| B-135/REQ-03 — 任务取材限制与个性化背景分别处理 | B-135/AC-03：新增任务取材前有有效约束；无效/冲突批次零新增执行；“只用当前笔记”保留有效Personal/既有Memory/已授权风格，不擅自扩展取材或混淆事实来源；禁网、混合来源和跨轮更正均覆盖 |
| B-135/REQ-04 — 全部provider输入按用途与真实边界准入 | B-135/AC-04：保留有效个性化背景和获准历史；Personal/Memory/style、旧工具结果、摘要、图片、retry/summary/rewrite均遵守实际关闭/排除/撤销与本次用途限制，不因当前笔记限定整类剔除，也不能只限工具名 |
| B-135/REQ-05 — 回答与作品展示独立 | B-135/AC-05：普通文本和作品预览中断后仍可读；协议失败不替换整条回答；无输出给出真实原因 |
| B-135/REQ-06 — 精确作品版本 | B-135/AC-06：完整事件才成版；字符/hash一致；截断、身份冲突、来源失效不成版；人工恢复保留AI来源 |
| B-135/REQ-07 — 终局可以交付 | B-135/AC-07：Chat收尾输出文字或一个作品，无新来源/动作，也无强制acknowledgement模型轮 |
| B-135/REQ-08 — 续写与素材归属 | B-135/AC-08：模型解析目标，宿主验证parent/session/hash；回选、失败继续、新话题、多图指代和重放不串版串图 |
| B-135/REQ-09 — 风格按需且授权不变 | B-135/AC-09：模型提出场景；有效且匹配的已授权样例才入模，不因“只用当前笔记”或误绑长期提取开关而失效；撤销/Forget/排除/预算变化物理请求前重验 |
| B-135/REQ-10 — 保存与Memory来源保真 | B-135/AC-10：复制/编辑/保存确切版本，不再生成；AI原稿/本次修改/明确风格动作区分；结合B-135新默认验证本次要求不自动变长期偏好，主动关闭/暂停仍有效 |
| B-135/REQ-11 — 兼容与回滚 | B-135/AC-11：旧聊天、JSON recovery、版本、图片、SaveReceipt可用；模型/Desktop/iOS能力不静默缩减；旧reader验证后才声明可回滚 |
| B-135/REQ-12 — 质量与成本可复核 | B-135/AC-12：同输入记录结果、调用序列、结束原因、耗时及可得usage；无独立分类模型；额外准备轮如实记录 |
| B-135/REQ-13 — 操作提议按用户目标 | B-135/AC-13：现有 opt-in/core tools 内，普通咨询不主动产生写入卡片；明确请求可提出方案；关闭、未确认、取消均不写入 |
| B-135/REQ-14 — 结束事实与格式分开 | B-135/AC-14：区分宿主deadline、provider length、正常stop但格式错误、finish后尾部异常及缺失finish；后续usage/EOF不抹掉已取得结束证据，native同样需完整校验 |
| B-135/REQ-15 — 共同预算内可靠收尾 | B-135/AC-15：统一绝对截止起点，取材/准备/思考/交付共享预算；已开始的正文/作品不因软过渡被丢弃重答，硬期限/取消不延期；禁止late工具及多次收尾重试 |
| B-135/REQ-16 — 故障能按原run定位 | B-135/AC-16：投影前保留无正文的最小阶段与终止证据，说明unknown与实发限额；可区分“生成不完整”和“只缺usage/尾部结束”，不新增默认全文日志或上传 |

首版保留现有每轮一个作品，不建设通用多产物平台。多篇请求可交付有分节的组合正文，不任意丢弃某篇；独立多作品管理不由本文自动授权。

## 4. Alternatives And Recommendation

| Option | Assessment |
| --- | --- |
| 补正则/仅启用policyModelName | 不符合已认可方向，其他语义覆盖和强制路径仍在 |
| 独立模型先分类，再执行固定路径 | 新增固定调用和失败点，仍锁定路径，不推荐 |
| 主Agent直接选工具，仅prompt约束来源 | 机制最少，但宿主不能独立核验首调是否符合自然语言限制，不能声称访问保障无变化 |
| **同一Agent保留有效个性化背景，按需取材，native纯输出交付** | **修订后推荐**；不预分类任务、不统一清空首轮背景；新增取材的范围表达/整批预检待定，Chat输出终局和provider完成证据仍须验证 |
| 所有Personal/Memory/style先剔除，声明后才补入 | 2026-09-08的D1候选；被2026-09-09用户选择替代，不得作为P0默认实现或暗中保留的fallback |
| 普通文本内可选run-bound正文块 | 可行备选，保留text-only final；需自建增量定界、碰撞、多块、截断及精确空白语法 |
| 所有回答统一answer/artifact JSON | 将结构失败扩散到普通问答，不推荐 |

独立审查有实质分歧：架构lane偏好正文块以减少loop改动；实现lane偏好native已有参数边界。综合裁定：本次是共享Agent职责调整，不再限定单函数补丁；优先native并设置P0完整性/兼容门，避免另造文本协议解析器。若现有支持模型不能通过native门，停止该路线推广，回到正文块备选的独立设计决定；不在runtime叠加两个自动协议，也不以手选静默替代既有自动成版能力。

## 5. Proposed Architecture

下文新接口名均为 **Proposed**。复用registry、loop、dispatcher、context manager和WritingVersionService，不新增独立planner服务、缓存平台或通用workflow引擎。

```mermaid
flowchart TD
    U[用户目标与有效约束] --> A[同一主 Agent]
    P0[有效个人画像 既有Memory 已授权风格与对话] --> A
    A -->|资料足够| T[普通文字回答]
    A -->|需要新增任务资料| S[形成任务取材约束: 机制待定]
    S --> G[宿主整批准入与权限检查]
    G --> C[笔记 网页 图片 已授权风格]
    C --> A
    A --> O[交付作品: 纯输出]
    O --> V[完整性与生成输入快照校验]
    V --> W[确切作品版本]
    W --> E[用户编辑或选回版本]
    E --> P[用户确认保存]
    P --> F[现有保存与恢复服务]
    A -->|中断| R[保留可读内容及准确状态]
```

### 5.1 任务取材与个性化背景

“只用当前笔记”指定本次任务的内容依据，不能被转换成全局禁用Personal、既有Memory或已授权风格。它们仍可帮助理解用户和组织表达；实际资料的来源与用途必须分开。

| Material | Role under “只用当前笔记” | Boundary |
| --- | --- | --- |
| 当前笔记 | 本次分析、总结或创作的指定内容依据 | 绑定真实note identity，不能用nearby无结果替代全文事实 |
| 个人画像、既有Memory | 理解用户背景、关注点与偏好，调整解释和组织重点 | 不把记住的其他经历、人物、地点或时间说成当前笔记已记载的事实；已有原始工具结果不能仅贴Memory标签就自动变成个性化背景 |
| 已授权风格样例 | 在匹配场景下辅助表达，当前要求优先 | 不把样例经历作为本次事实；关闭、撤销、Forget、来源排除继续有效 |
| 其他笔记/网页的新检索结果 | 仅在当前任务允许且确有需要时新增取材 | 不为扩充正文擅自检索；不能把“保留既有Memory”解释成自由检索全库或联网 |

例如“只用当前笔记，帮我写一篇博客”：可以采用用户偏好的表达方式和重点，但不把其他笔记的经历写成当前笔记中的内容。默认提供个性化能力不要求全量注入；仅准备有效、相关、受预算约束的背景。用途判断交给主Agent，不增加另一套关键词或逐条分类模型。

Proposed `declare_source_scope`仍可作为新增取材约束的载体，但是否保留独立调用、是否把约束与首批请求一并表达尚未冻结。它不含taskType、requiredTools、confidence或“必须检索”名单；不得将正常使用个性化背景也变成必经的额外声明轮。

- 新增取材在实际执行前必须有可核验约束；若采用scope与source同批，收齐响应并整批预检后再执行，不在参数增长中提前检索。
- 缺失必要约束、冲突、非法引用或越界请求使该新增执行批次整体拒绝；返回简短纠正结果，复用无进展/时间预算，不无限重试。
- scope不能打开真实关闭的能力、解除Data Boundary排除或授权写入；“默认开启”按产品规则解析，不由模型自报授权。
- 已生效的本轮限制不能由工具内容或模型声明放宽；下一轮用户更正由主Agent解释。错误收紧影响目标时说明/澄清，不把未知当允许。
- 按实际数据访问与用途约束，不把工具名当数据范围。宿主验证执行与有效约束一致，不宣称模型语义永远准确。

### 5.2 首次入模与自动上下文

常规首请求保留当前用户要求、有效个性化背景与获准对话上下文，让同一主Agent结合用户背景理解任务。撤回“先只给用户原文和opaque handles，再统一补Personal/Memory/style”的固定bootstrap；仅当前笔记的限定不再触发整类背景移除。

- 依照[DEC-032](../../product/decisions/dec-032-context-reliability-and-conversation-continuity.md)，获准历史能容纳时完整原文优先，超限才用结构化会话摘要与近期原文；原始记录与源快照仍为依据，不新建第二套历史。
- 必须承接早期要求、后续更正和助手提出的方案。例如助手提出三个方案后用户只说“采用第二个”，不能因只保留用户轮而丢失指代；旧会话没有结构化scope记录也须有可验证的续接方式。
- 任务约束与背景用途在投影中明确；保留个性化不意味着把旧工具证据、混杂摘要或vaultInsights全部作为当前任务事实。受限制的任务材料不可经summary/cache/retry复活，必要时按可证明的来源重建相关派生摘要。
- 当前图片、选中作品及Pagelet材料沿各自产品与数据契约准备，不一律因新增scope协议延迟；明确“不看这张图”、本次不用某种风格等要求须被正确解释。模型场景不足时按需准备写作上下文，不每轮全量注入样例。
- 全局关闭、Data Boundary排除、暂停/Forget及来源currentness在每次物理dispatch前核对；summary、query rewrite、retry/fallback、图片/风格准备都受同一真实边界约束。
- 工具`prepareBatch/prepareArguments`、动作baseline/inspect和动态加载返回资料也按实际读取准入；action/meta类别不豁免，确认写入不追认此前越界读取。
- “本次不要采用某类背景”和“不要向provider发送某类内容”需要区分。后者必须在实际发送前满足，已经发送的内容不能撤回。任意自然语言限制怎样在首请求前转成宿主可核验约束，仍是D1设计问题；不能靠模型看完后再删除宣称未发送，也不能重新默认清空所有人的个性化背景。
- 不为理解范围新增独立分类模型；若具体来源/图片/历史任务确需准备轮，如实记录调用与延迟，用同输入验收，不承诺一定更快。必要摘要继续沿用当前Chat provider/model，不顺带更改thinking或删除policyModelName的其他用途。

### 5.3 工具选择与终态

将CAPABILITY_SIGNALS、confidence→required、自然语言allow/block及current-note full override迁移为取材指导与反例。移除“预测工具没调用→强制纠正/缺能力警告”作为完成判据；同时清理由预测来源类别造成的工具隐藏。

保留实际可用性、参数schema/别名、来源事实、取消/期限、去重和无进展收尾。Memory `none`表示查过但无相关证据，`unavailable`表示无法查得；不删除evidence registry，不恢复已被投影撤销的证据。资料返回后由Agent判断具体缺口，预算/无进展可以关闭新增访问，但不以另一套词规则猜测“资料足够”。

Operations的`hasOperationsWriteIntent`不仅影响schema暴露，还参与`canExport/canExecute`。推荐在现有per-vault opt-in及四个core tools范围内，由主Agent判断用户是否要求操作方案，替代这一语义硬门。工具暴露及提议准入方式因此改变；真实写入仍保留用户确认、执行权限、目标与stale检查，不增加core write能力。普通咨询不主动制造写入卡片。此项是[DEC-014](../../product/decisions/dec-014-defer-operations-agent.md)的明确候选变更，列为D5，不能称作仅整理prompt或完全不改准入。

### 5.4 按需写作上下文

Proposed `get_writing_context`接收模型解释的目标、场景和本次风格要求，返回宿主可验证的会话作品/材料句柄；复用WritingStyleService治理、预算及currentness。按需准备不等于默认关闭：已有有效背景可复用，不能仅因“只用当前笔记”排除个性化，或强制每轮重新读取同一组样例。

- 模型判断“上一版/第二段/换话题”，宿主核对允许的parent、session、正文hash、当前显式选版及材料身份；不接受任意路径。
- 失败写作只有材料lineage，不能伪装为已完成父版本。回选旧版及默认关联图片保留；明确排除某图不能被现有parent图片union加回。
- 只有已授权且场景匹配的样例可用；unknown、冲突、暂停、Forget、预算不足不注入。明确要求已记住风格而不可用时说明，不能普通写作冒充完成。
- 先取上下文，再生成；两者不能同批冒充“已参考”。每次物理dispatch前重验pause/forget/settings/source epoch，记录真实revision。

### 5.5 Native作品交付

Proposed `present_writing`是纯输出能力，以现有native tool-call参数承载`body`、可选`explanation`和已提供的作品上下文handle。宿主生成run/message/version/origin/hash、真实来源与图片；schema不接受保存路径、权限、可信来源清单或origin。

- 普通答复仍是assistant text。可先给简短说明再交付一个作品；纯输出调用不把说明重分类成隐藏的工具思考。
- 它必须是该响应唯一调用，不与source、scope、action或第二作品混批。混批执行前拒绝，不能先取资料再追认作品用了它。
- 完整交付直接终结当前生成，不追加acknowledgement模型轮，不复述/重写正文。Agent须在交付前完成必要任务步骤；结构完整不证明所有用户目标已满足。
- 保留真实`finish_reason=tool_calls`，新增正常作品输出完成判断，不伪装为stop。需完整参数、正常provider结束、调用身份、生成输入快照有效及无取消。
- 不在中途JSON恰好合法时成版；完整正式解码后正文原样进入WritingVersion。不能从DOM取字或调用第二模型提取。
- 一轮一个作品；event重放及stream→invoke不重复提交；同一幂等身份正文不同须冲突拒绝，不覆盖。

### 5.6 Chat最终收尾

明确替代Chat当前“final_answer_only导出零工具schema”的技术规则：收尾只允许文字或一次注册的纯输出，禁止source/context/action；Pagelet保持原协议。

schema binding、loop、dispatcher、completion policy与bridge共同执行，不只改prompt。输出不借用source tool额度，仍受原硬时间、文本/请求预算和一次输出上限；不能续期、重试绕过或重开普通工具。硬期限先于完整结果到达，或provider未正常完成时保留预览，不成版；完整结果在期限前取得的尾部处理见§5.7。deadline数值以源码为准，不以增加timeout掩盖无进展。

### 5.7 完成证据与预算的独立修复线

**native解决作品表达边界，不能消除超时、token耗尽或非法参数。** 本节对普通文字、旧写作恢复及新作品协议均适用，须先于新协议的兼容结论验证。

- **及时传递完成事实：**adapter收到provider结束字段时，在同一响应最后content/arguments已处理后，记录结束枚举、所属request/choice及本地接收时刻，不等EOF才首次通知。保留missing与未知枚举的区别；`tool_calls`按新输出协议处理，不能转成stop。
- **分开内容结束与连接结束：**只含usage的尾块不改变正文或结束事实。正常内容结束、结构完整、快照有效且在硬期限/取消前取得的结果，不能仅因之后EOF/usage缺失就降格为“模型没写完”；连接清理仍有界且不延长生成。相互冲突的finish/晚到正文按协议异常处理，不拼入已冻结结果。源/身份失效和取消的先后顺序须单独验证。
- **失败原因可并存：**provider length后又遇宿主deadline，记录两件事；正常stop但JSON非法属于格式失败。无finish时只报告实际看到的宿主/传输原因及完成未知，不能推断模型被token截断。
- **逐段保真：**字符串与数组text block均按provider规定的增量边界原样归并，禁止逐chunk trim或人为插入换行。对不支持的content形状明确拒绝，不将任意对象stringify为作品正文；完整解码后才建版本。
- **统一预算来源：**runtime创建一个绝对截止，loop、准备、检索、summary/rewrite、provider retry及交付使用同一剩余量。记录startup占用，不把每个阶段或fallback重置为新180秒。收尾预留只限制新增取材，不能被误报为所有最终回答的固定时长。
- **保护已开始的交付：**推荐软过渡在轮次边界或尚未开始正文/作品交付时发生；已开始交付的响应在原硬期限内继续，不把其正文重分类丢弃后再要求完整重答。晚到来源/动作调用不能执行；不将两次生成的半段JSON拼接。只有thinking的等待仍受既有idle/截止约束。此项改变现有incremental软过渡，列为D6，P0验证后再冻结具体状态迁移。
- **不以文字猜测最终性：**`text_delta`只证明有可读候选，“我先查一下”也可能随后带工具。推荐允许已有文字响应使用硬期限内余量，但承认它可能耗尽收尾预留；随后出现的late source/action不得执行，不清空候选、不重置预算，也不自动另开完整重答。P0覆盖“文字后工具”及“纯输出名称/参数跨软期限”，明确候选与最终成版的区别，不再用关键词判断哪段像最终答案。
- **先解释成本再调参数：**对本例先解决多轮取材后收尾和结束证据，不默认增加180秒、关闭thinking、截短用户目标或套统一max_tokens。确需调整思考/输出预算时按模型支持、实际usage与质量对照决定，区分回答上限、思考预算和总输出上限；不把普通120,000字符prompt预算混用为输出配置。

最小状态分开记录`provider内容结束`、`transport结束`、`结构校验`、`宿主中断`，复用现有typed events/diagnostics，不新建workflow框架。先用可控尾帧的离线样例验证，再做百炼同口径样例；一次成功无法证明不会再超时。

## 6. Display, Completion And Provenance

| State | UI | Program consequence |
| --- | --- | --- |
| 普通文字生成中 | 逐步显示可读内容 | 不依赖作品协议 |
| 作品参数到达中 | 合法body字符串前缀只读预览，标未完成 | 不成版、不启用完整版本保存 |
| 完整输出且版本持久化成功 | 正文、版本操作及参考详情 | 复制冻结text，不混入解释 |
| 输出完整但版本持久化失败 | 正文仍可读，说明版本未保留，可本地重试 | 不声称可重开，不重新生成 |
| 截断/取消/非法协议 | 保留可读内容、说明中断，允许明确选择/编辑恢复 | 不补JSON、不自动成版；选取原文仍为AI来源 |
| 正常内容完成，usage/EOF异常 | 保留经校验正文，仅在详情说明用量或连接结束状态未知 | 按§5.7保留已验证完成事实，不泛化为内容截断；结构/快照未通过仍不成版 |
| 来源/会话身份失效 | 保留获准保留内容，关闭受影响参考/未准入预览 | 来源删除/隐私规则优先，不能重曝被撤销原文 |
| 用户确认保存 | 预览确切版本/图片/目标，区分部分完成 | 复用SaveReceipt与恢复，不再调用Agent |

native预览仍需小型只读增量字符串解码，不能声称没有parser。优先复用tool buffer；支持JSON escape/Unicode/跨chunk，绝不补参数；完整JSON结束后解码并核对预览与最终字符。若P0不能可靠预览，不得声称流式AC通过或静默改成等结束才显示。

来源冻结在**生成该输出的provider请求**，不是run最后的来源union。只说明实际提供，不声称逐项采用；同批之后返回资料不属于生成依据。版本、任务、保存完成分别判断；与已完成证据无关的后续清理warning不删除版本。准入前取消/来源失效/身份冲突阻止成版，保存成功后UI关闭不回滚笔记。

### Chat Memory与长期风格

不能删`classifyChatUserProvenanceKind`后把一切标ordinary。分开两类信息：宿主事实（真实user/assistant来源、消息/hash、UI编辑、作品事件、明确风格授权）；模型语义（本次约束/作品素材/改稿/独立长期陈述）。模型语义仅供候选/排除，不伪装成宿主授权。

复用Type A提取与治理来理解语义，补充用户上下文和宿主事实，不每条Chat新调分类模型。按§1.1和DEC-033修订，长期提取默认开启，但实际提取仍须通过有效启用状态、调度、来源和治理准入；用户关闭/暂停时不能为语义分类而偷偷启动提取。写作/改稿、生成及派生内容不自动成为长期风格；未知/不完整语义或来源缺失先不产生候选，不回退ordinary；独立真实陈述按既有effect/risk契约处理。

长期提取、读取既有Memory与使用显式授权风格是不同准入。默认调整不能把风格样例额外绑定长期提取开关，也不能解除Memory主控制、场景匹配、撤销和来源治理。默认开启的代码迁移、真实触发、退出及组合验收全部属于B-135。普通Personal读取当前还与提取门耦合，是否拆开已作为B-135/D10单独提问，不能把保留风格的已定规则扩展成已批准改变普通画像发送行为。

P0必须验证“个人事实+本次写作要求”的混合消息、新旧metadata reader及两条持久化准入路径：不能整体永久丢掉个人事实，也不能模型自报durable就获得授权。新字段按需加法，旧hostProvenance不回写/降格；explicit_style_action只来自真实用户动作。若既有治理无法承接，提出具体补充决定，不放宽准入。

当前`collectChatMemorySources`在Type A之前就过滤非ordinary，最终两条准入也只认ordinary。P0必须具体分开“可交现有提取模型审阅的真实用户来源”与“可持久化候选的证据”，或给出等价可执行契约；不能只改提取prompt，否则unknown永远到不了模型。宿主校验消息身份/hash及真实动作，模型解释独立事实、本次要求和引用；进入提取输入不等于获得长期保存或风格学习资格。交付物包括可运行的混合消息样例、两条最终准入结果及旧/新reader结果，不能只凭模型回答截图通过。

## 7. Prompt Organization

在现有主prompt、工具planner guidance、按需writing guidance维护职责一致的指导，不保留prompt与关键词表双重权威：

- 结合当前请求与相关对话，区分提及、经历、引用、否定、建议和作品交付。
- 按用户限制与实际缺口取材；有证据直接答，无资料不虚称个性化或验证完成。
- scope只承接任务取材限制，不预测必调工具，不改变权限；“只用当前笔记”保留个性化背景，其他来源事实不冒充当前笔记内容。全文精确查找用合适范围/full，不以nearby无结果代替全文。
- 足够即回答；相同结果不反复检索；收尾仅用已有证据。取写作上下文后再一次交付，不同批请求新资料。
- 选题建议只需找到能支撑建议的主题，不必为每个选题都再查一遍；已有相关结果时直接组织答案。换查询措辞前指出真实缺口，不能把检索状态说明误当成必须继续的指令。这是模型指导与真实样例验收，不新增“第几次检索必停”的语义硬规则。
- 选择、修改、保存和风格授权分别处理。目标或来源歧义实质影响结果时简短澄清，不固定每问先访谈。

把规则转成目的、适用条件和反例，不改写为“看见这个词就用这个工具”。语义正确性靠真实案例，执行不变量靠自动化测试。

## 8. Implementation Map And Phases

| Area | Proposed change / retention |
| --- | --- |
| prompts / tool factories / prepare helpers | 统一语义指导，去语义参数覆盖；保留schema/别名 |
| required / control policy | 去预测强制和工具隐藏；留真实证据/无进展；policyModelName其他rewrite/rerank用途不删除 |
| runtime / loop / chunk consumer / dispatcher | 新增取材约束的执行位置待定，保留有效背景；纯输出及生成快照、完成事实及时传递、统一截止与软过渡；权限不扩张 |
| projector / history plan / summarizer | 任务材料与个性化用途分开，获准历史完整原文优先、摘要来源与retry重验，不另建日志或默认只给用户轮的bootstrap |
| writing-output / bridge / chat types / history | 新完整性、预览、版本事件，旧recovery兼容；内容/连接/格式分开，诊断在历史重写前产生 |
| ChatView / modal / locales | 去外层模式和隐藏正文；保留选版、恢复、准确状态；普通UI不露内部工具名 |
| style / plugin / ChatHost | 模型场景到受治理上下文，保留撤销/预算/currentness |
| provenance / admission / extractor | 事实与语义候选分开，两条准入保真，保护独立真实陈述 |
| versions / persistence / save | 优先复用exact版本/receipt，防parent素材union违背本次范围；按需才改schema |
| Settings / consent / habit learning | 默认开启、有效退出、真实触发、迁移和组合验收全归B-135/REQ-17、AC-17及本轨Tracker；旧B-106仅保留原契约与交付证据 |

以下仅为实施建议。关键机制采纳后再建立L3 Decision/Spec/Active Package/Approved SDD；现有B-129图片和设备证据沿其当前契约/收尾记录，不被本方案替代，也不把已经完成的旧任务重新列为本次必做。

| Phase | Work / exit | Stop or expansion |
| --- | --- | --- |
| P0 可行性与契约冻结 | 承接已有原故障证据，独立定义finish及时传递、尾部异常、格式判定与预算对照；按§1.1重设计D1并验证个性化/历史/native预览与终态、软过渡、Memory准入及旧reader | 已有现场及离线证据见§9.1，不默认重耗provider复现旧事件；新协议、预算迁移及B-106新默认未验证。能力/边界无法保持则回决策，不以“改native后自然好”跳过 |
| P1 语义与资料闭环 | prompt、新增取材约束、个性化/任务材料投影一起接通，迁移取材与操作提议规则；写作交付及剩余意图规则在P2一起切换 | 本阶段来源机制及Desktop真实门通过；保留有效Personal/Memory/style与历史，parent全文/图片遵守各自来源边界；旧写作旁路无法分离则与P2合成完整行为slice，不提前标完成 |
| P2 统一作品闭环 | 输出/终局/预览/parent素材/按需风格/provenance作为完整slice切换 | 不丢风格、不自动学入任务要求、不以手选替代成版；完成Desktop及受影响移动门 |
| P3 兼容与整体验收 | 旧历史/恢复/保存、跨轮scope、模型矩阵、最终完整gate及App | 冻结输入，修复或明确裁定P1/P2问题；发布另行授权 |

可细分提交，以完整行为门退出。新方案不承诺降低耗时，不设置更长timeout作主修复。

## 9. Minimum Sufficient Validation

| Risk / AC | Minimum evidence / command | Pass condition | Rerun / expansion |
| --- | --- | --- | --- |
| AC-01/02 语义 | 固定中英文真实模型集；runtime-prompt/required/control/host-tools相关suite | 原句、否定、引用、混合来源、充分上下文及全文查找行为正确，不只断言prompt含词 | 语义失败、工具缺失或新模型声明 |
| AC-03/04 首调与入模 | runtime/dispatcher/context-admission/history/summary；捕获物理输入/调用顺序 | 必要约束缺失/冲突时零新增取材；当前笔记限定保留有效Personal/既有Memory/style，既有工具事实不冒充背景；真实关闭/排除/撤销覆盖派生输入，新要求不复活旧内容 | 新provider路径/来源/摘要/配置 |
| AC-05/06/07 输出 | chat-writing-output、b129-multimodal-runtime、pa-agent-loop、stream-fallback、chat-view | 文字保留、跨chunk保真、完整tool_calls才成版、混批/多output/length/filter/abort拒绝、final-only无源/动作/新模型轮 | provider完成字段、bridge/loop/parser改变 |
| AC-08/09/10 风格/来源 | chat-writing-style-service、memory-writing-style及admission相关suite，实际输入revision；与B-135/REQ-17、AC-17的新默认证据组合 | style先取后写、撤销重验、父/图正确；新默认不使AI/本次要求自动学入，混合真实事实不丢；关闭提取与显式风格使用的既有边界不误绑 | schema/准入/权限/来源或默认策略改变 |
| AC-03/04 与DEC-032连续性 | 既有context/history/summary相关suite及同输入真实续接；验证物理投影与源快照 | 早期要求/后续修正、助手方案“采用第二个”、旧会话无scope记录、摘要含受限材料均可准确续接；不以裁空历史换取scope通过 | scope表示、历史选择、summary/cache/fallback改变 |
| AC-10/11 保存兼容 | writing-versions/save-action/save-modal/history-store/manager及旧fixtures | text/hash/图一致、重试幂等，旧reader结果明确，部分保存不误报 | 持久化/reader/素材归属改变 |
| AC-13 操作提议 | operations runtime/controller/PolicyEngine相关suite及真实普通咨询/明确写入 | 咨询无多余卡片，明确目标可提议；opt-in关闭不暴露/执行，未确认及取消不写入；准备读取也受scope约束 | schema暴露、提议或执行准入改变 |
| AC-14 完成/格式/保真 | stream-fallback/loop/writing-output：相同短JSON用可控尾帧驱动 | 硬截止前缀、length正常EOF、合法/非法JSON+stop、stop后tail挂起/报错、finish同chunk含文字、usage-only、数组chunk均被正确区分；不误成版 | adapter/SDK/transport/parser改变 |
| AC-15 预算 | runtime/loop/chunk-consumer：startup、重复工具、提前final-only、软过渡、文字后工具、纯输出名称/参数跨软期限、硬期限/取消对照 | 单一截止、不重置预算、不丢候选、不误认最终性、不执行late工具；记录预留耗尽，思考不会续期，既有buffered行为有回归证据 | 截止/准备/fallback/输出/模型参数改变 |
| AC-16 定位 | 现有Debug/生命周期白名单投影、history相关suite | 原run事件与显示/历史改写分开；无正文、思考或敏感配置；缺值unknown，错误不被泛化为Runtime limit | 诊断字段或持久化范围改变 |
| AC-01–16 真实路径 | qwen3.8-max及另一已支持native provider；普通/Memory写作/风格/续写/范围/操作提议/forced-final | 自然结束、序列、正文/版本hash与投影可对照；目标模型不可用标BLOCKED | 同因两次无进展缩小重现，不立即扩大所有矩阵 |
| 共享runtime/App | npm run lint；npm run build；npm run test:all -- --runInBand；git diff --check；AGENTS.md DOM scan；同构建Desktop/iOS | 每阶段所需门真实通过，版本/续写/保存/重开可用 | 相关source/tests/fixtures/config/dependency/build改变 |

按现有Jest分组选source/tooling/artifact；artifact先build。上表简称实施时对应实际文件，不把漏跑suite算PASS；新增对抗用例放既有相关suite，不建设通用eval平台。默认不额外收coverage，发布门另行执行。

`make deploy`复用其lint/build/full Jest；已满足当前输入所有条件才用deploy-current。iOS需授权的设备/测试库和加载身份，Linux源码不替代。P0仅用合成非敏感资料；缺API/发送授权/设备记录门未完成，继续独立工作。

真实案例包含本例、已有作品后新咨询、仅当前笔记、禁网、引用/否定、跨轮更正、旧Memory摘要、建议+起草、风格撤销、body似完整但调用未闭合。mock证明机制，真实模型证明样本行为；结构完整不等于作品质量完整。

2026-09-09补充的必测案例与预期（沿用现有suite，不建设独立eval平台）：

| Scenario | Expected behavior / traceability |
| --- | --- |
| “只用当前笔记，帮我写一篇博客”，有个人偏好、旧经历及已授权同场景风格 | 当前笔记供内容事实；偏好/风格帮助表达，旧经历不伪装为笔记事实，不擅自新增检索；AC-03/04/09 |
| 同上并明确“不要联网” | 保留个性化背景且零新增Web访问；AC-03/04 |
| 本次明确不用已记住风格，或生成前撤销/Forget | 当前要求与真实撤销优先，不影响其他仍有效能力；AC-04/09 |
| 助手给出三个方案后用户说“采用第二个”，跨轮又更正其中条件 | 还原助手方案、保留最新更正，不因新增范围机制丢失对话；AC-03/04及DEC-032 |
| 旧会话无scope记录，旧摘要含其他笔记事实 | 有证据地续接并区分材料用途；受排除内容不经摘要/cache/fallback重新带回；AC-03/04 |
| 默认学习开启后同时出现个人事实与“这次短一点”，随后保存/局部改稿 | 独立真实陈述按治理处理；本次约束/AI正文不自动成为长期风格；AC-10及B-135/AC-17 |
| 新安装、缺省旧配置、主动关闭/暂停、单项恢复及重载 | 当前有效默认真实进入调度/准入，关闭不被复活、不伪造确认；迁移、设置与组合证据均由B-135 Tracker承接，映射AC-09/10/17 |

### 9.1 本轮已取得的证据

2026-09-08，源码输入为§2基线，无runtime/tests/config/dependency修改：

- 原故障App只读投影：精确requestId/runId、loaded version、836字符recovery尾部、5个assistant轮次及8个工具结果；见§2.1。这是原事件取证，不是新版本smoke或完整原始SSE记录。
- `npm test -- --runInBand __tests__/pa-agent-loop.test.ts --testNamePattern='soft deadline|finalization reserve|wall-clock expiry|timer fires mid-stream|pending text with a warning|resets assistant idle|provider errors after visible text'`：1 suite / 11匹配用例PASS，73跳过，3.654秒自然退出。
- `npm test -- --runInBand --runTestsByPath __tests__/pa-agent-stream-fallback.test.ts __tests__/b129-multimodal-runtime.test.ts --testNamePattern='yields stream chunks unchanged|rethrows mid-stream failures|retries streaming as invoke|does not promote legal JSON|counts full text' --no-cache`：2 suites / 8匹配用例PASS，52跳过，5.386秒自然退出。
- `/tmp`临时离线probe直接调用未修改的runtime/loop，以合成JSON验证3种当前机制：硬期限拒收闭合尾、已收到stop但尾部报错导致完成事件丢失、数组text归并插入换行破坏JSON。`node node_modules/jest/bin/jest.js --config /tmp/pa-b135-diagnostics/probe.config.cjs --runInBand`：1 suite / 3用例PASS，1.032秒自然退出。它们描述当前缺陷，不是修复后的验收；实施时将最小对照提升到现有suite，不依赖临时文件长期存在。
- 没有新的真实provider请求、重现耗费、插件构建或部署。上述source用例及合成probe不证明新native方案、性能或设备验收通过。

## 10. Compatibility, Rollback And Scope Control

- 现有模型/provider能力矩阵实际核对，沿用Chat模型，不强制另一个视觉/分类模型，不要求JSON-mode。native不可证明时可读回答/手选仅为恢复，不等于原自动能力已保持。
- 旧Chat、WritingVersion、SaveReceipt、JSON recovery及Markdown不批量重写。必要新字段最少加法，旧reader可能忽略/拒绝/丢字段，须实测。
- 不改变当前图片分支“实际交付文件、拒绝新HEIC、保存迁出”的批准边界，不恢复旧转换行为。
- 保存复用目标核对、确认、迁出及部分恢复，不授任意二进制写入。
- 回滚按受控提交保留合法版本/笔记，不重置数据。旧reader不兼容时先补reader或禁止写新格式，不能只说git revert即可。
- 不增长期双路由开关、隐形regex fallback、多套自动作品协议。P0失败要新决定。
- B-130纯JSON回答格式是相关事项，不顺带解决全部通用格式；B-129图片/iOS验收不由本方案关闭。
- 默认学习的回滚/旧值处理沿B-135 SDD与Tracker，不把所有false视为废弃值；新默认不能删除治理记录、复活Forget或重建Memory。D1回滚也不能暗中恢复已被本轮拒绝的“整类个性化先清空”方案。

## 11. Cross-Review Record

2026-09-08，产品、架构、实现三个独立lane读相同源码/契约，再互审输出、资料准入和Memory联动；主代理综合。以下是设计审查，不是运行验证。

下表保留2026-09-08审查记录。涉及bootstrap、Personal延后与统一scope的处置仅说明旧候选如何形成；2026-09-09起由§1.1和修订后的§5.1/5.2替代，不再作为当前设计指令。可靠交付、来源保真等仍适用条目继续承接。

| Finding / disagreement | Disposition |
| --- | --- |
| 换分类模型仍被required/exposure锁死 | §5.3同时去预测强制/覆盖，保留证据 |
| scope前已自动入模 | §5.2覆盖bootstrap及物理路径，额外轮次/个性化时机单列取舍 |
| native与final-only矛盾 | §5.6明确Chat纯输出例外，不重开source/action |
| 正文块与native分歧 | §4说明两种成本，综合推荐native+P0门，保留未采纳备选 |
| warning吞正文 | §6分开预览、版本、任务和保存完成 |
| 同批来源被追认 | §5.5禁混批，§6绑定生成输入快照 |
| 删除判定后丢风格或扩大样例使用 | §5.4按需上下文，治理/撤销保留 |
| 全改ordinary污染Memory | §6事实与语义候选分开，P0检查混合消息/reader，不降低授权 |
| 手选被当自动成版兼容 | §4/10不允许静默能力缩减，失败回决策 |
| bootstrap历史限制来源存在循环依赖 | §5.2明确原始用户轮与结构化约束来源、语义隔离例外及未知不放行 |
| unknown在Type A之前被过滤 | §6拆开提取输入与候选持久化，P0要求可运行的混合消息与两条准入结果 |
| P1旧写作或工具prepare形成来源旁路 | §5.2/8覆盖实际准备读取；无法分离则合并P1/P2行为验收 |
| Operations不只是schema发现变化 | §5.3/12记录实际准入变化，新增AC-13及待决定D5 |
| 只改路由/native仍会缺JSON尾 | §2补原run取证；§5.7/9独立覆盖期限、结束事件、格式、字符保真和可诊断性 |
| 误将本例解释为最后只有15秒 | 现场末轮相对133,552ms开始；§2.1明确约46秒默认剩余量与不可恢复的精确结束时刻 |
| 平台无失败被误当成JSON完整 | §2.1记录用户补充及百炼状态定义；§2.3增加逻辑run到物理provider请求关联，保留finish/结构/接收的独立判断 |
| canonical124字符与recovery836字符被误作丢包 | §2.2核对历史投影替换为提示；长度/hash证据改在转换之前采集 |

源码路径/数据流已只读交叉核对；原事件取证与离线诊断已完成。新方案P0尚未完成，native效果、参数优化成本及新版本设备行为未验证。

## 12. Decision Needed And Exit

原 D1–D7 身份已经迁移到 [B-135 Tracker Decisions](../active/unified-task-execution/tracker.md#decisions)，并增加 D8 旧值迁移、D9 全量归属和 D10 普通画像读取门。已确认范围和剩余产品选择以该表及 DEC-034 为准；本 Brief 不镜像答复队列。D4 来源语义与 D6 预算是待 P0 验证的工程设计，不能用历史 probe 替代新行为证据。

用户本次已授权建立source-verified SDD及开发任务。全部增量统一在B-135，包含涉及旧B-106/B-118/B-128/B-129/Operations的修改、迁移、回归与文档吸收；不重开旧任务，不将设置实施留给旧Tracker。上一轮误加的B-106 P4/T-14/T-15已经撤回，旧交付证据保持原义。

继续工作只需从[Feature Home](../active/unified-task-execution/README.md)与[Tracker Current Snapshot](../active/unified-task-execution/tracker.md#current-snapshot)进入，再按任务读取Plan/SDD。实施前核对实际基线、真实产品答复及P0门，不能从旧候选或旧PASS直接开始。本轮未授权runtime、真实provider、部署、Git交付或发布。

本Brief继续保留原事件和候选取舍的独有证据。结论充分吸收后按生命周期处置，不为建立SDD提前丢失故障证据。
