# PA 社区透出 & 用户反馈计划

> 来源：2026-07-08 复盘讨论。解决"所有产品决策均来自内部循环，无外部用户信号"的结构性盲区。

## 背景

PA 当前 ~145 stars，50-500 活跃用户，GitHub Issues 存在但不活跃（22 open issues 全是 Renovate bot），GitHub Discussions 未开启。所有产品决策来自 AI 研究报告 + AI 代码审计 + 开发者 dogfooding，无任何真实用户行为或反馈数据。

**目标：拉新 + 反馈并重**，为后续收费（Lite tier）和功能验证（北极星"随手记下，需要时自然浮现"）建立外部信号源。

## 当前问题（发帖前必须解决）

| # | 问题 | 影响 | 状态 |
|---|------|------|------|
| P1 | manifest.json description 是管理工具定位，不提 AI/Memory/Recall | 插件市场第一印象与差异化价值不匹配 | [ ] 待更新 |
| P2 | GitHub Discussions 未开启 | 反馈没有着陆点 | [ ] 待开启 |
| P3 | 22 个 open issues 全是 Renovate bot | 给人"无人维护"的错觉 | [ ] 待清理 |
| P4 | README 把 AI 功能标为 "beta feature" | 降低用户信心 | [ ] 待评估 |
| P5 | 无 BYOK 快速上手指南 | API key 门槛阻止新用户试用 | [ ] 待编写 |

---

## Phase 0：发帖前准备（预估 ~1-2 小时，一次性）

### 0.1 开启 GitHub Discussions

路径：GitHub repo Settings → Features → Discussions → Enable

建议 category：
- **Show & Tell** — 用户分享使用场景
- **Feedback & Ideas** — 功能反馈和建议
- **Q&A** — 使用问题

### 0.2 更新 manifest.json description

当前：
```
AI-powered workflows to streamline the automated management of records, callouts, frontmatter, graph views, themes, and plugins.
```

建议：
```
AI note companion — chat with your vault, let past notes resurface when they matter. Also manages callouts, frontmatter, and graph views.
```

原则：AI 差异化价值前置，管理功能保留但不领跑。

### 0.3 准备 BYOK 快速上手指南

目标：让"没有 API key"的用户在 5 分钟内完成配置。

内容结构：
1. **Provider 免费额度对比表**

   | Provider | 免费额度 | 推荐模型 | 获取 key 难度 |
   |----------|----------|----------|---------------|
   | DashScope (阿里百炼) | 有免费额度 | qwen-plus / qwen-max | 低（支付宝实名） |
   | Google AI Studio | 免费（有 rate limit） | gemini-2.0-flash | 低（Google 账号） |
   | OpenAI | $5 新用户 credit | gpt-4o-mini | 中（需信用卡） |

2. **最低成本推荐路径**：DashScope（国内）或 Google AI Studio（海外），3 步截图教程
3. **PA 内配置步骤**：Settings → AI → 选 Provider → 粘贴 key → 验证

格式：获批并开始编写时，在 `docs/guides/` 创建独立 BYOK 指南，并从 README 和社区帖链接；未创建前不要引用一个假定存在的文件。

### 0.4 清理 open issues

- Renovate bot 的过时 dependency PRs：批量关闭或合并
- 保留有意义的 issue
- 目标：让 issue 列表反映真实状态，而非机器人噪声

---

## Phase 1：社区透出执行

### 核心信息（英文，出海为主）

**一句话定位：**
> "I built an Obsidian plugin that quietly learns from your notes and resurfaces relevant ones when you need them — like a second brain that actually remembers."

**不要说什么：**
- 不说 "management tool"（除非被问到）
- 不说 "beta"
- 不说技术架构（PolicyEngine / Orchestrator / WASM / LangChain）
- 不列 20 个功能清单

**说什么：**
- 一个核心价值：旧笔记在你需要时自动浮现
- 一个 demo：GIF 或短视频展示 Quiet Recall 的实际效果（打开笔记 → Pet 动画 → Bubble 浮现相关旧笔记）
- 一个邀请：你的笔记有多少写了就再也没看过？

### 渠道 × 内容适配

#### Reddit r/ObsidianMD

- **格式**：长帖 + GIF/视频
- **风格**：Show & Tell，"我为什么做这个 + demo + 想听反馈"
- **flair**："Share & Showcase"
- **注意**：Reddit 社区对 self-promotion 敏感，必须以价值和讨论为主而非推广。开头讲动机（"我的笔记写了就忘"），中间展示功能，结尾开放讨论
- **帖子结构**：
  1. Hook — "How many of your notes have you written and never opened again?"
  2. Story — 为什么做这个（个人痛点，不是技术决策）
  3. Demo — GIF：打开笔记 → 相关旧笔记自动浮现
  4. How to try — 链接 + BYOK 指南
  5. Ask — 三个反馈问题（见下方）
  6. Link — GitHub Discussion for ongoing conversation

#### Obsidian Discord `#plugins`

- **格式**：简短介绍（2-3 句）+ demo GIF + 链接
- **内容**："刚更新了 Personal Assistant v2.8 — 打开笔记时自动浮现相关旧笔记（Quiet Recall）。BYOK，支持 OpenAI/DashScope/Google。想听反馈 → [Discussion link]"
- **注意**：Discord 节奏快，一句话钩子是关键

#### Obsidian 论坛 (forum.obsidian.md)

- **格式**：Share & Showcase 版块发帖
- **内容**：复用 Reddit 帖子内容，更正式的语气
- **注意**：Obsidian 团队和核心用户在看，质量要求最高

### 反馈收集设计

帖子末尾附 3 个开放问题，直接验证北极星假设：

1. **How many notes in your vault have you written but never reopened?**
   → 验证问题是否存在
2. **Have you tried combining AI with Obsidian? What's the biggest pain point?**
   → 了解竞争格局和用户期望
3. **If your old notes could automatically appear when relevant, what scenario would be most valuable to you?**
   → 验证"浮现"这个价值主张，收集真实场景

引导回复到 GitHub Discussion（集中管理），不在各平台分散讨论。

### Demo 素材准备

需要一个 15-30 秒的 GIF/视频，展示核心价值循环：

```
用户打开一篇笔记
  → Pet 角落出现 working 状态
  → 点击 Pet → Bubble 浮现
  → Bubble 显示 2-3 篇相关旧笔记（Quiet Recall）
  → 用户点击其中一篇 → 跳转到旧笔记
```

工具建议：macOS 内置录屏 + Gifski 转 GIF，或 CleanShot X。

---

## Phase 2：持续跟进

| 时间 | 动作 |
|------|------|
| 发帖后 24h | 回复所有评论，特别是提问和反馈 |
| 发帖后 1 周 | 汇总反馈模式，记录到 memory |
| 发帖后 2 周 | 评估：是否有新星/fork/Discussion 活跃度变化 |
| 每次发版后 | 在 Discussion 中更新进展，维持社区连接 |

### 反馈处理规则

- 用户说"我想要 X 功能" → 记录但不承诺，问"你现在怎么解决的"
- 用户说"Y 功能没用/不理解" → 重点关注，可能是北极星验证信号
- 用户说"setup 太难了" → 优先改进 BYOK 指南
- 有 3+ 用户提到同一个痛点 → 进入 product decision session

---

## DashScope 试用 Credit（独立后续项目）

**现状：** 当前用百炼平台 API key，不支持直接给用户提供试用额度。

**最轻量方案（待验证百炼平台能力）：**
- 创建子账号 + 设置额度上限 → 分发给试用用户
- 不在插件内做代理转发，避免后端基础设施投入

**前置确认：**
- [ ] 百炼平台是否支持子账号/子 key + 独立额度限制
- [ ] 如果不支持，是否有其他技术路径（如 API Gateway + 限额）

**依赖关系：** 不阻塞 Phase 0 和 Phase 1。社区透出先用 BYOK 指南降低门槛，trial credit 作为后续增长手段独立推进。

---

## 时间线总览

```
本周（Phase 0）
  ├── 开启 GitHub Discussions
  ├── 更新 manifest.json description
  ├── 清理 Renovate bot issues
  ├── 编写 BYOK 快速上手指南
  └── 录制 demo GIF

下次发版后 1-2 天（Phase 1）
  ├── Reddit r/ObsidianMD 发帖
  ├── Obsidian Discord #plugins 发消息
  └── Obsidian 论坛 Share & Showcase 发帖

发帖后 2 周（Phase 2）
  └── 汇总反馈 → 记录 memory → 评估效果

独立项目（不阻塞）
  └── DashScope 试用 credit 技术调研
```

---

## 成功指标

| 指标 | 目标 | 衡量方式 |
|------|------|----------|
| GitHub Discussion 帖子数 | ≥ 5 条用户发起的讨论 | GitHub UI |
| 反馈问题回复率 | ≥ 10 条对 3 个问题的回复 | 帖子评论统计 |
| 新 star | +20 within 2 weeks | GitHub UI |
| BYOK 指南点击/访问 | 有人按指南配置成功 | Discussion 中用户反馈 |
| 北极星验证信号 | ≥ 1 条关于"旧笔记浮现"场景的具体描述 | 反馈内容分析 |
