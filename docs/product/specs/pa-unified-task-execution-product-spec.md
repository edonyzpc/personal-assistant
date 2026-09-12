# Unified Agent Task Execution Product Spec

Document status: Current
Updated: 2026-09-12
Work item: B-135
Decision: [DEC-034](../decisions/dec-034-unified-agent-task-execution.md)
Authority: B-135 已确认产品边界的当前记录与目标验收索引；未决产品变化在下方隔离，不属于已批准实施范围，当前实现与验收状态只以Tracker为准。

## Problem And Product Outcome

用户自然表达咨询、找资料、写作与修改目标。PA 结合已有用户背景与获准对话理解任务，按需要取材，提供可读回答或可独立保存的确切作品，不因关键词误分类、不因交付结构失败丢掉已收到的正文。

遵循 [North Star](../pa-product-north-star.md)：无需管理任务模式，旧笔记按需返回；生成不自动保存，保存不自动学习风格。两项学习默认工作且独立退出，仍以实际治理与触发控制成本和后果。

## Scope And Acceptance Criteria

沿用 Discovery 的 REQ/AC-01–16 身份，新增 REQ/AC-17 统一承接默认学习全部增量。表中行为是目标验收；产品已选范围以 DEC-034 为准，待决机制不授予实现权限。REQ/AC-13 的语义提议变化已由 Owner 于 2026-09-09 确认 D5，保留现有启用、工具范围、来源与执行保护，实施验证归 T-15。

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
| B-135/REQ-11 — 兼容与回滚 | B-135/AC-11：旧聊天、JSON recovery、版本、图片、SaveReceipt可用；模型/Desktop/iOS能力不静默缩减；新学习来源凭据采用明确格式版本，降级旧版时保留治理库并暂停其读取/确认/恢复，重新升级后恢复使用，原笔记不修改；旧reader及保存/legacy路径验证后才声明可回滚 |
| B-135/REQ-12 — 质量与成本可复核 | B-135/AC-12：同输入记录结果、调用序列、结束原因、耗时及可得usage；无独立分类模型；额外准备轮如实记录 |
| B-135/REQ-13 — 操作提议按用户目标 | B-135/AC-13：现有 opt-in/core tools 内，普通咨询不主动产生写入卡片；明确请求可提出方案；关闭、未确认、取消均不写入 |
| B-135/REQ-14 — 结束事实与格式分开 | B-135/AC-14：区分宿主deadline、provider length、正常stop但格式错误、finish后尾部异常及缺失finish；后续usage/EOF不抹掉已取得结束证据，native同样需完整校验 |
| B-135/REQ-15 — 共同预算内可靠收尾 | B-135/AC-15：统一绝对截止起点，取材/准备/思考/交付共享预算；已开始的正文/作品不因软过渡被丢弃重答，硬期限/取消不延期；禁止late工具及多次收尾重试 |
| B-135/REQ-16 — 故障能按原run定位 | B-135/AC-16：投影前保留无正文的最小阶段与终止证据，说明unknown与实发限额；可区分“生成不完整”和“只缺usage/尾部结束”，不新增默认全文日志或上传 |
| B-135/REQ-17 — 默认学习与兼容迁移 | B-135/AC-17：长期提取、本地习惯学习新默认均开启，首次透明说明；旧 false 无明确用户关闭证据时（含来源不明）迁移为开启，明确关闭/有效暂停保持原状态，不额外询问；迁移只执行一次，后续明确关闭及 11/10/01/00、独立暂停/恢复、load/save/reload 保持真实状态；默认在真正触发时通过准入，显式退出零新增收集，不伪造 consent/confirmedAt；修改默认/迁移/通知本身不启动额外提取、回填或整库重建，不联动 includeVaultInsights 或高后果权限 |

### Scope interpretations

- “只用当前笔记”：当前笔记承担任务事实；个人画像、已存 Memory、有效风格可用于理解用户、组织和表达。它不授权把其他笔记事实当作当前笔记事实，也不自动授权新 vault/web 搜索。
- 既有笔记 Memory 与显式风格使用保持各自准入，不误绑新提取开关。按已确认 D10，普通已存 Personal 的读取与新提取解耦：关闭/暂停提取只停止新学习，已有画像仍可进入后续模型请求。Memory 主控制、治理、来源、排除、遗忘、场景匹配与预算仍适用；设置说明明确两者差别，覆盖实际输入、保存失败与重载验证。
- 真实宿主输入限制在每个物理 provider 请求前生效，覆盖 retry、summary、rewrite、旧工具结果及其派生摘要。保留获准历史完整原文；超限才使用有来源摘要和近期原文，不退回只看本轮或只保留用户轮。
- D12（Owner 2026-09-10确认）：旧助手回复混有已撤销来源事实和方案且无法可靠拆分时，仅将受影响的该条回复暂时排除出后续输入，界面原文和其他消息保留；来源重新获准且有效后可恢复。摘要同样排除，不按缺少新metadata统一删除旧会话。此兼容例外由B-135/T-14验收。
- 本轮局部“不要模仿以前风格”是输出用途要求；首个 provider 请求前“不要发送某类背景”是不同能力，不可事后声称已阻断。后者的支持范围仍为设计待决项。
- 首版每轮至多一个作品。多篇请求可组织为一份分节组合正文；不静默丢掉用户请求的内容，不新增独立多作品管理平台。
- 原 B-106/B-118/B-128/B-129/Operations 契约中仍有效的约束作为继承边界。本次新增修复、迁移与回归全部由 B-135 Tracker 承担，不重开旧任务。

### Non-goals

- NG-01: 不新增独立任务分类模型，不替换 provider/model/thinking，不承诺静态测试能证明真实模型质量或速度改善。
- NG-02: 不重做 VSS 算法、自动 Memory 维护、Pagelet 自主调度，不扩大网络/写入权限。
- NG-03: 不改变图片原字节、格式、保存和 B-132/B-133 延期边界；不批量重写旧 Chat、作品、治理记录或源笔记。
- NG-04: 不默认开启完整 prompt/response 日志或上传遥测，不另建通用 Agent、任务恢复或事件存储平台。

## User Flow And States

1. 用户输入目标；PA 保留有效个性化与对话，已有资料足够则回答，需要资料时按目标及边界取材。
2. 咨询保持普通回答；明确创作/修改交付可出现作品预览，正文与解释区分，流式中断保留已收到内容并给出真实状态。
3. 只有完整、身份和来源有效的作品成为版本。截断、取消、格式错误或来源失效不得显示为已成版；人工恢复仍保留 AI 来源，不能自动转换为用户原始资料。
4. 用户选择历史版本、继续修改、复制或显式保存；保存精确所选正文和图片，不为保存再次生成。保存失败保留版本与恢复入口，完成/部分完成按真实 receipt 显示。
5. 两项学习正常按需运行；用户可分别停止新收集，管理/遗忘已有数据。显式授权风格与一次性表达要求各自有效，不把每次改稿变成习惯。
6. 预览、选择、取消、恢复、保存及设置退出按实际改动面验证。共享逻辑复用同一冻结输入的Linux/Desktop证据，移动呈现优先使用Obsidian CLI mobile simulator；只有改动涉及macOS/iOS系统集成、真实触控/软键盘、Keychain、iCloud/文件提供器、HEIC、WKWebView专属生命周期或明确平台分支时，才要求对应真机证据。无图/有图、旧会话/新会话和载入失败仍分别处理，simulator不冒充真机专属事实。

## Trust, Data And Authority

- Source evidence: 当前任务资料与个性化背景分别标注用途；输出来源冻结为生成它的物理请求输入快照，只说明实际提供，不声称模型逐条采用。
- Data sent / stored: 延用配置的 provider 和现有存储/来源边界。模型语义不构成宿主授权。引入任何新 metadata 前验证旧 reader，不默认回写历史。
- User disclosure / confirmation: 默认学习提供首次说明和独立退出；生成/复制/保存/风格授权分别处理。Operations 实际执行仍需原有 opt-in 和逐次确认。
- Reversibility / recovery: 保留已读文本、旧 recovery、版本、SaveReceipt、Undo、排除和遗忘。取消/撤销在下一次物理调用或成版前重验，不复活已失效上下文。

## Confirmed Decisions And Delivery Limits

2026-09-12已确认D16：Owner要求macOS/iOS真机只用于与平台本身强相关的改动；平台无关行为复用Linux/Desktop，移动呈现优先使用Obsidian CLI mobile simulator。B-135相对基线未新增macOS系统调用、iCloud/文件提供器、HEIC、Keychain、真实触控/软键盘、WKWebView专属生命周期、mobile writing CSS或其它平台分支；共享设置和恢复模态已在390×844 mobile simulator补证。因此B-135没有剩余真机门，T-11/T-18/T-21按适用证据完成。该结论不关闭B-129等功能自身的iCloud、HEIC、触控或设备验收，也不允许用simulator声称真机行为通过。

2026-09-12已确认D14：Owner接受将F-20的新旧协议共同模型质量问题与专用通道兼容性分开评估；F-20继续在B-135跟踪，不以明确正文范围的新样例覆盖原提示失败。协议、来源、增量预览、完成证据与Desktop验证随后通过，开发分支已切换默认；本决定本身不等于逐字生成验收通过。D16后续按实际改动面完成平台审计和mobile simulator门。

2026-09-12已确认D13：重载旧作品的来源记录不足时，在现有恢复窗口明确说明并以“确认并恢复为 AI 草稿”承接人工选择；已确认撤销或失效仍拒绝。此确认不证明旧来源完整有效、不授予重新使用来源或风格学习权限，原有AI/局部编辑归属保留。该边界共同适用于AC-06与AC-11，工程验证仍由T-18跟踪。

2026-09-12已确认D15：Owner接受将DeepSeek `deepseek-v4-pro`在同一明确正文样例中把中文弯引号改为ASCII直引号记录为单样例模型质量限制；旧协议保留弯引号，两条传输都把provider正文逐字交付为artifact。保持native默认，不增加自动fallback、运行时双协议或DeepSeek特判；保留原始失败证据，不把传输保真冒充模型逐字质量通过。

已确认的模型语义、个性化边界、默认开启及 B-135 全量归属不重复询问。Owner 于 2026-09-09 选择专用作品通道及直接终局交付，兼容验证通过后切换；同日确认 Operations 语义提议及保留执行保护、无明确关闭证据的旧 false 迁移为开启，以及停止新提取与已有画像读取解耦。D15确认后本轮产品选择均已完成；答复及工程验证依赖集中在 [Tracker Decisions](../../development/active/unified-task-execution/tracker.md#decisions)。首请求发送限制的已支持边界及物理输入证据由Tracker记录；新的产品取舍仍不得用Approved标签替代真实答复。

## Delivery Handoff

- Active Package: [B-135](../../development/active/unified-task-execution/README.md)
- Architecture contracts: [Multimodal Chat](../../architecture/multimodal-chat-architecture.md)、[Settings current status](../../architecture/settings-status.md)、[Write Action Framework](../../architecture/write-action-framework-sdd.md)
- Release / rollout boundary: 实现、provider/Desktop、390×844 mobile simulator、平台风险审计及最终统一gate均已进入B-135开发分支，Tracker状态为Validated。工作分支不是Beta源；closeout、master、Beta、tag和release仍各自需要独立授权。
