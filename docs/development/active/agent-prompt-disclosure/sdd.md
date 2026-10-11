# PA Agent Prompt Disclosure Software Design

Document status: Draft
Updated: 2026-10-11
Work item: B-171
Authority: 已确认产品范围内的 source-verified 技术设计；不是已实施架构或运行验证。
Product spec: [Prompt Disclosure](../../../product/specs/pa-agent-prompt-disclosure-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## 1. Current Source Baseline

核对基线 `5c224108cb045bdeaec557369a6bbc81e0634eac`；已有 B-170 文档修改保持。以下接口当前存在；拟新增的 canonical 字段在下文标为 Proposed。

| 当前位置 | 已核实事实与本次最小改动 |
| --- | --- |
| [pa-agent-prompts.ts](../../../../src/ai-services/pa-agent-prompts.ts) | `PA_AGENT_ANSWER_STREAM_SYSTEM_PROMPT_LINES`、`createOperationsPromptGuidance`、`formatSkillCatalog` 负责规则/目录；合并重复规则，保留调用必需语义 |
| [pa-agent-runtime.ts](../../../../src/ai-services/pa-agent-runtime.ts) | `projectPaAgentCanonicalModelInput`、`formatPlannerToolDefinitions`、`createPaAgentModelInputMetricsDiagnostic` 已负责拼装、适用范围去重与分项测量；复用而非新建管理层 |
| [pa-agent-prompts.ts](../../../../src/ai-services/pa-agent-prompts.ts) | `createPaAgentAnswerStreamPrompt`、`buildPaAgentFinalMessagesAsync`、`measurePaAgentRequestEnvelope/Async` 共用模板；条件说明必须进入实际消息和同步/异步估算，不能只改测试字符串 |
| [pa-agent-result-facts.ts](../../../../src/ai-services/pa-agent-result-facts.ts) / [PaAgentContextSummarizer.ts](../../../../src/ai-services/context/PaAgentContextSummarizer.ts) | `PA_AGENT_ACTION_STATE_CONTEXT_RULES` 同时用于主 prompt 与摘要；`PA_AGENT_EFFECT_RECOVERY_RULES` 要在撤下工具后仍保留 |
| [PaAgentContextProjector.ts](../../../../src/ai-services/context/PaAgentContextProjector.ts) / [pa-agent-action-history.ts](../../../../src/ai-services/pa-agent-action-history.ts) | 已区分 `currentProtocol`、`currentContext`、历史 entries 与 owner 状态；沿既有投影取事实，不扫描自然语言识别任务 |
| [skill-context-provider.ts](../../../../src/ai-services/skill-context-provider.ts) / [skill-router.ts](../../../../src/ai-services/skill-router.ts) | `getCatalog`、`executeLoadSkill`、`buildSkillContext` 支持完整入口与 exact reference、skill-guide 来源；加载流程不需重写 |
| [bundled-skills.ts](../../../../src/ai-services/bundled-skills.ts) / [bundled-skill-catalog.ts](../../../../src/ai-services/bundled-skill-catalog.ts) | 前者注册资源；后者用于展示/开关，最终模型目录来自 SKILL.md 元数据，不能只改展示文案声称输入已减小 |
| [chat-tool-factories.ts](../../../../src/ai-services/chat-tool-factories.ts) / [obsidian-operations-capability-catalog.ts](../../../../src/ai-services/obsidian-operations-capability-catalog.ts) | 工具描述、schema 与 plannerGuidance 已有归属；只精简说明，不改 execute、输入结构或数据覆盖 |
| [chat-view.ts](../../../../src/chat/chat-view.ts) | `imageInstructions` 混合真实 refs/versions/像素事实与教程；`selectedInstruction`、`ghostInstructions` 随当前显式绑定出现。只拆说明，不改命令激活或图片服务 |

## 2. Content Placement And Minimal Flow

`现有绑定/投影事实 → 核心规则＋必要解释＋工具声明/Skill目录 → 现有请求构造与估算 → Agent自选调用 → 既有执行链与结果投影`。

### Core and contextual explanation

核心保留完整当前任务、必要澄清、实际工具/来源、信任关系、引用与未知效果恢复；合并同义重复，不删除多意图请求、非空 query、空结果≠不可用、已受理≠完成等已有反例保护。工具撤下时仍保留通用恢复语义。

将领域字段解释与特殊历史编码说明从无条件长数组分离。优先在现有 prompt/fact 模块用简单纯函数按已经投影的 owner state、已接纳结果、真实编码元数据选择静态说明，不建规则注册器、持久缓存或自动分类器。若一小段规则难以安全分离，保留短规则，不为清零常驻领域词汇增加框架。

必要时增加一个内部模板值 `context_guidance`（Proposed）：内容只能来自上述可信事实和静态说明，在 `projectPaAgentCanonicalModelInput` 同一次拼装中传给实际 prompt 与测量函数。现有 canonical 构造、默认值、native/compat、同步/异步路径同步接线；禁止仅预算侧或仅发送侧识别该值。若能直接复用既有 `currentProtocol` 完成同等接线，则无需新增字段，两者不并存成双份说明。

解释依据同时覆盖本轮 tool result 与被投影的历史 owner 状态，包括摘要保留的确定性事实。不能只看当前工具名或当前 `actionStates` 非空，否则工具撤下/历史压缩时会漏解释。用户、网页、笔记和自由摘要正文里出现同名字段，不成为选择可信说明的依据。解码说明由投影器实际使用的历史表示决定。

主 prompt 与摘要共享通用事实语义；摘要侧保留其实际输入所需的领域解释。精简共享数组须同时检查摘要请求与最终 Chat 请求，不改变摘要专属任务/输出协议、retained facts、operation ID、版本、来源或摘要缓存策略。

### Tools and pure outputs

保留每轮 policy/export 选出的全部工具、schema 和顺序，不通过新“常用工具列表”缩窄能力。`formatPlannerToolDefinitions` 继续只在相同工具适用范围内去重；删除机械重复不把只读工具的限制变成所有动作的全局限制。

`query_notes` 半开区间、显式偏移、日期字段选择、默认完整列表与正文按需等必要语义直接可见；不要求先加载查询指南。写入 proposal/application、付费图片 plan、来源引用和确认边界同样保留短说明。

`report_task_incomplete`、`present_writing` 只有在本请求实际已绑定有效原生 schema 时才移除 system 内重复全文，保留简短输出语义；以实际 transport/binding 为据，不能仅凭接口名字推定兼容路径已携带声明。`final_answer_only` 与 Writing 协议仍按当前真实绑定工作，不新增 fallback。

当前 `actionMode: native | compat` 选择的是历史投影表达，不等于是否绑定原生工具；绑定 schemas 在 runtime 中另行导出。验证实际 SDK 请求，不能据 `compat` 字样保留一份冗余 JSON，或仅凭字符串去重认定输出协议完整。

### Skills and command/image context

| 内容 | 去向 |
| --- | --- |
| Ghost 方法 | 复用 `skills/blog2ghost/SKILL.md`；保留显式激活边界，不使普通 Chat 因加载指南获得发布能力 |
| Markdown、Canvas、Dataview、Templater 语法/案例 | 已有 Skill 与参考资料；沿 `BundledSkillResource.references` 注册，不自动拼全部 reference |
| 图片及笔记操作长方法 | 先删除重复，短必要规则留工具。若仍有需按需读取的独立长资料，可增加对应 Skill/参考入口（Proposed，沿现有机制）；不把领域执行规则塞进 Markdown Skill，不按每工具建 Skill |
| 图片当前事实 | 保留已授权 refs、版本、像素实际是否进入模型、明确来源控件等；只迁出重复方法句，不根据“无附件”推定本轮没有生图能力 |
| 显式 command | 保留本次必要目标/交付/边界，其详细方法可读；不展开所有 command，不把指导当用户新指令或固定调用序列 |

指南入口保持短且自足，深层示例放 reference；不新增字符截断。目录只列实际启用资源，Agent 决定读取，禁用/缺失指南不阻断具有完整必要说明的工具。来源仍是方法资料，不能冒充用户笔记证据。必要的领域先决条件由现有 Host/tool 保证，不依赖模型是否阅读长指南。

## 3. Ownership, Authority And Effects

沿用 [Command Architecture Contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)，本次映射如下：

| 决策/效果 | Owner | 事实依据与边界 |
| --- | --- | --- |
| 要哪些信息、何时读指南、工具/日期口径/顺序、是否交付充分 | Agent | 用户语义、有效上下文和工具观察；不设问句分类或必经步骤 |
| 工具/Skill可用范围与命令调用上下文 | 现有 Host/harness、registry/provider | 当前配置、真实激活、既有权限与来源；加载方法不扩大能力 |
| 选择字段/编码解释 | 现有 prompt/projector/fact owner | 已接纳的结构化状态与实际投影格式；不是任务规划或新状态机 |
| 参数校验、来源、截止时间、取消、迟到结果与真实效果 | 原 dispatcher/domain owner | 本任务不改变接口与运行规则；只重排模型说明 |
| 来源与 Context Used | 原结果记录和 Chat 投影 | 实际执行结果；不能把目录里出现过的 Skill 算作已读取资料 |

## 4. Compatibility, Risk And Rollback

无持久化字段、设置、schema、平台 API、Worker/WASM 或新依赖变更；无新增 observer/timer/cache 清理。现有 Chat/native/compat、Writing、最终轮及摘要都要消费同一有效规则。源码共享不代表已验证 iOS/Android；本任务无新的实机门槛，B-170 设备通过也不算本次 prompt 验证。

主要风险：迁出必要语义导致错误调用；历史/最终轮丢失 unknown-effect 边界；方法变成额外必经往返；请求估算与真实发送不一致。对应最低充分证据集中在 Tracker，不另建测试计划。

只回退 B-171 的说明/拼装/资源注册差量，保留 B-170 和无关修改；不迁移数据或用 reset/清库恢复。已部署验证只恢复预先核对的隔离 test 资产/临时设置与夹具；不覆盖私人 vault。正式提交后的回退另循 Git 授权，不改写历史。

## 5. Requirement Traceability And Validation

| Requirement / AC | 设计落点 | 最低证据归属 |
| --- | --- | --- |
| B-171/REQ-01 / B-171/AC-01 | 核心去重、无历史首轮与条件说明 | Tracker V1，真实请求差量 |
| B-171/REQ-02 / B-171/AC-02 | 工具/schema、纯输出重复与完整清单 | Tracker V1、V2 |
| B-171/REQ-03 / B-171/AC-03 | 现有完整 Skill/reference 路径 | Tracker V2、V4 的相关方法案例 |
| B-171/REQ-04 / B-171/AC-04 | 当前/历史状态、编码、命令与图片事实 | Tracker V3，最终轮/摘要及状态解释案例 |
| B-171/REQ-05 / B-171/AC-05 | 现有执行/来源链、估算一致性与真实 Chat | Tracker V3、V4、V5 |

不按 prompt 全文快照或固定工具顺序验收，不为每个 Skill、同义句、provider 和平台增加排列组合。未改动的执行/设备证据按输入有效性复用；新 prompt 的实际模型行为不冒用旧样本。

## 6. Approval

- Product authority: DEC-060；产品范围已获用户确认。
- Design status: 本次新编制技术设计为 Draft，完成源码核对和文档审查不等于用户已阅读该具体设计。
- Open design findings: 见 Tracker；当前无必须新增产品决策的已知问题。
- Authorized implementation scope: 本轮为 `sdd-only`，仅文档。用户后续授权按此方案开发时，在确认无实质偏差后更新本状态并推进，不再重复询问已确认产品选择。
