# Handoff: Pagelet v2.9 LLM Integration — Validation Tasks

> 本文档记录 2026-07-17 实现会话中未完成的测试验证工作，交接给后续 Codex 执行。

## 背景

本次会话完成了 Pagelet v2.9 dogfooding 问题的全部实现工作（10 commits），但以下验证步骤需要在 Obsidian 运行时环境中完成，无法在纯 CLI 中执行。

## 前置条件

- `make deploy` 已执行（assets 已部署到 `test/.obsidian/plugins/personal-assistant/`）
- 有一个已配置 AI provider（API key）的 Obsidian test vault
- Vault 中至少有 10+ 篇有内容的笔记（含 tags、headings、相互链接）

## 待完成验证清单

### 1. Scope Recap LLM 端到端验证

**触发方式**：Command Palette → "Pagelet: Build scope recap"

**验证项**：
- [ ] LLM 被调用（观察网络请求或 cost tracker）
- [ ] 返回的 Recap 内容是 LLM 生成的洞察（不是旧的 tag 统计 "Theme: #tag — appears across N notes"）
- [ ] 洞察引用了具体笔记标题（sourceRefs 不为空）
- [ ] 内容语言跟随笔记语言（中文笔记 → 中文洞察）
- [ ] 当笔记 < 2 篇时，Recap 不调用 LLM（沉默或 low-coverage 状态）
- [ ] 当 AI provider 未配置时，Recap 静默（不报错、不展示 Bubble delivery）

**失败降级验证**：
- [ ] 模拟 LLM 失败（断网或无效 API key）→ Recap 结果为空 sections（沉默），无 Bubble "View Recap" 推送

### 2. Quiet Recall LLM "Why Now" 端到端验证

**触发方式**：打开一篇与其他笔记有语义关联的笔记，等待 Recall nudge 出现

**验证项**：
- [ ] Quiet Recall Bubble nudge 的 whyNow 文本是 LLM 生成的具体关联推理（不是模板 "This saved insight references the note you are viewing"）
- [ ] whyNow 语言跟随笔记语言
- [ ] 无说服力的候选被过滤（不展示）
- [ ] 60 秒 cooldown 生效：快速切换笔记时，第二次切换不触发 LLM（走规则引擎）
- [ ] 60 秒后再次切换笔记时，LLM 评估恢复

**语言重试验证**：
- [ ] 打开中文笔记，如果 LLM 首次返回英文 whyNow → 自动重试一次 → 第二次返回中文

**降级验证**：
- [ ] AI provider 未配置时 → 使用规则引擎结果（模板 whyNow），不报错
- [ ] 单个候选 LLM 调用失败 → 该候选被过滤，其他候选不受影响

### 3. Bubble 上下文行动区验证

**触发方式**：点击 Pet 打开 Bubble

**验证项**：
- [ ] 当有 recall candidates 存在但未通过展示门槛时，Bubble 底部显示 "N related notes found" + "Discover" 按钮
- [ ] 点击 "Discover" → Bubble 关闭 → 触发 Discover Connections 流程
- [ ] 视觉：上下文行动区通过留白 + 字号降级与主内容区分隔（无虚线）
- [ ] 当无 unconvincing candidates 时（count = 0），上下文行动区不出现

### 4. Pet 长按菜单验证

**触发方式**：在 Pet 上长按 520ms

**验证项**：
- [ ] 长按后出现 3 项菜单：Capture / Review / Discover
- [ ] 点击 "Capture" → 打开 Quick Capture
- [ ] 点击 "Review" → 触发 Review Current Note
- [ ] 点击 "Discover" → 触发 Discover Connections
- [ ] 菜单 3 秒后自动消失
- [ ] 点击菜单外区域 → 菜单消失
- [ ] 单击 Pet（非长按）→ 正常 toggle Bubble，不出现菜单
- [ ] 移动端：长按行为一致（touch events）

### 5. 字号对齐验证

**触发方式**：Obsidian Settings → Appearance → Font size 调大/调小

**验证项**：
- [ ] Pagelet Tab 中所有文本跟随设置变化（h2、h4、body、tags、buttons）
- [ ] Pagelet Panel 中所有文本跟随设置变化
- [ ] 极端字号（24px+）下布局不断裂（内容重排但不溢出/重叠）
- [ ] 默认字号（16px）下 h4 不与 title 同大小（h4 = 14px，title = 16px）

### 6. 卡片样式验证

**触发方式**：触发 Scope Recap 或 Review → 查看 Detail View

**验证项**：
- [ ] LLM 生成的洞察卡片有左侧彩色竖条（insight style）
- [ ] hover 时卡片有微妙的 box-shadow + border 变化
- [ ] 不同 section type（theme/tension/open_question）可能使用不同卡片样式
- [ ] 暗色/亮色主题下 hover shadow 都可感知

### 7. 3-Second Value Test（主观验证）

**流程**：
1. 关闭所有 spec/文档
2. 打开 Obsidian，正常写 2-3 分钟笔记
3. 点击 Pet
4. 记录："这 3 秒内我看到的东西，值得我明天再点一次吗？"

**记录项**：
- [ ] Bubble 展示的内容是什么？（Recap delivery / Recall nudge / context action / explanation state）
- [ ] 内容是否让人想看完？
- [ ] 如果触发了 Recap，洞察质量如何？（具体 / 泛泛 / 废话）
- [ ] 如果触发了 Recall，whyNow 是否让人理解关联？
- [ ] 整体判断：pass / fail + 原因

### 8. Cost/Rate 验证

**验证项**：
- [ ] 频繁切换笔记（10 次/分钟）时，LLM 调用不超过 1 次（60s cooldown）
- [ ] pageletCostTracker 正确记录 input/output tokens
- [ ] Scope Recap 单次调用 token 消耗在预期范围（input ~2-5k, output ~500-1k）

## 已知的预存问题（不在本次验证范围）

- `__tests__/plugin-record-note.test.ts:2069` 有一个预存的测试失败（memory governance bootstrap），与本次改动无关
- `buildQuietRecallCandidates` 仍然作为 import 保留（在 early-return 路径中使用），不是 dead code

## 验证通过标准

全部 checklist 通过 + 3-Second Value Test 主观判断为 pass → 可以继续下一步（prompt 调优或发布 beta.2）

如果 3-Second Value Test 判断为 fail → 记录具体原因，优先调整 prompt（`src/pa/pagelet-prompts.ts`）而非架构。
