# DEC-034 — Unified Agent Task Execution

Decision ID: DEC-034
Status: Accepted
Updated: 2026-09-12
Authority: Owner 于 2026-09-08 确认主 Agent 语义决策和统一写作方向；2026-09-09 明确默认学习与个性化边界，并要求建立 SDD、将全部新增工作归 B-135。Accepted 仅覆盖本文件明确列出的已确认产品选择，不将待决机制或实施视为获批。
Work item: B-135

## Context

“我好久好久没有写博客了，你有什么文章话题的建议吗？”被本地关键词识别成写作，进入最终文本 JSON 协议；原 run 在硬期限结束时 JSON 未闭合，可读内容被恢复提示替代。故障、源码事实与未知项见 [Solution Brief](../../development/discovery/pa-agent-unified-task-execution.md#2-baseline-and-evidence)。该证据不证明 native 协议、当前 provider 正常结束或新默认已经实现。

PA 的个性化来自对用户的持续理解。只用当前笔记取材，不应同时关闭个人画像、既有 Memory 和已授权风格。默认能力也不应要求用户先逐项管理开关；这与 [North Star](../pa-product-north-star.md) 的透明告知及独立退出一致。

## Options Considered

| Option | Benefits | Costs / risks | Disposition |
| --- | --- | --- | --- |
| 补关键词或独立模型先分类 | 改动局部 | 语义与路径继续割裂；独立分类增加固定调用 | 用户已选择由主 Agent 理解任务，不采用 |
| 主 Agent 理解咨询、取材、写作和续写，宿主校验执行事实 | 复用上下文，减少模式管理 | 需重构真实准入与作品完成边界 | 已确认产品方向 |
| “只用当前笔记”先清空所有个性化背景 | 首轮输入易收窄 | 丢失 PA 差异化与对话连续性 | 2026-09-09 明确拒绝 |
| 两项学习默认关闭、分别主动开启 | 启用动作明确 | 基础能力需额外设置 | 原决定已被本次选择覆盖 |
| 两项学习默认开启、分别退出 | 功能按需可用 | 须迁移真实准入，保护真实关闭/暂停 | 2026-09-09 已确认 |
| native 纯作品输出及 Chat 收尾输出例外 | 正文与解释分离，复用工具参数边界 | 需要 provider、增量预览与 reader 兼容证据 | Owner 2026-09-09 明确选择；兼容验证通过后切换 |

## Decision

### Confirmed product scope

1. 模型在同一主 Agent 中理解语义并选择任务路径，不保留关键词强制分类或新增独立任务分类调用。现有必要摘要、query rewrite、rerank 不因此删除；provider/model/thinking 选择不改变。
2. “只用当前笔记”限定本次任务取材，保留有效个人画像、既有 Memory、已授权且匹配场景的风格及获准历史。不得擅自扩展新检索，也不得把其他笔记事实包装成当前笔记内容。明确禁用、排除、遗忘和本次风格要求继续有效。
3. 长期记忆提取与本地习惯学习分别默认开启，首次透明说明，可分别关闭、暂停和管理。实际触发仍受已有调度、预算、来源、治理及高后果权限约束。默认策略不能伪造用户确认或 confirmedAt；不联动 includeVaultInsights、联网或写入权限。
4. 生成、局部编辑、保存与本次指令不自动成为长期风格。读取既有 Memory、使用显式授权风格与收集新长期记忆是不同准入；不得把提取开关误当作风格授权。
5. 保留可读回答、正文与说明分离、确切作品版本、显式保存及原有图片/来源/恢复能力。完成证据、传输结束与格式校验分别判断；可靠性修复不依赖 native 协议被采纳。
6. 本轮全部增量由 **B-135** 完整跟踪，包括旧 B-106 设置、B-118 习惯治理、B-128 会话连续性、B-129 写作/图片、Operations 相关接缝。原任务的交付与 closeout 证据保留，不新增旧任务阶段或重开状态。

### Dated choices and implementation boundary

2026-09-12 D14 补充决定：当前Qwen真实对照中，原逐字提示在新旧协议均删去同样的行标签/引号，明确正文边界后两者均正确。Owner明确答复“接受分开评估，F-20 继续跟踪（推荐）”：F-20作为尚未解决的模型质量问题保留，不再单独否决专用作品通道的兼容性评估。协议、来源、增量预览、完成证据与App门仍必须通过后才切换默认；不得将该决定写成原提示逐字输出PASS，也不批准立即切换或减去其余验收项。全部证据与后续仍归B-135/T-03/T-20。

2026-09-12 D15 补充决定：Owner明确答复“接受D15建议”。DeepSeek `deepseek-v4-pro`在同一明确正文样例中通过native输出时把中文弯引号改为ASCII直引号，而旧协议保留弯引号；两条传输都把provider正文逐字交付为artifact。该单样例差异作为模型质量限制记录，保持已经通过兼容与Desktop门的native默认，不增加自动fallback、运行时双协议或DeepSeek特判。F-23据此完成处置但保留原始失败证据；不能把传输保真写成模型逐字质量通过，也不据单样例推断稳定质量率。

2026-09-12 D13 补充决定：Owner 对重开后旧作品来源记录不足的处理明确选择“保留明确确认后的人工恢复（推荐）”。在现有恢复窗口说明“旧来源记录不完整”，由用户点击“确认并恢复为 AI 草稿”；不另增第二个弹窗。已确认撤销或失效的来源仍拒绝恢复，不能用该确认覆盖失败的来源检查。保留原有AI来源、局部编辑归属及学习限制，不把确认恢复当作风格学习、来源重新授权或旧来源已完整核验的证明。完整生成凭据缺失与已知失效分别处理；实现及验证归B-135/T-18。

2026-09-10 D12 补充决定：Owner 对旧助手回复混有已撤销来源事实与仍有用方案、且无段落级来源记录的兼容取舍明确答复“接受，仅排除受影响的旧回复”。仅将可证明受影响、无法可靠拆分的该条助手回复暂时排除出后续模型输入；界面原文不修改，其他用户消息与助手回复继续保留。相关资料重新获准且来源有效时可恢复使用。完整历史与派生摘要采用同一准入，不能通过旧摘要复活该回复；没有来源metadata的旧对话不能因此统一清空。实现和验证全量归B-135/T-14，批准不代表工程验收通过。

2026-09-09 补充决定：Owner 选择“采用专用作品通道，兼容验证通过后切换（推荐）”。同一主 Agent 可在最终阶段直接交付一个作品，无需额外一轮完成回复；纯输出不取得新增取材或动作权限。T-03 必须先验证当前模型、增量预览、完成证据及旧 reader 兼容，失败时停止切换并重新讨论。此次确认不代表技术验证完成。

2026-09-09 D5 补充决定：Owner 同意将 Operations 提议判断交给同一主 Agent，替代本地操作意图规则；保留当前 vault 的启用门、四个核心工具、逐次确认、目标变化检查、取消、Undo 和审计。准备操作时的读取仍受本轮来源限制。模型理解不清时应澄清，提出方案不等于获准写入；全部增量由 B-135/T-15 承担。

2026-09-09 D8 补充决定：Owner 明确“默认开启，旧的false如果不是明确用户关闭也设置为开启”。长期提取与习惯学习分别迁移：无明确用户关闭证据的旧 false（含来源不明）采用新默认开启；明确关闭或有效暂停保持原状态，不额外询问。该选择覆盖先前保留未知 false 关闭的推荐；未知记录仍是未知，不标为用户同意或伪造 confirmedAt。迁移后用户明确关闭必须在后续 load/save/reload 保留，不反复重启能力。迁移本身不触发额外提取、回填或整库重建，验证归 B-135/T-08/T-09。

2026-09-09 D10 补充决定：Owner 同意拆开停止新提取与使用已有画像。关闭或暂停长期记忆提取只停止新学习；已有有效画像仍可用于后续模型输入，继续受 Memory 主开关、来源有效性、治理、排除、遗忘及预算控制。删除/遗忘内容或关闭 Memory 后按相应边界停止使用，显式风格维持独立授权与撤销。设置说明须清楚表达停止学习不等于停止使用已有背景，实现与验证归 B-135/T-11。

本轮产品选择队列已完成，真实答复及工程验证依赖见 [B-135 Tracker](../../development/active/unified-task-execution/tracker.md#decisions)。更严格的自然语言“首个请求前不得发送某类上下文”仍须明确其可实现边界，不能发送后声称未发送；如工程验证要求新增交互或改变产品范围，另提交具体选择。

本次请求为 SDD 设计与任务制定，执行授权及既有实现证据由 Tracker 记录；此次产品答复不代替真实 provider、部署、Git 或阶段验收证据。SDD 中未确认的产品选择不因文档整体状态而成为实施依据。

## Scoped Supersession

- 本决定承接 2026-09-09 对 [DEC-033](./dec-033-simple-settings-and-unified-defaults.md)、[DEC-005](./dec-005-memory-governance.md)、[DEC-021](./dec-021-evidence-led-pagelet-ui-ux-hardening.md)及对应设置/习惯 Product Spec 的默认学习修订。旧默认关闭验收是历史事实；新增迁移、实现与组合验收归 B-135/REQ-17、AC-17。
- [DEC-030](./dec-030-multimodal-chat-image-copywriting.md) 的作品、图片、保存与风格产品边界保留。文本JSON输出已在兼容验证后由native作品通道替换为生产Chat默认，旧reader继续保留；D15不引入自动fallback或provider特判。不扩大支持媒体范围，不改动B-132/B-133的延期边界。
- [DEC-032](./dec-032-context-reliability-and-conversation-continuity.md) 的完整原文优先、有来源摘要和长期 Memory 独立继续有效。B-135 修改相关接缝并独立补证据，不重新开启 B-128。
- [DEC-014](./dec-014-defer-operations-agent.md) 的 vault opt-in、四个核心工具、逐次确认、stale-safe、Undo 和审计保留。语义提议按上述 D5 补充决定调整，不扩大执行权限。

## Consequences

- Product behavior: 用户无需选择写作模式；保留个性化，减少错误取材和重复检索；新默认仍有明确退出。
- Architecture / data / safety: 主 Agent 解释语义，宿主保有真实身份、来源、权限、完整性、预算和保存职责；不声称宿主能够独立证明模型对自然语言的理解。
- Compatibility / migration: 新旧 settings、Chat、recovery、版本和 provenance reader 必须分别验证；迁移不改源笔记、不触发额外提取或整库重建。
- 2026-09-09 Owner 确认新学习来源凭据采用明确格式版本：降级旧版时保留治理库数据，暂停旧版对该库的读取、确认和恢复；重新升级后恢复使用，原笔记不修改。接受旧版暂不能操作该治理库的兼容边界；旧插件保存与 legacy 画像路径仍需实测，不能将未知版本拒绝视为全链安全证明。新增实现及回归由 B-135 承担。
- Work created: [B-135 Active Package](../../development/active/unified-task-execution/README.md) 是唯一新增工作入口。保持旧任务过程文件原状；稳定契约使用本决定的有日期修订链接。

## Revisit Trigger

当前支持 provider 无法可靠交付/预览作品；任务事实与个性化背景仍混淆；旧值无法安全迁移；默认开启引发超出既有预算或权限的行为；明确退出/撤销被绕过。出现时停止受影响 slice，保留已读内容与既有数据，带证据重新决定，不静默降级产品能力。

## Traceability

- Discovery: [B-135 Solution Brief](../../development/discovery/pa-agent-unified-task-execution.md)
- Product Spec: [Unified Agent Task Execution](../specs/pa-unified-task-execution-product-spec.md)
- Architecture / SDD: [B-135 SDD](../../development/active/unified-task-execution/sdd.md)
- Execution: [B-135 Tracker](../../development/active/unified-task-execution/tracker.md)
