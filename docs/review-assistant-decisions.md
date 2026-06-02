# Pagelet / Review Assistant — Decisions Record

> 单文件决策汇总。所有 Pagelet 相关的设计/产品/架构决策按时间顺序记录在此。
>
> 格式说明：每条决策包含 **ID / 日期 / 主题 / 决策 / 上下文 / 替代方案 / 拍板理由**。被新决策覆盖的旧决策迁移到「Superseded」区，**保留可追溯**。
>
> 决策的"为什么"是关键——读者通过 rationale 判断未来场景是否仍适用，避免盲目套用。

---

## ✅ Active Decisions

### 🏷 品牌 / 命名

#### D001 · 品牌命名

- **日期**：2026-06-01
- **决策**：feature 命名为 `Pagelet`（英文）/ `拾页`（中文）
- **上下文**：F33 review 提出原 working name `Review Assistant` 太通用、易撞名、缺品牌识别
- **替代方案**：Reviewer / Inkmark / Sage / Margins / Pagewright
- **拍板理由**：
  - "Pagelet" = page + diminutive，语义直接对应"纸张/页片"
  - "拾页"中文双关："拾"既是 pick up 也是 review，"页"是笔记单位
  - 跨文化均易发音、无歧义
  - 不撞 Obsidian 生态主流插件命名

#### D002 · Copy 调性

- **日期**：2026-06-01
- **决策**：允许少量人设（B 方案）——文案有性格，但克制
- **上下文**：mascot 文案/状态提示/空状态文案的风格定调
- **替代方案**：A 全工具型零人设 / C 重人设拟人化
- **拍板理由**：
  - Pagelet 是工具，但"安静审视者"定位本身有人格暗示
  - 少量人设有助于品牌差异化，过量会显得"低龄"
  - 文案示例："让我看看…" / "这里值得展开" / "看起来不错"

#### D003 · LLM-free fallback

- **日期**：2026-06-01
- **决策**：**不做** LLM-free fallback
- **上下文**：考虑过当用户未配置 LLM 时是否提供规则版 Pagelet 兜底
- **替代方案**：基于 regex / 启发式规则的离线 review
- **拍板理由**：
  - 规则版质量远低于 LLM 版，反而损害品牌
  - PA 已假设用户配置了 LLM（Chat 功能依赖），Pagelet 沿用此前提
  - 维护两套实现成本不划算

---

### 🎨 视觉 / UI

#### D004 · Mascot 视觉大方向

- **日期**：2026-06-01
- **决策**：**A · 极简线稿**——纸张+折角，表情靠少量线条暗示
- **上下文**：决定 mascot 在 UI 中的视觉表达方式
- **替代方案**：
  - B 角色化纸张（有身体/四肢/面部）
  - C 抽象符号（几何形状+颜色变化）
  - D 像素艺术（8-bit 风）
- **拍板理由**：
  - Obsidian 生态信号一致——高 DAU 插件几乎无角色化 mascot
  - AI 工具型产品行业共识是非角色化（Cursor / Copilot / Notion AI / Claude / ChatGPT 均无）
  - AI 出错时角色化会放大反差挫败感（uncanny valley of competence）
  - 独立开发者维护成本结构 A 更优（乐高式延展）
  - 可逆性 A→B 友好，B→A 困难
- **视觉规范**：`docs/pagelet-visual-spec.html`（合并 D004 + D005 执行规范）

#### D005 · 视觉锚点

- **日期**：2026-06-01
- **决策**：**④ · Tldraw-like 手绘人文**——1.6px 微抖线条 + 圆头 + 中性灰 + 鲜活 accent
- **上下文**：在 D004 大方向下，选定具体的子风格作为美术执行规范
- **替代方案**：
  - ① Bear-like 静谧专业（Bear / iA Writer 风）
  - ② Linear-like 极客精确（Linear / Raycast 风）
  - ③ Notion-like 温暖友好（Notion / Craft 风）
- **拍板理由**：
  - 跟 Obsidian Canvas / Excalidraw 同源基因，"原生感"最强
  - 手绘抖动自带温度——精确解决 D002"少量人设"的承载难题
  - 差异化最强，其他三套都跟某大厂撞调性
  - "拾页"语义贴合度最高（手绘纸张 = 被翻动过的页）
  - AI 出错时容错度高（手绘风带"轻盈、不严肃"的隐喻）
- **视觉规范**：`docs/pagelet-visual-spec.html`（合并 D004 + D005 执行规范）
- **配色 token**：
  - 中性灰：`#e8e8e8`
  - Thinking 蓝：`#7c9eff`
  - Done 绿：`#5dd39e`
  - Error 红：`#ff6b6b`

---

### 🎯 产品定位 / 差异化

#### D006 · 差异化定位

- **日期**：2026-06-01
- **决策**：**A + B + D 组合**
  - **A · Review-first**：别人是写作时帮你写，Pagelet 是写完后帮你审视（主 slogan）
  - **B · 非侵入式建议**：所有建议是 card 形式可拒绝，不动笔记
  - **D · 基于 vault 上下文**：建议会引用过去笔记/标签/链接
- **上下文**：避免被用户对标 Smart Connections / Copilot for Obsidian
- **替代方案**：C 低噪音定位 / E 隐私优先定位
- **拍板理由**：
  - A 在赛道里没人做（差异化最强）
  - B 是 Linear-style 工作流，跟非侵入定位一致
  - D 可复用 PA 已有 RAG 能力，护城河
  - C "智能克制"无法 day 1 验证，等口碑后加
  - E 隐私同质化太严重，且 Pagelet 默认走云端 LLM
- **主 slogan**：
  - EN: `Pagelet — your note's quiet reviewer`
  - ZH: `拾页 — 笔记写完后的安静审视者`
- **落地触点**：manifest description / 首次启动 inline tip / settings 顶部 callout / README 第一段
- **不做**：README 中**不直接点名**对比 Smart Connections / Copilot

---

### 🦮 可访问性 / 键盘

#### D007 · a11y + 键盘交互（F31）

- **日期**：2026-06-01
- **决策**：4 子项组合
  - **(1) C · 全局快捷键**：注册 commands 但不绑默认快捷键（Obsidian 惯例）
  - **(2) C · 焦点管理**：焦点不动，提供 `Cmd+/` 快捷键跳入最近 card
  - **(3) B · 屏幕阅读器**：仅在出现建议时用 `aria-live=polite` 公告
  - **(4) C · prefers-reduced-motion**：保留状态颜色变化、关闭抖动+浮动
- **上下文**：Beta 上线前的 a11y 底线
- **拍板理由**：
  - Obsidian 插件惯例不抢快捷键（避免冲突）
  - 不打断写作流（焦点不抢）
  - 兼顾盲人用户（aria-live）但不噪音轰炸
  - WCAG 合规（reduce-motion 降级）+ 保留功能性
- **实现成本**：< 1 天工作量

---

### 🗂 存储 / 文件

#### D008 · Review 产物文件夹

- **日期**：2026-06-01
- **决策**：`.pagelet/`（vault 根目录隐藏 dotfolder）
- **上下文**：选择 review 产物存放位置
- **替代方案**：
  - `Pagelet/` 在 vault 根（用户反感"突然出现的新目录"）
  - `.obsidian/plugins/personal-assistant/pagelet/`（插件目录）— **被推翻**
  - `Reviews/` 通用名（撞用户已有目录概率高）
- **被推翻方案的硬伤**：插件目录方案的 4 个致命问题
  - 插件更新/重装（包括 BRAT）会清空数据
  - `.obsidian/` 默认被 Obsidian 索引排除，`[[ 双向链接 ]]` 失效
  - 同步/备份工具普遍排除 `.obsidian/`
  - 违反 Obsidian 插件惯例（用户内容必须在 vault 普通路径）
- **拍板理由**：
  - dotfolder 默认隐藏，不污染用户目录规划
  - 仍是 vault 普通路径，所有 Obsidian 核心特性可用（双链/quick switcher/同步）
  - 设置中可改路径
- **冲突处理**：撞名时自动避让为 `.pagelet-reviews/`

#### D009 · Review 产物文件命名

- **日期**：2026-06-01
- **决策**：`{原笔记名}-pagelet-review-{YYYY-MM-DD}.md`
- **上下文**：每条 review 产物的文件名规范
- **替代方案**：
  - `pagelet-review--{slug}--{ISO}.md`（agent 建议改名避开 Periodic Notes 日期正则）
  - `{YYYY-MM-DD} - {原笔记名}.md`
  - `{原笔记名}.pagelet.md`（只保留最新）
- **拍板理由**：
  - dotfolder 已隔离 Periodic Notes 风险（PN 默认不扫 dotfolder）
  - 可读性最好（笔记名打头便于扫描）
  - 保留历史所有 review 版本（含日期）
- **frontmatter**：每个产物 head 包含 `pagelet: true` 让其他插件可识别忽略

#### D010 · 用户可自定义路径

- **日期**：2026-06-01
- **决策**：允许在 settings (advanced) 修改 reviews folder 路径
- **上下文**：独立开发者尊重用户自主权
- **拍板理由**：BYOK 用户对路径敏感度高，强制锁定会引发抵触

---

### 🚦 Beta 标识 / 发布

#### D011 · Beta 标识位置

- **日期**：2026-06-01
- **决策**：3 处（不做正式 onboarding）
  - **① Ribbon icon**：右下角小 `β` 角标 + tooltip "Pagelet (Beta)"
  - **② Suggestion card**：**不加** Beta 标识（避免每张卡都自降信心）
  - **③ Settings 顶部**：callout block "Pagelet is in Beta. Suggestions may be imperfect — your feedback helps us improve." + `[Send feedback →]` 按钮
  - **④ 首次激活 inline tip**：首次召唤时 suggestion card 上方一行小字提示 Beta + 反馈入口，关闭后永久不再出现
- **被推翻方案**：正式 onboarding 流程（违反 Obsidian 插件惯例，过度教育用户）
- **拍板理由**：
  - Obsidian 主流插件几乎无 onboarding（Dataview / Templater / Smart Connections 全无）
  - Obsidian 用户是自筛选高级用户，被引导页拦住会反感
  - Inline tip 在使用瞬间出现，比 onboarding 轻 10 倍
- **替代承载**：Community plugins 描述 + README callout + first-use inline tip
- **文案 token**：
  - EN: `Pagelet (Beta)` / `Pagelet is in Beta. Suggestions may be imperfect — your feedback helps us improve.`
  - ZH: `拾页 (Beta)` / `拾页处于 Beta 阶段，建议可能不完美 —— 你的反馈帮助我们改进。`

#### D012 · 反馈渠道

- **日期**：2026-06-01
- **决策**：GitHub Issues + 表单 (Google Form / 飞书) 双渠道
- **拍板理由**：极客用户走 Issues，普通用户走表单，独立开发者反馈渠道宁多勿少

#### D013 · Release Channel 策略

- **日期**：2026-06-01
- **决策**：沿用 PA 既有 release scheme，Pagelet 作为 feature 灰度
  - **版本**：`2.(x+1).0-beta.N`（Pagelet beta 测试）→ `2.(x+1).0`（graduate）
  - **Beta 默认行为**：默认**开启** Pagelet（用户装 beta 即想试新功能）
  - **Graduate 标准**：连续 2 个 `-beta.N` 无 P0/P1 bug + GitHub Issues 反馈无致命问题
  - **CHANGELOG**：沿用 PA 现有规范，Beta 特性单独说明
  - **Release SOP**：沿用 PA `release-process.md`
- **被推翻方案**：BRAT 独立渠道订阅 / `0.x.x` 起步版本号 / 远程 kill switch（all 过度工程化，PA 已是成熟 community plugin）
- **拍板理由**：Pagelet 是 PA 的 feature，不是独立插件；沿用现有发布管道最自然

---

### 🌐 国际化 / 语言

#### D014 · UI i18n 策略

- **日期**：2026-06-01
- **决策**：沿用 PA 现有 i18n 机制 + 中+英双语 day 1
- **替代方案**：独立 i18n 模块 / 仅英文 / 仅中文
- **拍板理由**：
  - 出海 C 端定位要求英文 day 1
  - 中文母语开发者，中文质量天然过关
  - 沿用 PA 机制 = 零额外架构成本

#### D015 · Review 建议生成语言策略

- **日期**：2026-06-01
- **决策**：D 组合 = A (跟随笔记内容语言) 默认 + C (settings 强制指定) 兜底
- **替代方案**：跟随 UI 语言（B）/ 仅 settings 指定（C）
- **拍板理由**：
  - 最自然（笔记中文则建议中文）
  - 兜底处理混合语言/用户特殊偏好
- **检测方法**：简单字符比例 regex `/[一-鿿]/g`，> 30% 判中文

#### D016 · System prompt 语言

- **日期**：2026-06-01
- **决策**：System prompt 全英文 + 内含 `"respond in {detected_lang}"` 指令
- **拍板理由**：
  - 业界共识 LLM 英文 system prompt 性能最强
  - 跨 provider（Qwen / OpenAI / Bailian）一致性
  - 输出语言通过指令控制

#### D017 · Mascot 文案语言

- **日期**：2026-06-01
- **决策**：跟随 UI 语言（不跟笔记语言）
- **拍板理由**：mascot 是 UI 元素，应跟其他 UI 一致

---

### 💰 Cost Ceiling / 异常熔断

#### D018 · 单次 token 上限

- **日期**：2026-06-01
- **决策**：D 组合
  - 默认：输入 **8K** + 输出 **2K**（覆盖 90% 用户笔记 < 5000 字）
  - Settings 可调到：输入 **32K** + 输出 **4K**
  - **硬上限**：永远 ≤ 36K tokens（即使用户改 settings，超出拒绝并提示切分笔记）
- **拍板理由**：防止 prompt injection 攻击让 LLM 跑飞

#### D019 · 每次 review 的 LLM 调用次数

- **日期**：2026-06-01
- **决策**：默认 **1 次 call**（基础 review），用户主动点 "deeper review" 触发 **3-5 次 call**
- **拍板理由**：明确的成本/质量交换，用户控制

#### D020 · 每日全局上限

- **日期**：2026-06-01
- **决策**：双层防爆 = 单小时 ≤ 10 次 + 单日 ≤ 100 次
- **拍板理由**：
  - 单小时 10 次防异常爆发（脚本 bug / 误点循环）
  - 单日 100 次覆盖 90% 用户极端使用

#### D021 · 触达上限行为

- **日期**：2026-06-01
- **决策**：拒绝 + 提供 "强制再来一次（跳过限制）" 按钮
- **拍板理由**：BYOK 用户最终自主权 + 默认防"无意识跑飞"

#### D022 · 费用展示

- **日期**：2026-06-01
- **决策**：事后在 suggestion card 旁显示 `this review used ~$0.003`（基于实际 usage）
- **拍板理由**：事前预估容易算错（多 provider 单价），事后基于实际更准

#### D023 · 异常熔断

- **日期**：2026-06-01
- **决策**：v1 Beta 只做最基础的"调用失败提示用户"，更精细熔断 v2 加
- **延期项**（v2 加）：
  - LLM 返回超 10K tokens → 截断+报警
  - 单次 call > 60s → 中止+提示
  - 连续 3 次 call 报错 → 暂停 30 分钟
  - Provider rate limit → 指数退避重试
- **拍板理由**：避免 v1 Beta 过度工程化

---

### 🏗 技术架构

#### D024 · Runtime 形态

- **日期**：2026-06-01
- **决策**：**③ 轻量版 RunKindAdapter** — 复用 PaAgentLoop，通过 3 个依赖注入接口适配 review 工作负载
- **上下文**：用户要求"PA 只有一个 Agent Runtime 支持所有智能 assistant 能力"
- **替代方案**：
  - ① 完全独立的 ReviewRuntime（违反"唯一 Runtime"原则）
  - ② 在 PaAgentRuntime 内分支处理 review（耦合过重）
- **拍板理由**：
  - PaAgentLoop 已通过 3 个 DI 接口实现 runtime-agnostic：`PaAgentModel.stream()` / `PaAgentToolExecutor.execute()` / `PaAgentHostPolicy.afterTurn()`
  - LangGraph / Kubernetes / LSP 均采用"单 Runtime + 多 workflow adapter"模式
  - 实现新增 ~900 行：`pa-review-runtime.ts` / `pa-review-model.ts` / `pa-review-host-policy.ts` / `pa-review-tool-provider.ts` + `policy-engine.ts` 改造
- **共享组件**：CapabilityRegistry / PaAgentLoop 完全复用

#### D025 · 写路径策略

- **日期**：2026-06-01（2026-06-02 命名对齐 → **Write Action Framework v1**，参见 [[D030]]）
- **决策**：**B-full** = **Write Action Framework v1** 先做，Pagelet 所有能力按其契约设计
- **上下文**：Pagelet 涉及生成 review 产物文件，是"写"操作；PA 的写路径基础设施统一收归到 Write Action Framework v1，再上层规划独立的 Operations Agent mode（参见 [[D030]] 的二层命名层级）
- **替代方案**：A 直接走 PolicyEngine 当前的 read-only / B-min 仅本次需要的最小写能力
- **拍板理由**：
  - 写操作需要 preview / confirmation / target confinement / stale re-read / audit 5 个子模块
  - 框架可复用，不应每个新 feature 重做一套
  - 避免后续重构成本
- **Cross-ref**：
  - PA 已有边界文档 `docs/write-action-design-handoff.md`（候选 action 家族 + 7 gates + Preview/Audit Contract + 7-step minimal implementation sequence）
  - PA 已有边界文档 `docs/operations-agent-plan.md`（Operations Agent mode 的 scope / 5 子模块 / open decisions）
  - 待新增 `docs/write-action-framework-sdd.md`（合并上述两个边界文档为单一 SDD），追踪于 [[OQ001]]

#### D026 · Structured Output 实现（F5）

- **日期**：2026-06-01
- **决策**：
  - **(a) Schema 定义**：zod
  - **(b) Runtime**：混合 = LangChain `withStructuredOutput` + 手写 parser 降级兜底
  - **(c) Providers**：Qwen/DashScope + Bailian + OpenAI-compatible（不含 Ollama）
  - **(d) 失败矩阵**：8 行全接受（schema mismatch / missing source_id / wrong type / empty / over limit / partial / timeout / parse error）
  - **(e) 渲染**：v1 一次性 → v2 streaming
  - **(f) Prompt 注入**：A+B 混合（schema in system + few-shot in user）+ 1 个 few-shot + source-id 强约束
- **后续待办**：1-2 天 provider 兼容性 spike 验证

#### D027 · 决策归档形式

- **日期**：2026-06-01
- **决策**：**C · 单独决策汇总文件** = 本文件 `docs/review-assistant-decisions.md`
- **替代方案**：A 内嵌产品设计文档 / B 独立 ADR 目录
- **拍板理由**：
  - A 已被验证为反模式（原 product-design.md L1053-1108 已散乱过时）
  - B 太重（v1 阶段决策数量 30-50，ADR 目录管理负担大）
  - C 是 Linear / Vercel 等团队 100 人以下时的常见选择
- **触发迁移到 B 的条件**：决策累积到 100+ 条时考虑

#### D028 · SDD 归档位置

- **日期**：2026-06-01
- **决策**：**C · 独立 SDD 文件** = `docs/review-assistant-sdd.md`
- **替代方案**：内嵌 product-design.md / 拆分多个 SDD 文件
- **拍板理由**：
  - product-design.md 关注 what/why（产品意图）
  - SDD 关注 how（实现细节）
  - 独立文件便于工程师专注，避免设计文档过载

---

### 🔌 插件兼容性

#### D029 · F29 兼容性缓解措施

- **日期**：2026-06-01
- **决策**：接受 agent 评估的 **4 红旗 + 8 中等风险缓解 + 命名规范**
- **来源**：F29 agent 评估报告
- **4 红旗（必须落入 SDD 实现章节）**：
  - **R1** Mascot view-type gating：只在 `view.getViewType() === 'markdown'` 时挂载
  - **R2** file-open debounce + idempotent：≥ 300ms debounce，多次触发幂等
  - **R3** `.pagelet/` 写入用 `vault.adapter.write` 绕过 modify 事件
  - **R4** Ribbon 排序支持用户调整（参考 Commander 插件思路）
- **8 中等风险缓解**：见 SDD 兼容性章节
- **命名规范**：
  - 所有命令固定 `Pagelet:` 前缀
  - CSS 用 `.pa-pagelet-*` 前缀 + `data-plugin="pa-pagelet"` 属性
  - Review 产物 frontmatter 包含 `pagelet: true`

---

### 🧱 写路径基础设施

#### D030 · 写路径采取"框架先行 + 二层命名对齐"

- **日期**：2026-06-02
- **决策**：A + 命名对齐
  - **A · 框架先行**：Write Action Framework v1 作为 Pagelet beta 的**硬阻塞**，先完成 SDD + 最小实现，再让 Pagelet 走真实写路径
  - **命名对齐 · 二层层级**：
    ```
    Operations Agent (mode, future)         ← v2+ 的智能 action 编排
      └─ Write Action Framework v1          ← 当前需要做的基础设施 (PA-level)
          ├─ preview
          ├─ confirmation
          ├─ target confinement
          ├─ stale re-read
          └─ audit
              └─ Pagelet v1 依赖此          ← review-note 创建是第一个落地用例
    ```
- **上下文**：
  - 审计 Pagelet 文档 ↔ PA 现有文档时发现"Operations Agent v0"是 Pagelet 内部生造名词，PA 仓库没有同名文档
  - PA 仓库有两份边界文档（`docs/write-action-design-handoff.md` + `docs/operations-agent-plan.md`），但语义切分模糊
  - `src/ai-services/capability-types.ts:20` 声明了 `kind="action"` 但**零实现**，`policy-engine.ts:35` 对其默认拒绝
- **替代方案**：
  - **B · Pagelet 走 B-min 单独实现**：临时给 Pagelet 一套最小写能力，框架以后再统一 → 历史负债，违反用户"架构完整和演进"诉求
  - **C · 推迟 Pagelet beta 到 v3**：等 Operations Agent mode 完整再做 → 过度等待，框架基础设施其实 v1 就够
  - **D · 沿用"Operations Agent v0"**：保持 Pagelet 文档原名 → 跟 PA 文档脱节，未来 Operations Agent mode 真做时再改名一次更乱
- **拍板理由**：
  - 用户原文："我期望从架构完整和演进的角度完成产品功能的迭代，不要带着太多的历史负债迭代演进"
  - 二层命名解耦：基础设施层（Write Action Framework）跟 mode 层（Operations Agent）分开，前者 v1 就能稳定，后者可随产品成熟度延后
  - Pagelet 写路径成为 framework 的第一个真实 caller，反向验证 API 设计
- **本次会话范围**：
  - ✅ 更新 Pagelet 三份文档命名 + 阻塞强化（decisions / product-design / sdd）
  - ✅ 更新 memory `project_action_mode_roadmap`
  - ⏭ 写 `docs/write-action-framework-sdd.md` 留给下一会话
- **依赖追踪**：[[OQ001]]（升级为 Hard Blocker），[[D025]]（命名替换 + cross-ref）

---

## 🔄 Superseded Decisions

*被新决策覆盖的旧决策，保留可追溯*

（暂无；首版 Decision Record 即为本次拍板汇总）

---

## 🤔 Open Questions

*待讨论但暂未拍板的开放问题*

### OQ001 · Write Action Framework v1 SDD 撰写

- **状态**：**Open · Hard Blocker for Pagelet beta**（2026-06-02 升级，参见 [[D030]]）
- **日期**：2026-06-01（升级 2026-06-02）
- **背景**：D025 决定 Pagelet 走 B-full，依赖 Write Action Framework v1；但 PA 当前只有两份边界文档（`docs/write-action-design-handoff.md` + `docs/operations-agent-plan.md`），尚无完整 SDD，且 `src/ai-services/policy-engine.ts:35` 仍对 `kind="action"` 默认拒绝
- **待办**：
  1. 写 `docs/write-action-framework-sdd.md`，合并上述两份边界文档为单一 SDD
  2. 覆盖 5 子模块：preview / confirmation / target confinement / stale re-read / audit
  3. 给出 PolicyEngine 的参数化方案（runKind + allowWrite），允许 review 写但仍默认拒绝 chat 写
  4. 实现 minimal capability + 至少一个端到端 write action（创建 review note 即首个落地用例）
- **阻塞**：
  - Pagelet SDD §2.4 / §3 / §14 的写路径细节需要等本 SDD 稳定后才能补完
  - Pagelet beta 上线必须等 Write Action Framework v1 实现就绪
- **下一会话动作**：开新会话写 `docs/write-action-framework-sdd.md`

### OQ002 · F5 Provider 兼容性 spike

- **状态**：Open
- **日期**：2026-06-01
- **背景**：D026 选定 LangChain `withStructuredOutput` + 手写 parser 降级，但 Qwen/Bailian/OpenAI-compatible 各 provider 对 structured output 的实际兼容性需要 1-2 天 spike 验证
- **待办**：写一个最小验证脚本，对每个 provider 跑 10 个 review 样本，统计 schema 命中率
- **阻塞**：影响 Pagelet 主路径稳定性预期

### OQ003 · v2 异常熔断细化方案

- **状态**：Open (defer to v2)
- **日期**：2026-06-01
- **背景**：D023 推迟到 v2 的 4 项异常熔断需要进一步设计
- **待办**：v1 上线 1 个月后基于实际 incident 数据再设计

### OQ004 · DAU/MAU 指标收集机制

- **状态**：Open
- **日期**：2026-06-01
- **背景**：D013 提到 graduate 标准是"反馈无致命"，但未来若考虑 DAU/MAU 等量化指标，需要先有遥测机制
- **待办**：暂用 GitHub Issues 计数 + 用户自报作为代用指标；正式 telemetry v2 再做

### OQ005 · Pagelet 跟其他 AI 插件并存的隐性影响

- **状态**：Open
- **日期**：2026-06-01
- **背景**：F29 报告关注了静态冲突，但 Smart Connections / Copilot 同时运行的资源/事件叠加影响未量化
- **待办**：Beta 发布后收集 issue 反馈，必要时做实测

---

## 📋 决策应用追溯

*帮助理解哪份文档/代码反映了哪个决策*

| 决策 ID | 体现位置 |
|---------|---------|
| D001-D006 (品牌/视觉/定位) | `docs/review-assistant-product-design.md` |
| D007 (a11y) | `docs/review-assistant-sdd.md` 实现章节 |
| D008-D010 (存储) | `docs/review-assistant-product-design.md` 持久化 + `docs/review-assistant-sdd.md` 文件 IO |
| D011-D012 (Beta) | `docs/review-assistant-product-design.md` Beta 章节 |
| D013 (Release) | `docs/release-process.md`（沿用） |
| D014-D017 (i18n) | `docs/review-assistant-sdd.md` 语言策略 |
| D018-D023 (Cost) | `docs/review-assistant-sdd.md` Cost ceiling 章节 |
| D024-D028 (架构) | `docs/review-assistant-sdd.md` 架构章节 |
| D029 (兼容性) | `docs/review-assistant-sdd.md` 插件兼容性 |
| D030 (写路径基础设施) | `docs/review-assistant-sdd.md` §2.4 / §3 / §14；下一会话 `docs/write-action-framework-sdd.md` |
