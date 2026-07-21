# PA Insight Enhancement Layer Product Spec

Document status: Approved
Updated: 2026-07-21
Work item: B-119
Decision: [DEC-022 — 以有界、来源支持的 AI 层增强 Graph、Pattern 与 Maintenance](../decisions/dec-022-bounded-insight-enhancement-layer.md)
Scoped decision: [DEC-023 — Pagelet provider 首次使用采用共享非阻断通知](../decisions/dec-023-shared-pagelet-provider-first-use.md)
Authority: B-119 Graph、Pattern 与 Maintenance AI 增强的用户行为、信任、成本、持久化和写入边界

## Problem And Product Outcome

- User problem: 现有 Graph、Pattern 与 Maintenance 能发现结构事实，却经常只能说
  “共享标签”“关键词相似”或“建议整理”，没有解释笔记在内容上为什么相关、哪里
  冲突、维护建议为什么可信。
- Product outcome: 保留快速、确定的结构结果，再用一次有界 AI 运行补充来源支持的
  语义解释和少量遗漏候选；用户可直接忽略，也可沿既有路径深入或明确采取动作。
- North Star fit: 让用户自己的笔记因真实语义关系自然返回；AI 负责解释和连接，不
  替用户制造新的写作结论、管理队列或未经确认的 vault 变化。

## Scope

### In Scope

- B-119/REQ-01: Pattern Detection 在现有自动触发、冷却、Focus Mode、Pagelet 和
  主动提示条件都满足后，才进行后台 AI 增强。先完成现有结构检测；本地候选 corpus
  保持最近 14 天、最多 80 篇 eligible notes，provider 每次最多接收其中 12 个有界
  来源摘录，使用最多一次 generation call 与 `4K input + 1K output` 上限。现有
  pattern 可得到一句不覆盖原 summary/type/sourceRefs 的 `semanticInsight`；额外
  semantic pattern 使用独立类型，最多 3 条，每条至少引用 2 篇原始笔记。即使结构
  patterns 为空，只要 eligible corpus 达到现行门槛，仍可寻找结构检测遗漏的候选。
- B-119/REQ-02: Graph Discovery 保持用户主动运行和当前局部范围。结构/VSS 只用于
  本地缩小候选，最多向模型发送 12 个有界来源摘录，使用最多一次 generation call
  与 `8K input + 2K output` 上限；结构 item 在前，AI 新 item 最多 5 条在后。VSS 未
  就绪时跳过新的语义候选发现，不触发 Memory prepare/rebuild，但不影响结构结果或
  对已有来源的有界解释。输出只使用现有四种 item 类型，semantic similarity 不能
  压过用户 link/tag/folder 结构或单独证明关系。
- B-119/REQ-03: Maintenance Review 保持用户主动运行。规则 scan 先在本地缩小候选，
  最多向模型发送 12 个有界来源摘录，使用最多一次 generation call 与
  `8K input + 2K output` 上限。AI 可以给出标题、相关笔记和目标文件夹建议及理由，
  但必须保存在与 executable proposal 分离的 display-only overlay；只有 allowlisted
  existing folder 建议经用户选择后，才能重新通过现有路径、Data Boundary 和 stale
  校验形成 move preview，再由用户明确 confirm/apply，并继续使用现有 undo。AI
  title/link 建议没有 apply path。
- B-119/REQ-05: 配置 AI provider 后，三项 capability 默认开启并分别可关闭；复用
  Pagelet 共享首次非阻塞通知。三类结构结果先生成且始终独立可交付；provider 不可用、
  返回空/畸形、低证据、超时、取消、预算耗尽或 capability 关闭时，安静回退且不制造
  AI-ready/nudge。标准有界运行不弹阻塞式授权；广范围、敏感、高成本、whole-vault、
  超出默认 envelope 或临时包含 excluded scope 的运行必须先显示 scope、provider/
  可能成本、关闭入口并提供 `run / adjust / cancel`。若第一次实际 Pagelet 调用就是
  该高风险运行，用户明确 Run 且调用即将发生时，此完整 blocking disclosure 同时完成
  shared first-use，不追加第二条 notice；Cancel/close/未完成的 Adjust 不改 shared flag。
  后台 Pattern 和手动 Graph/Maintenance 使用
  不同的硬预算 bucket；generation 与 embedding/VSS provider calls 分别记录实际次数
  和成本。
- B-119/REQ-06: AI 只接收经过 Data Boundary 过滤、按预算截断的来源和结构结果；
  输出 path 必须精确匹配本次 allowlist。增强内容默认 session-only、只读、来源可打开
  且可忽略；查看、关闭、dismiss 或没有操作都不创建 Review Queue、Saved Insight、
  Memory、Graph edge、Maintenance action 或 Markdown。只有用户明确 `Keep / Later`
  才走既有 [Saved Insight](./pa-saved-insight-ledger-product-spec.md) 合同。三项增强只进入
  现有 Panel/Tab/Bubble，不新增顶层导航或 Writing section；跨 feature 只传去重 ID、
  结构类型与 source identity，再从原笔记重新取证，不把派生结论当来源。

### Non-goals

- NG-01: 不在 B-119 实现 Writing Insight、30 天写作趋势、周级 Statistics 分析或新
  Tab section；该方向见 [Backlog B-120](../../backlog.md)。
- NG-02: 不用 LLM 替换结构检测，不让 AI item 排在结构 item 之前，不做 whole-vault
  knowledge graph、ontology 或递归探索。
- NG-03: 不持久化完整 provider output、prompt、来源正文或 hidden AI overlay；不让
  未经 Keep 的建议影响 Graph rerank、Memory 或后续模型上下文。
- NG-04: 不授权 AI 直接 rename、link、create、rewrite、batch move、修改 frontmatter
  或执行其他 vault mutation。
- NG-05: 不新建 feature-specific provider authorization、首次通知或平行 Data
  Boundary store，不改变现有 excluded scope 与生成笔记政策。
- NG-06: 不承诺 release 版本、stable/beta 发布或外部同步。

## User Flow And States

### Pattern：安静的后台叠加

Pattern 只在现有父级自动路径本来就会运行时增强。结构模式先完成；若 capability、
预算或 provider 不可用，用户最多看到原有结构模式，不出现错误债务。增强成功时，
Bubble/Tab 在相同来源旁补充一句“为什么这些笔记真正相关”，最多再给出 3 条有至少
两篇来源的语义模式。Focus Mode、父级主动提示关闭或冷却未到时不运行。

### Graph：主动探索

用户运行现有 Graph Discovery。PA 先显示或准备结构结果，再以局部来源补充语义关系、
冲突说明、主题演变或 index 候选理由。用户能打开每个来源；忽略不产生 edge 或队列。
VSS 不可用时结果仍可为 structural-only。若未来选择更广范围，先经过逐次披露。

### Maintenance：主动查看与有界动作

用户运行现有 Maintenance Review。AI 标题、链接和文件夹建议以预览 overlay 出现，
不覆盖原 proposal，不自动写入。标题/链接建议只能查看；文件夹建议只有通过现有路径、
目标和 stale/boundary 校验形成 move preview 后，才显示确认动作。确认后的 move 可沿
现有记录撤销；取消、忽略或校验失败保持 vault 不变。

### Empty / Error / Disabled

没有高质量新增内容时不使用模板文本补位。错误、取消、预算耗尽或 disabled 都保留
结构结果，并只在需要用户处理时使用普通产品语言提示；不显示 provider/VSS 内部术语
给普通用户，也不伪称后台仍在运行。

## Trust, Data And Authority

- Source evidence: 每个 AI item 至少有原始 vault source refs；semantic similarity
  只是候选信号，不等于关系或冲突事实。
- Data sent / stored: 只有经 Data Boundary 允许、经本地筛选和预算截断的摘录可发送
  给配置的 provider。完整增强结果默认只在 session 内；仅保存必要的内容无关
  rate/cost/terminal diagnostics。
- User disclosure / confirmation: 首次使用复用 Pagelet 非阻塞 provider 通知；
  broad/sensitive/costly/excluded override 逐次确认。provider 配置不等于写权限。
- Reversibility / recovery: 忽略或 dismiss 无状态；Keep/Later 可按既有合同撤销或清理；
  只有明确 apply 的 move 改变 vault，并继续使用现有 undo 和 boundary/stale 检查。
- Authority: [North Star](../pa-product-north-star.md)、[Data Boundary](./pa-data-boundary-product-spec.md)、
  [DEC-023](../decisions/dec-023-shared-pagelet-provider-first-use.md)、
  [Graph Discovery](./pa-lightweight-graph-discovery-product-spec.md) 与
  [Saved Insight](./pa-saved-insight-ledger-product-spec.md) 的共享规则优先；B-119 不扩大
  archived Maintenance/Trust proposals。

## Acceptance Criteria

- B-119/AC-01: 三类路径在 AI disabled、provider missing、empty/malformed、timeout、
  abort 和 budget exhausted 下都返回与 AI 前相同的结构结果，且不产生新持久状态。
- B-119/AC-02: Pattern 每轮不超过 12 个来源摘录、一次 generation call、4K+1K；
  semantic pattern 不超过 3 条且每条至少 2 个可打开 source refs。父级触发条件任一
  不满足时 generation call 为 0。
- B-119/AC-03: Graph 标准运行每轮不超过 12 个来源摘录、一次 generation call、
  8K+2K；AI 新 item 不超过 5 条并排在全部结构 item 后。VSS 未就绪时 generation 可
  只解释已有结构来源，新的 VSS 候选数为 0。
- B-119/AC-04: Maintenance 标准运行每轮不超过 12 个来源摘录、一次 generation
  call、8K+2K；AI title/link/folder 都先作为 preview overlay，未确认时 vault write
  次数为 0。
- B-119/AC-05: 只有 AI folder 建议可以转换为合法 move preview；明确确认后最多执行
  所选 move，并可通过现有 undo 恢复。AI rename/link/create 或其他 action 均被拒绝。
- B-119/AC-06: 三项 capability 默认开启且分别可关闭；共享首次通知只出现一次，
  不创建 B-119 专属 authorization state。broad/sensitive/costly/excluded override 在
  affirmative action 前 generation/embedding provider call 均为 0；若其 affirmative
  Run 形成全局首次实际调用，完整 blocking disclosure 在 provider seam 设置 shared
  flag 且额外 notice=0，Cancel/close/未完成 Adjust 的 flag mutation=0。
- B-119/AC-07: 自动与手动 budget bucket 相互独立；每次实际 generation 和
  embedding/VSS provider call 都能按 feature、run kind、attempt 和 terminal outcome
  归因，额度耗尽不消耗额外 slot。
- B-119/AC-08: Graph、Pattern、Maintenance 的 Panel/Tab/Bubble、payload clone、重开
  和中英文渲染都保留 AI 文本与 source refs；切换 note、关闭 view、plugin unload 或
  新 run 取代旧 run 后，迟到结果不能恢复过期内容。
- B-119/AC-09: 查看、关闭、dismiss 或无操作时，Review Queue、Saved Insight、
  Memory、Graph edge、Maintenance action 和 Markdown 的新增数均为 0；只有明确
  Keep/Later/apply 才进入对应现有合同。
- B-119/AC-10: Feature 联动测试证明只传结构/去重元数据，并在最终 claim 中重新引用
  原笔记；把 AI claim 当作 source 或缺少 source refs 的结果必须被丢弃。

## Open Decisions

无产品决策阻塞。精确小时/日 hard caps、模型调用 adapter、ephemeral DTO 和取消/并发
协议属于实现 SDD；它们必须在 runtime coding 前批准，且不得弱化本文预算和信任上限。

## Delivery Handoff

- Active Package: [B-119 Insight Enhancement Layer](../../development/active/insight-enhancement-layer/README.md)
- Engineering handoff: [Codex Handoff](../../development/active/insight-enhancement-layer/handoff-codex.md)
- Architecture contracts: [Pagelet Product Design](../pagelet-product-design.md),
  [PA Data Boundary](./pa-data-boundary-product-spec.md),
  [Lightweight Graph Discovery](./pa-lightweight-graph-discovery-product-spec.md),
  [Saved Insight](./pa-saved-insight-ledger-product-spec.md)
- Prior discovery: [Accepted Discovery Summary](../../development/active/insight-enhancement-layer/discovery.md)；
  原路径迁移见 [Disposition Log](../../archive/disposition-log.md)
- Historical external source: [SLA-11](https://linear.app/slateleaf/issue/SLA-11/规划-b-119-洞察增强层graph-pattern-maintenance)；仅作来源记录，不再同步
- Release / rollout boundary: 当前仅建立计划型 Active Package；无 runtime、commit、
  push、tag、beta/stable release 授权。
