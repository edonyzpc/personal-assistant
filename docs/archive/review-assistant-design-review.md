# Review Assistant 产品设计文档 · 综合评审报告

被评审文档：`docs/review-assistant-product-design.md`（v1，Beta/Labs，Last revised 2026-05-31）
评审日期：2026-06-01
评审维度：产品 / 架构与技术 / UI/UX / 信任·隐私·发布
评审形式：4 个 subagent 并行评审 + 主线汇总

---

## 0. 一句话总评

方向正确（review-first + evidence-first + narrow write boundary 是 PA Agent 通向 action mode 的合法首战），但**身份打架、关键架构决策被错误推到「实现期」、UI 决策只到"该有什么"层级、Beta 发布缺 kill switch 与法律口径**——按现状直接进入实现会留下大量返工与技术债。建议先做一轮文档收敛再启动实现。

---

## 1. 关键发现总览（按维度 × 严重度交叉）

| # | 类别 | 严重度 | 摘要 | 文档定位 |
|---|------|--------|------|----------|
| F1 | 产品/品牌 | 🔴 | "Review Assistant 沉稳工作伙伴" vs "拾页/Pagelet 萌系吉祥物" 身份冲突 | L17-L31, L120-L135, L235-L253, L908-L928 |
| F2 | 产品/获客 | 🔴 | Pet 默认对存量用户不可见 = Beta 第一周传播钩子掉了 | L142-L144, L182-L188, L996-L1003 |
| F3 | 产品/度量 | 🔴 | Success Criteria 无 Kill Criterion，独立开发者最怕的"半成品长期挂着" | L1023-L1049 |
| F4 | 架构/写入 | 🔴 | "narrow write" 与 PolicyEngine 正面冲突，未给方案 | L756-L776, L972-L976 |
| F5 | 架构/输出 | 🔴 | Structured Output Contract 缺执行基线（无 zod / 无 withStructuredOutput / 解析失败无策略） | L588-L628 |
| F6 | 架构/工具 | 🔴 | WebSearch 复用边界含糊，要么破坏 CapabilityRegistry 契约要么需要新 review-session 上下文 | L662-L680 |
| F7 | UX/卡片 | 🔴 | Suggestion Card 塞 6+ secondary action，找不到主操作 | L382-L400 |
| F8 | UX/refinement | 🔴 | Refinement 必然滑向迷你 chat，违反 workbench 原则 | L416-L434 |
| F9 | UX/i18n | 🔴 | 中文 confidence label 写死在 schema，出海用户直接懵 | L388, L621-L628 |
| F10 | UX/布局 | 🔴 | 桌面三栏同屏在 Obsidian 默认 panel 宽度（350-500px）下不可行 | L337-L356 |
| F11 | 信任/隐私 | 🔴 | `#no-ai` / `#no-review` 兜底只有一层；Memory 取出的 related notes 未 re-filter | L491-L514, L649-L660 |
| F12 | 信任/隐私 | 🔴 | `#private` 手动 include 只 warning，应升级二次确认 | L483 |
| F13 | 信任/防伪 | 🔴 | Source ID 防伪无契约，必然出现 LLM 编造 source-id | L611-L620 |
| F14 | 信任/Confidence | 🔴 | confidence label 来源未定义，纯 LLM 自评必然 calibration 崩坏 | L388, L606, L621-L627 |
| F15 | 发布/降级 | 🔴 | 无 kill switch；无 schema 版本演进；adoption 收集口径暗示有服务端 | L1004-L1022, L792-L814 |
| F16 | 法律/合规 | 🔴 | 首次开启 Pet 缺法律口径与隐私公告，出海 C 端差评高发组合 | L182-L204 |
| F17 | 架构/Open Decisions | 🟠 | L1110-L1124 的 #4 / #5 / #6 / #9 实际上是**架构关键决策**，不能推到"实现期" | L1110-L1124 |
| F18 | 架构/持久化 | 🟠 | pending draft 在 Obsidian Sync 双端、版本迁移、累积膨胀的语义全缺 | L792-L814 |
| F19 | 架构/Memory | 🟠 | Review note 创建后会被 VSS 索引，与原始笔记产生高相似度重复 chunk，污染 search_memory | L962-L970 |
| F20 | 产品/scope | 🟠 | Custom follow-up 把 chat scope 偷渡了回来，建议砍掉 | L397-L398, L427-L432 |
| F21 | 产品/scope | 🟠 | Daily-note 识别这种跨插件长尾被塞进 Open Decisions 不合适 | L447-L457, L1116 |
| F22 | 产品/scope | 🟠 | 4 类输出固定 + 空类未说明降级策略 | L359-L370 |
| F23 | UX/收集 | 🟠 | "click-to-add 视觉化收集感"具体动画语言未定义 | L402-L414 |
| F24 | UX/提醒 | 🟠 | Pet 隐藏 / zen-mode 下 badge 等于不存在，需要 status bar fallback | L294-L305 |
| F25 | UX/scope indicator | 🟠 | 长 banner 6 个数字用户不会读 | L867-L879 |
| F26 | UX/progress | 🟠 | 7 个 stage 太细，应折叠为 3 个用户层 | L883-L897 |
| F27 | 信任/Telemetry | 🟠 | failure_category 必须 enum 化；runtime_duration 必须拆桶；refinement_action_type 缺失 | L826-L853 |
| F28 | 信任/WebSearch | 🟠 | query 构造路径未声明 content discipline（能否把 note body excerpt 拼进去） | L662-L680 |
| F29 | 兼容性 | 🟠 | Pet 浮层与 Hover Editor / Periodic Notes / Tasks / Popout / Mobile 的冲突未评估 | L322-L327, L278 |
| F30 | UX/视觉 | 🟡 | Mascot 视觉方向只有排除式描述，无正向 reference，设计师会跑偏 | L232-L252 |
| F31 | UX/a11y | 🟡 | 仅 mascot 提了 reduced-motion，collection / panel 展开未提；键盘 map 缺失 | L266, L411 |
| F32 | 产品/差异化 | 🟡 | 与 vault-QA 类竞品的差异化未点名 | 全篇 |
| F33 | 产品/命名 | 🟡 | "Review Assistant" 太通用，搜索易被淹没 | L120-L135 |
| F34 | 产品/Decision Record | 🟡 | 有冗余条目（#1/#6/#11；#16/#50）和关键缺失（配额耗尽、provider 不可用、空 vault） | L1053-L1108 |

---

## 2. 必须解决（🔴）—— 进入实现前必须收敛

### 2.1 身份冲突：Review Assistant ↔ 拾页/Pagelet（F1）

文档同时承诺"沉稳研究助手 / 禁止 cute or clingy"和"把记忆点压在 Pagelet 吉祥物上"，结果吉祥物被关在笼子里——既记不住也萌不起来。**必须二选一**：

- **方案 A（更保守）**：v1 砍掉吉祥物，主入口走命令面板 + 热键，把「证据强制 + 受控写入」做成 Beta 卖点。Pet 推到 Phase 2。
- **方案 B（更激进）**：全面拥抱 Pagelet 作为品牌主角，允许它有一点态度，承接出海 C 端的视觉记忆点；产品名考虑改为 `Pagelet — note review companion`。

**不要骑墙。** 当前文档骑墙的状态对独立开发者来说 hedge 成本最高。

### 2.2 Pet 默认对存量用户不可见 = Beta 传播钩子掉了（F2）

`feature available + pet opt-in for existing users + 默认不出现` = 存量用户**默认看不到这个 Beta**。Beta 发布的核心目的是积累早期反馈与口碑传播——这个设计直接把这条路掐了。

**改法**：command palette + 可配热键升为 v1 主入口（无论是否启用 Pet）；ribbon icon 在首次启用后默认出现一次「discover」标记；Pet 作为可选的视觉增益。

### 2.3 Success Criteria 缺 Kill Criterion（F3）

"在某周用户至少创建两次 review note" 是作者自测标准，不是产品验证标准。**必须补**：
- run → note 转化率、W2/W4 留存率、pet 主动 disable 率
- **明确的 Kill Criterion**：例如"上线 30 天，run/create < X% 或 pet disable 率 > Y%，下版本回退到仅命令面板入口；上线 90 天未达到 Z 次留存创建，整体下线"

独立开发者**最需要硬指标避免半成品长期挂着**。

### 2.4 写入路径与 PolicyEngine 正面冲突（F4）

`src/ai-services/policy-engine.ts:35-40` 硬拒 `kind === "action"` 与非 read-only/network-read。Review Assistant 是 PA Agent v1 历史上**第一次 vault write**，文档说"should not weaken read-only tool policy"但没说怎么走。两条路：

- **方案 A**：完全绕开 CapabilityRegistry，直接调 `vault.create`。后果：v1 引入第二条写入路径，未来 Operations Agent 的 target confinement / stale re-read / audit（`docs/operations-agent-plan.md`）出现"特例先例"，回头很难收回。
- **方案 B**：扩展 PolicyEngine 允许 `permission: "write" + requiresConfirmation: true`。后果：必须在 Review Assistant 上线前先实现 Operations Agent 的 preview/confirmation/target confinement 框架，scope 显著膨胀。

**必须在实现前选定，并在 `docs/operations-agent-plan.md` 同步登记**。若选 A，明确登记为「已知例外」并列入未来迁移项。

### 2.5 Structured Output Contract 缺执行基线（F5）

`src/ai-services/` 目前**全无** zod / `withStructuredOutput` / JsonOutputParser。文档定义了 schema 但没说：

- 用什么 runtime 实现（LangChain `withStructuredOutput`？手写 JsonOutputParser？）
- DashScope / Bailian / OpenAI-compatible 各 provider 对 strict JSON mode 的兼容性
- 整 JSON 解析失败的策略（重试？流式部分渲染？回退到无结构？）
- prompt 如何 schema-aware 构造

**不解决的代价**：第一版上线大概率"finding 渲染白屏 / 部分结果丢失 / 无 finding"的不可观测 bug。

### 2.6 WebSearch 复用边界含糊（F6）

`src/ai-services/builtin-web-search-provider.ts` 是注册为 PA Agent capability 的，调用入口在 `PaAgentLoop`。脱离 chat loop 的独立调用有两条路：

- 复用 `PaAgentLoop` 跑 mini-turn：runId/turnId/source-bucket/cancellation 都要正确隔离
- 直接调 `provider.execute`：跳过 `CapabilityRegistry` 的 policy/redactor/budget —— **破坏 network policy 契约**

**改法**：明确"通过 `CapabilityRegistry.execute('builtin-web-search', …)` 在 review session context 中调用"，并在 review session 里复用 `PolicyEngine` 实例。新增 `review session context` 概念到 PA Agent runtime 文档。

### 2.7 Suggestion Card 严重过载（F7）

一张卡片塞了 category + title + explanation + confidence + sources + add 主按钮 + 7 个 secondary action（ignore / open source / expand / actionize / find related / search / custom input）。在 4 个 section × N 张卡片同屏时，主操作根本找不到。

**改法**：
- 常态只露 `Add to draft` + `Ignore` + `⋯ More` 三个控件
- `⋯` 展开抽屉放 Expand / Actionize / Find related / Search / Open source
- Custom input 折叠为 "Ask about this" 入口，点开才出现输入框
- 卡片**展开态**才是 refinement workspace，常态保持极简

### 2.8 Refinement 必然滑向迷你 chat（F8）

"4 个固定按钮 + 自定义输入 + 答案可加入 draft" = 隐形 mini chat。文档自己说"should not become a persistent independent chat thread"但没给 UI 护栏。

**改法（缺一不可）**：
- 每张卡片的 refinement 历史只保留**最近 1 条** result，再次 refine 替换而非堆叠
- custom input 不保留输入历史，提交后输入框清空 + 折叠
- UI 上把 refinement 结果显示为 "Expanded view" 派生态，**不是**"对话气泡"，视觉语言强制脱离 chat

或者更彻底：**v1 砍掉 custom follow-up（F20），只留 4 个固定 refinement actions**，能省一大块测试与文档负担。

### 2.9 中文 Confidence Label 写死在 schema 与 UI（F9）

出海 C 端用户看到"较明确/可能线索/待确认"会直接懵。文档把中文 label 当 spec 写死是**产品级 bug**。

**改法**：
- schema 字段保持 `high/medium/low`
- UI label 跟随插件 i18n（英文默认 `Likely / Possible / To verify`，中文 `较明确 / 可能线索 / 待确认`）
- 不依赖颜色单通道：实心圆/半圆/空心圆 + 颜色用 Obsidian 主题 `--text-success / --text-warning / --text-muted`

### 2.10 桌面三栏同屏空间不够（F10）

Obsidian 右侧 leaf 默认宽度约 350-500px，header + 4 sections × cards + draft area "同时可见"几乎不可能。

**改法**：明确两种 layout 阈值：
- **panel 模式（< 720px）**：tab 切换 Findings / Draft，底部 sticky bar 显示 `Draft: N blocks · Preview`
- **workbench 模式（≥ 720px）**：才上左右分栏
- 文档**必须写明阈值与降级策略**，不要含糊说"medium panel"

### 2.11 `#no-ai` / `#no-review` 兜底单层 + Memory related notes 未 re-filter（F11）

设计文档只说"Excluded note bodies must not enter model input"，但没说在哪一层兜底。**必须三层兜底**：

1. candidate selection 排除
2. model-input 装配前的最终 sanitization（按 path 重新比对当前 exclusion 规则）
3. **Memory / VSS 查询出来的 related old notes 必须重新经过当前 exclusion rule 过滤**——这是最容易被忽略的泄露路径

文档 L513 后必须明确写出 "three-layer enforcement"。

### 2.12 `#private` 手动 include 应升级为二次确认（F12）

`#private` 是用户主动打的标签，warning + 默认允许是反预期。改为：confirm-modal + session-only override + 不写入持久 include list。

### 2.13 Source ID 防伪无契约（F13）

"Drop findings without source references" 只验证字段存在性，不验证 ID 是否真在 `includedSources` 集合里。Beta 第一周一定会有 LLM 编造 `src-42` 然后用户点不开。

**必须**：
- validation 强制 `finding.sourceRefs ⊆ includedSources.id set`
- UI 在 source link 旁显式展示 `L12-L18 of [[note-x]]` 或 heading anchor
- **不通过 validation 的 finding 必须 drop，不能 downgrade**（downgrade 会让用户读到无源 finding）

### 2.14 Confidence label 来源未定义（F14）

纯 LLM 自评必然 calibration 崩坏。建议**规则后处理**：
- 高 = ≥2 sources 或直接 quote 匹配
- 中 = 1 source
- 低 = 仅 TODO-line 或 keyword match

LLM 输出的 confidence 仅作为输入信号之一。

### 2.15 Beta 必备的发布基础设施（F15）

文档完全没提：

- **Kill switch**：settings 增加 `reviewAssistantEnabled`（默认 true，一键关）。出现 P0 时让用户一键禁用整个功能。
- **Schema version**：pending draft 持久化结构必须有 `schemaVersion` 字段；降级时检测 unknown version 应**保留文件 + UI 提示**，不要静默删除用户半成品。
- **Adoption 收集口径**：必须诚实写明"无服务端遥测，metrics 仅在用户开启 `shareAnonymousCapabilityUsage` 时本地可见"。当前 L1013 暗示有服务端视角，**需要修正**。

### 2.16 出海 C 端的法律口径缺失（F16）

出海 C 端 + Beta + Pet 是负面评论高发组合。**必须**：

- 首次启用 Pet 的 modal 包含"AI provider / cost / 不修改源笔记"标准文案（参考 `community-scan-remediation-plan.md` Phase 2 Memory confirmation 口径）
- README / settings 补一行 "Not intended for legal, medical, financial, or other high-stakes review."
- 若 README 隐私矩阵已存在，需新增 Review Assistant 一行（trigger / data sent / destination / background=No）

---

## 3. 应该改进（🟠）—— 进入实现前应给出方案

### 3.1 Open Implementation Decisions 错位（F17）

`L1110-L1124` 列出的"实现期再定"，其中以下 4 条**实际上是架构关键决策**，必须在 V1 启动前敲定：

| Open # | 内容 | 为什么不能推迟 |
|--------|------|----------------|
| #4 包含预算 | 决定 `Size 判定` (L568) 走 one-shot 还是分阶段，进而决定 LLM 调用次数、cost、UX 进度形态 |
| #5 面板宿主 | floating DOM vs Obsidian View vs 混合，决定 mobile 适配、leaf 管理、pending draft 恢复路径 |
| #6 daily-note 检测 | 跨插件契约（Periodic Notes / Daily Notes / Calendar），影响"昨日复盘"核心承诺 |
| #9 schema 字段 | 不是测试细节，**就是 Structured Output Contract 本身**——先有 schema 才能写 prompt、选 runtime、做 validation |

**建议**：把这 4 条从 Open Decisions 提升为 V1 Design Decisions，剩下的（folder 命名、wording 等）保留为 Open。

### 3.2 Persistence 缺并发与版本语义（F18）

`plugin.ts:482,496` 用 `loadData/saveData` 单 JSON。文档一句"settings should make clear" 是免责声明，未设计：

- 两台设备各有 pending draft 时谁覆盖谁
- pending draft 大小（multi-block + source refs）随多次复盘累积的清理策略
- 版本迁移（schema 变更后旧 draft 怎么读）
- **已有 pending draft 时用户又跑了一次新 review**：覆盖？叠加？拒绝？文档未定义

**改法**：pending draft 按 review-id 分片为独立 key（`pendingReviews[reviewId]`），新增 schema version 字段；sync 冲突时以 mtime 较新为准并提示；明确单 pending draft 模型（新 run 必须先 discard 或 finish 现有草稿）。

### 3.3 Review note 污染 Memory（F19）

文档说"do not directly inject review findings into Memory/VSS"且"existing Memory maintenance can later process the created Markdown note"。但：

- review note 含大量 `[[source]]` 链接和摘录后的 evidence 片段
- VSS 索引后会与原始笔记产生**高相似度重复 chunk**
- 污染未来 `search_memory` 结果，让相关旧笔记搜索逐渐降级

**改法**：review 默认落入 `Reviews/` 文件夹（建议这就是默认值，不再 open），并加入默认 Memory 排除规则（与 templates folder 同档处理）。

### 3.4 Custom follow-up 把 chat scope 偷渡回来（F20）

谨慎措辞之下它就是个绑在 suggestion 上的 mini-chat：测试面、安全规则、UI 状态、refinement 历史、persistence 全得跟上。**强烈建议 v1 砍掉**，只留 4 个固定 refinement actions。Phase 2 再补。

### 3.5 Daily-note 检测推迟到 V1 实现期不合适（F21）

L450 假定能识别 daily/periodic note，但跨插件高度分裂。**建议 V1 收敛到"modified time only"**，daily-note 检测放 Phase 2 再做，避免"昨日复盘"用户体验在第一版就破口。或者：v1 接受用户在 settings 手动配置 daily-note 路径模式作为兜底。

### 3.6 4 类输出 + 空类降级未说明（F22）

为什么是 4 类未论证；"Related old notes" 依赖 Memory 已 prepare——Memory 未就绪用户每次都看到降级类别。

**改法**：空类自动隐藏；Related old notes 显式标注为 Memory 依赖能力，未就绪时干净降级而非展示空区块。

### 3.7 Collection 动画语言未定义（F23）

文档说要"collection feel"但没说怎么做。**改法**：定义具体动画 spec："点击 Add 后，suggestion card title 行复制出一个微缩 chip，沿曲线飞向 draft 区域 / draft tab 角标，落下时角标 +1 反馈"；reduced-motion 退化为 chip 在原地淡出 + draft 角标 tick。同时 Suggestion card 进入 `added` 持久态（左侧色条 + checkmark + "Added · Undo" inline action）。

### 3.8 Reminder badge 在 zen-mode 下等于不存在（F24）

**改法**：当 mascot 隐藏 / sidebar 折叠时，reminder 在 Obsidian status bar 出现 1 个小 dot（status bar 始终可见）；永远不弹 modal/notice；设置项给 `Reminder intensity: off / dot / dot + status bar`。

### 3.9 Per-run scope indicator 长 banner 改 chip（F25）

示例那句话 6 个数字，用户不会读。**改法**：用 4 个 chip：`[Last 3 days] [10 included] [4 skipped ⓘ] [Web off]`；hover/click `4 skipped` 出 popover 显示被跳过的 path + 原因；`Web off` 是状态指示器。

### 3.10 Progress stage 用户层只露 3 个（F26）

用户不关心 "applying exclusion rules" 与 "preparing bounded excerpts" 的区别。**改法**：UI 上只显示 3 个用户视角阶段：`Collecting notes (10/14) → Analyzing → Preparing draft`；7 个细分 stage 放 "Show details" 折叠区给 debug / 信任建设场景用。

### 3.11 Telemetry schema 补强（F27）

- **allowed 列表补**：`refinement_action_type`（expand/actionize/find_related/search 枚举）、`draft_block_edit_count`、`draft_block_remove_count`、`draft_discard_count`、`note_create_retry_count`、`note_create_conflict_action`（cancel/rename/suffix）、`reminder_shown_count`、`reminder_dismissed_count`
- **failure_category enum 化**：`provider_unauthorized | provider_quota | provider_timeout | network_error | schema_validation_failed | source_validation_failed | empty_findings | user_cancel | preprocess_too_large | unknown`
- **runtime_duration 拆桶**：`local_preprocess_ms` / `llm_ms` / `postprocess_ms` 三桶 + bucket 化（10 区间），避免 provider 特征泄露
- **opt-in 搭车**：搭车现有 `shareAnonymousCapabilityUsage`，不要新增第二个开关

### 3.12 WebSearch query 构造缺 content discipline（F28）

文档 disallow query text 遥测（L850 好），但**没说构造 query 时是否能把 note excerpt 拼进去**。

**改法**：明确"WebSearch query 仅由 `research_gap.suggestedQueries` 派生 + 用户编辑，**禁止自动注入 note body excerpts**"，并在 builtin WebSearch adapter 处加 redaction 校验。

### 3.13 Pet 浮层与现有热门插件兼容性（F29）

未评估与 Hover Editor / Workspace Splits / Sliding Panes / Calendar / Periodic Notes / Popout Window / Mobile 的冲突。

**改法**：
- Pet 仅渲染在 `app.workspace.containerEl` 顶层，不污染 leaf
- 透明区域 `pointer-events: none`，只 mascot + badge + panel 接收事件
- popout window 场景：Pet 不在 popout 中渲染（避免渲染多个）
- mobile 默认隐藏 Pet，仅保留 command/hotkey 入口（文档需明示）

---

## 4. 可优化（🟡）—— 实现期可关注

- **F30 Mascot 视觉 reference**：钉 2-3 个具体参考（Things 3 logo 感 / Linear 克制感 / 具体 dribbble shot）+ size/帧数/色彩 spec
- **F31 a11y 与键盘**：补充 keyboard map（`A` add / `I` ignore / `E` expand / `/` focus custom input / `Cmd+Enter` 创建 / `Esc` 收起）；reduced-motion 覆盖到 collection 动画和 panel 展开
- **F32 与 vault-QA 类产品的差异化**：补 2-3 行「Why this is not vault QA」对照（胜点：结构化输出 + 证据强制 + 受控写入 + 清单式草稿）
- **F33 命名**：考虑 `Pagelet — note review companion for Obsidian` 作为出海命名，对 C 端更易记易搜（与 F1 方案 B 配合）
- **F34 Decision Record 去冗**：合并 #1/#6/#11；合并 #16/#50；补充缺失决策（配额耗尽中段行为、provider 不可用时纯收集模式、空 vault/range、reduced-motion 之外的 a11y）

---

## 5. 推荐 V1 Scope 调整

### 砍

| 项 | 原文行号 | 砍掉理由 |
|----|----------|----------|
| Custom follow-up input | L397-L398 | 偷渡 chat scope，测试面太大 |
| Pet click 作为主入口 | L142-L144 | Beta 传播钩子受损，降为可选入口 |
| Daily-note date 候选选择 | L447-L457 | 跨插件长尾，V1 收敛到 modified time only |
| Double Ctrl 实验入口 | L213-L216 | 不值得做平台冲突与 IME 兼容 |
| 草稿块 reorder | L692 | 已在 Open Decisions，明确推 Phase 2 |
| 空类别强制保留 | L359-L370 | 改为空则隐藏 |

### 加

| 项 | 说明 |
|----|------|
| Graceful Degradation 章节 | 空 vault / range 无笔记 / AI provider 失败 / 配额耗尽 / Memory 未就绪 的文案矩阵 |
| 单 pending draft 并发模型 | 新 run 必须先 discard 或 finish 现有草稿 |
| 继承 PA Agent network-read 预算的明确语句 | + 单次复盘成本上限提示 |
| 可执行的 Kill Criterion | 见 §2.3 |
| "Why this is not vault QA" 差异化定位段 | 见 F32 |
| Beta 期语言 baseline 决策 | 中或英二选一，i18n 留正式发布 |
| Privacy Enforcement Contract（三层兜底） | 见 §2.11 |
| Source Provenance Validation 规则 | 见 §2.13 |
| Kill Switch & Schema Versioning | 见 §2.15 |
| Beta Rollout Plan | manifest-beta + BRAT；Beta 标识四处必现 |
| First-Run Consent & Legal | 见 §2.16 |
| Plugin Compatibility Matrix | 见 F29 |

### 保留（写得好的部分）

- **Write boundary（单笔确认写入）** —— 这是这个功能最有价值的设计资产，是 PA 通向 action mode 的合法首战
- **Evidence-first / 允许稀疏输出 / 不补齐分类** —— 与 PA Agent 既有安全姿态一致
- **4 大类固定 schema**（加上空类隐藏后） —— 帮助模型输出可校验
- **Reminder = 本地阈值 + cooldown，不读笔记** —— 与"无后台分析"承诺自洽

---

## 6. 与既有架构的复用 vs 重写矩阵

| 能力 | 既有架构位置 | 复用方式 | 风险 |
|------|--------------|----------|------|
| Memory 搜索（related old notes） | `search_memory` capability + `MemoryManager.searchMemory` | 直接 `CapabilityRegistry.execute` | 低；注意 review 调用不进入 Memory references bucket，应进 Context Used |
| 候选笔记枚举 | `list_recent_notes` + `getMarkdownFiles` (`helpers.ts:206`) | 复用 `getMarkdownFiles` helper，**不**复用 `list_recent_notes` | 中；需要新 candidate 筛选器 |
| 笔记摘录 / 结构 | `inspect_obsidian_note` + `read_note_outline` | 内部复用 `parseMarkdownStructure`，由 review backend 直接调用 | 中；要把现在嵌在 tool 里的 parser 提到 helper |
| TODO 抽取 | `chat-tool-execution-helpers.ts:664` `- [ ]` 正则 | 提取共享 `parseTodoLikeLines(text, options)` helper | 低；务必 dedupe |
| WebSearch | `builtin-web-search-provider.ts` + `CapabilityRegistry` + redactor | 走 `CapabilityRegistry.execute`，复用 `PolicyEngine` 实例 | 中；需要"review session context"概念 |
| **写笔记** | `vault.create` (`plugin.ts:600`)；**无** capability 层 | 必须新建：要么走 Operations Agent 早期版本，要么旁路（明确技术债） | **高**；与 PolicyEngine 与 operations-agent-plan 直接冲突（F4） |
| **结构化输出** | **无**任何 schema/validator 基础设施 | 需引入 zod + LangChain `withStructuredOutput`，确认 DashScope/Bailian 兼容性 | **高**；最大的未知（F5） |
| LLM 调用 | `PaAgentLoop` + `ChatService.streamLLM` | 复用 chat-service 层但绕开 PaAgentLoop（review 不是 chat turn） | 中；budget/cancellation 自建 |
| 事件 / cancellation | `AgentEvent` + `runId/turnId/seq` | 复用事件协议，新增 `runKind: "review"` | 低 |
| 持久化 | `loadData/saveData` 单 JSON | 新增 namespaced key + schema version + sync 注意事项 | 中 |
| 面板宿主 | `view.ts / chat-view.ts / stats-view.ts`（Obsidian View） | 推荐 review 也走 Obsidian View，mascot 单独浮层 | 中；mobile 适配未验证 |

---

## 7. 建议补充到设计文档的章节清单

1. **Privacy Enforcement Contract** —— 替换 L855-L879 单段；三层兜底；Memory related-notes re-filter；`#private` 二次确认
2. **Source Provenance Validation** —— sourceRefs ⊆ includedSources 强制；UI 必须显示锚点；confidence label 规则后处理
3. **Failure Taxonomy & Telemetry Schema** —— enum 化 failure_category；duration 拆桶；明确搭车 `shareAnonymousCapabilityUsage`
4. **Kill Switch & Schema Versioning** —— `reviewAssistantEnabled` 一键关；pending draft `schemaVersion`；降级保留策略
5. **Beta Rollout Plan** —— manifest-beta + BRAT 优先；Beta 标识四处必现；adoption metrics 客观口径
6. **First-Run Consent & Legal** —— 法律免责一行；隐私矩阵新增 Review Assistant 行；首次 Pet 强同意 modal 复用 `confirmUserAction`
7. **Plugin Compatibility Matrix** —— Hover Editor / Periodic Notes / Tasks / Dataview / Calendar / Popout Window / Mobile 行为定义
8. **Graceful Degradation** —— 空 vault / 0 findings / provider 失败 / 配额耗尽 / Memory 未就绪 的文案矩阵
9. **Write Path Decision Record** —— 选 A（旁路）或 B（扩展 PolicyEngine），与 `docs/operations-agent-plan.md` 同步登记
10. **Structured Output Runtime Decision** —— zod + withStructuredOutput vs 手写 parser；provider 兼容性测试矩阵

---

## 8. 推荐的下一步动作（按优先级）

1. **就 F1（身份冲突）/ F2（默认 Pet 不可见）做产品决策**：这两个决定整个 Beta 叙事，必须在文档收敛前定下来
2. **就 F4（写入路径）做架构决策**：选 A 旁路 or B 扩展 PolicyEngine；同步到 operations-agent-plan
3. **就 F5（structured output runtime）做技术 spike**：1-2 天，验证 DashScope/Bailian 对 strict JSON / `withStructuredOutput` 的兼容性
4. **把 F17 列的 4 条 Open Decisions 升级为 V1 Decisions**：包含预算 / 面板宿主 / daily-note 检测 / schema 字段
5. **补充 §7 列的 10 个章节**到设计文档（可分批，先补 1/2/4/9）
6. **就 §5 的 scope 调整与你 review 一遍**：哪些砍、哪些加，确认后再启动实现
7. 启动实现前再做一次 mascot 视觉 reference 锚点（F30）+ Layout 阈值定稿（F10）

---

## 附录 A. 4 个评审 agent 的角色与覆盖

| Agent | 焦点 | 主要贡献 |
|-------|------|----------|
| Product strategy review | 产品定位、scope、Decision Record、获客 | F1-F3、F20-F22、F32-F34 |
| Architecture review | 与 PA Agent 复用、PolicyEngine、Schema、persistence | F4-F6、F17-F19、复用矩阵 |
| UI/UX review | mascot、layout、card、refinement、a11y、i18n | F7-F10、F23-F26、F30-F31 |
| Trust/privacy/release | exclusion、provenance、telemetry、Beta 发布、合规 | F11-F16、F27-F29 |

## 附录 B. 引用文件

- 被评审文档：`docs/review-assistant-product-design.md`
- 相关架构基线：
  - `docs/pa-agent-architecture-plan.md`
  - `docs/pa-agent-runtime-lifecycle-plan.md`
  - `docs/pa-agent-mcp-adapter-decision.md`
  - `docs/operations-agent-plan.md`
  - `docs/obsidian-operations-agent-plan.md`
  - `docs/pa-agent-telemetry-baseline.md`
  - `docs/pa-agent-product-safety-review.md`
  - `docs/archive/community-scan-remediation-plan.md`
- 关键代码定位：
  - `src/ai-services/policy-engine.ts:35-40`（写入边界冲突点）
  - `src/ai-services/capability-types.ts:112`
  - `src/ai-services/chat-tool-execution-helpers.ts:206,664`（TODO 抽取既有路径）
  - `src/plugin.ts:388,482,575-600`（vault 写入与 persistence）
  - `src/ai-services/builtin-web-search-provider.ts`（WebSearch 复用入口）
