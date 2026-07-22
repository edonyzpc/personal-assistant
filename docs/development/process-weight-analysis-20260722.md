# Process Weight Analysis — 2026-07-22

## Background

观察到部分任务执行缓慢、token 消耗高。启动 4 个并行 agent 审查文档体系、Skills
系统、AGENTS.md 上下文加载、开发流程设计，诊断是否存在"过重"问题。

---

## 量化现状

| 维度 | 指标 |
|------|------|
| docs/ 文件数 | 138（archive 46 / active 92） |
| docs/ 总行数 | 46,403（archive 22,449 = 48%） |
| 文档层级深度 | 最深 3 层 |
| AGENTS.md | 350 行 / ~5,800 tokens |
| 始终加载指令 | CLAUDE.md + AGENTS.md + North Star ≈ 8,150 tokens |
| Skills 数量 | 11 |
| Skills 总行数 | 1,478 行 / ~67 KB |
| Skill 平均长度 | 134 行 / 6.1 KB |
| Makefile targets | 8 |
| npm scripts | 13 |
| 运行时 + 开发依赖 | 12 + 14 |

---

## 慢 & Token 高消耗的原因分析

### 主因

1. **Max reasoning + Opus 模型** — 最大的放大器。即使简单任务也在最高级别模型上做最深推理。
2. **"Must read before X" 链式触发** — 多数任务会先读 North Star (157行) → AGENTS.md (350行) → documentation-workflow.md (166行)，context 逐步膨胀。
3. **Skills 交叉引用** — 多个 skill 都指示 "Read AGENTS.md"、"Read North Star"，触发重复加载。

### 次因

4. **AGENTS.md 350 行全量加载** — 仅 ~30% 适用于多数日常任务（release/governance/SDD lifecycle 占大头但极少用到）。
5. **Skill description 字段** — 部分描述 50-93 词，11 个 skill 在每轮 system prompt 累积 ~500+ tokens。

---

## 过重诊断

### 确认过重

| 维度 | 现状 | 问题 |
|------|------|------|
| 文档治理 | 5-lane lifecycle (L0-L3+L2G), 9 模板, disposition log | 企业级流程，单人项目不需要 |
| Review Checklist | 470 行 P0/P1 gates, 7 章节 | 10+ 人团队的检查标准 |
| Governance Contracts | GOV-001, GOV-002 | 自己和自己签约 |
| Archive 体系 | 46 文件 / 22K 行 + 正式归档仪式 | git history 足矣 |
| AGENTS.md 密度 | 350 行，含大量低频场景指令 | 可拆分为核心 + 按需 |
| Skill 重复 | review/followup 拆分, beta/stable 拆分 | 可合并减少冗余 |
| Active Package 结构 | 每 feature 要求 README + tracker + plan + SDD | 单人维护成本 > 收益 |
| North Star pre-read gate | 每次产品相关任务必须先读 157 行 | 可内联核心 6 行 |

### 确认合理（不需要动）

- Makefile / CI / lint / test / build 流程
- Backlog 管理（结构清晰、体量适中）
- Architecture docs（11 文件，真正技术参考）
- Release scripting（Obsidian 发布必需）
- North Star 内容本身（短小、方向性好）
- 单个 Skill 的按需加载模式

---

## 精简建议

### P0 — 立即见效（减少日常 token 消耗）

| # | 动作 | 预期收益 |
|---|------|----------|
| 1 | AGENTS.md 拆分：核心 ~150 行 + 按需文件（release.md / governance.md / sdd-lifecycle.md） | 日常加载 -40% |
| 2 | 去掉 North Star pre-read gate，把设计哲学 6 行内联到 AGENTS.md | 减少 1 次 file read round-trip |
| 3 | 合并 review + review-followup skill | -1 skill, -60 行冗余 |
| 4 | 合并 pa-brat-beta-release + stable-release skill | -1 skill, 共享逻辑去重 |
| 5 | 压缩所有 skill description 到 20-30 词 | 每轮 system prompt -500 tokens |

### P1 — 中期精简（减少维护负担）

| # | 动作 | 预期收益 |
|---|------|----------|
| 6 | 文档治理降级：5-lane → 2-lane（quick-fix / feature） | 流程认知负担 -60% |
| 7 | 模板精简：9 → 3（brief-spec / tracker / decision） | 模板维护成本大幅下降 |
| 8 | 删除 Governance Contracts（GOV-001, GOV-002） | 去掉无意义仪式 |
| 9 | Review Checklist 精简：470 行 → 50 行核心要点 | 实际可用性提升 |
| 10 | Skills 提取 shared preamble（severity rules / validation gates） | 多 skill 共用，维护一处 |

### P2 — 可选清理

| # | 动作 | 预期收益 |
|---|------|----------|
| 11 | Archive 瘦身：有 git history 的归档文件可删除 | docs/ -22K 行 |
| 12 | 移除 `docs:check` CI 阻塞或降为 advisory | PR 不因 link 断裂阻塞 |
| 13 | Active Package 结构降级：去掉强制 tracker/closeout | 小变更不需走流程 |

---

## 跨平台影响分析（Claude + Codex）

### 双平台共享架构

```
AGENTS.md (21KB, 350行)
├── Claude 加载路径: CLAUDE.md → "Follow AGENTS.md" → 全文注入 context
└── Codex 加载路径: 原生读取 AGENTS.md → 全文注入 context

SKILL.md (每个 skill 的指令体)
├── Claude: .claude/skills/<name> (路径指针) → .agents/skills/<name>/SKILL.md
└── Codex: .agents/skills/<name>/agents/openai.yaml (元数据) + SKILL.md
```

两个平台读的是**同一份 AGENTS.md、同一份 SKILL.md**。问题双倍，收益也双倍。

### 共享 vs 平台特有

| 层 | 共享 | 平台特有 |
|---|------|----------|
| AGENTS.md | 是 — 双平台均全文加载 | — |
| SKILL.md | 是 — 单一来源 | — |
| agents/openai.yaml | — | Codex only（display_name, short_description） |
| CLAUDE.md | — | Claude only（指针 + north star 摘录） |
| .agents/agents/*.toml | — | Codex only（model, sandbox_mode） |

### 平台差异对优化的影响

| 差异点 | Claude Code | Codex |
|--------|-------------|-------|
| Context 生命周期 | 对话累积，可压缩，有 prompt cache | 每次任务独立，无 cache |
| 按需加载 | tool call 中途读文件 | sandbox 内可读，但预加载更重要 |
| Reasoning 控制 | 可调 effort（low → max） | 模型固定 |
| Skill 触发 | /skill 或自动匹配 | openai.yaml 路由 |

**关键结论**：Codex 每次任务是独立 context，无 prompt cache。AGENTS.md 的 350 行
对 Codex **每次任务都付全额**，而 Claude 至少有 cache 可缓解。因此：

> AGENTS.md 拆分对 Codex 的收益比对 Claude 更大。

### P0 跨平台兼容实现方案

AGENTS.md 拆分的正确结构（双平台均可访问）：

```
AGENTS.md (核心 ~150 行)
├── 始终加载：build / test / architecture / conventions / commit rules
├── 条件指引："When doing release work, read .agents/instructions/release.md"
├── 条件指引："When doing documentation changes, read .agents/instructions/docs-workflow.md"
└── 条件指引："When doing SDD work, read .agents/instructions/sdd-lifecycle.md"

.agents/instructions/  (新目录，按需文件)
├── release.md
├── docs-workflow.md
├── sdd-lifecycle.md
└── governance.md
```

兼容性：
- Claude：看到条件指引 → 判断相关性 → tool call 读取
- Codex：看到条件指引 → 判断相关性 → sandbox 内读取

### 各优先级的跨平台收益

| 动作 | Claude 收益 | Codex 收益 | 备注 |
|------|-------------|------------|------|
| P0#1 AGENTS.md 拆分 | context -40% | context -40%（无 cache 加成更明显） | 需用 .agents/instructions/ |
| P0#2 North Star 内联 | 少 1 次 tool call | 少读 1 文件 | 兼容 |
| P0#3 Skill 合并 review | -1 skill description | -1 openai.yaml 入口 | 需同步删 yaml |
| P0#4 Skill 合并 release | -1 skill description | -1 openai.yaml 入口 | 需同步删 yaml |
| P0#5 Description 压缩 | system prompt -500 tok/轮 | openai.yaml 本来就短，影响小 | Claude 侧为主 |
| P1 文档/模板/checklist | 两边 agent 行为一致简化 | 同左 | AGENTS.md 引用决定行为 |
| P2 Archive/CI | 不影响 agent context | 同左 | 纯仓库层面 |

### Codex 侧独有优化（补充）

| # | 动作 | 预期收益 |
|---|------|----------|
| C1 | 精简 openai.yaml 的 default_prompt（如有冗余上下文） | 减少 Codex 单次任务预加载 |
| C2 | 检查 .agents/agents/*.toml 的 developer_instructions 不重复 AGENTS.md | 避免双重加载 |

---

## 质量保护评估（不妥协质量前提下的取舍）

### 建议取消的动作（删了会损失质量）

| # | 动作 | 保留理由 |
|---|------|----------|
| P2 #11 | Archive 瘦身 | 归档提供快速历史参考，比翻 git log 高效 |
| P2 #12 | 移除 docs:check CI | 链接完整性检查直接守护文档质量 |
| P1 #8 | 删除 Governance Contracts | 内容是代码规约的明确记录，对 AI agent 约束有效 |

### 建议调整幅度（而非取消）

| # | 原建议 | 调整为 | 理由 |
|---|--------|--------|------|
| P1 #6 | 5-lane → 2-lane | 5-lane → 3-lane（去 Discovery + Governance，保 Spec/Active/Archive） | 保留结构化审查 |
| P1 #7 | 9 模板 → 3 | 9 → 5（保留 decision / spec / plan / tracker / SDD） | SDD 和 decision 对质量有守护作用 |
| P1 #9 | 470 行 → 50 行 | 470 行 → 120 行（保留 P0 gates 和核心验证项） | 过短会丢失结构化验证点 |

---

## 关于 Model / Reasoning 的补充建议

- 日常开发任务（lint fix / 小 feature / 文档修改）不需要 max reasoning + Opus，可降到 medium effort 或用 Sonnet
- 仅在复杂架构决策、大规模重构、多文件分析时使用 max reasoning
- 这是成本和速度最直接的调节杠杆，与流程精简独立

---

## 优先级影响总结

| | P0 | P1 | P2 |
|---|---|---|---|
| **解决什么** | 每次对话/任务的 token 消耗 | 长期维护的认知负担 | 仓库体积/美观 |
| **影响谁** | Claude + Codex（模型侧） | 你（维护者侧） | 轻微 |
| **见效方式** | 每轮少加载 token → 更快更省 | 新 feature 步骤更少 | 仓库更干净 |
| **改动性质** | 重组/合并（内容不变） | 删减/简化（内容减少） | 清理（可逆） |
| **跨平台** | 双平台同时受益，Codex 收益更大 | 双平台行为一致简化 | 不影响 agent |

---

## Review 发现 & 修正（2026-07-22 第二轮）

3 个独立 review agent 对上述分析做了对抗性验证，以下是关键发现和修正。

### 修正 1：AGENTS.md 拆分不可行 → 改为重排序

**原提议**：拆分为核心 150 行 + .agents/instructions/ 按需文件

**问题**：
- "核心"部分实际需 ~220 行（超过 150 行目标）
- 7 个 SKILL.md 按名称引用 AGENTS.md 段落（如 "Local Validation Gate from AGENTS.md"），拆分会断链
- Claude Code 没有条件加载语法（无法 "if doing X then load Y"）
- Codex read-only sandbox 下能否动态读额外文件未经验证

**修正后 P0#1**：重排序 AGENTS.md（高频内容前置），不拆分。
- 前半部分（~220 行）：Scope / Build / Testing / Architecture / Memory-VSS / UI-React / Community Review
- 后半部分（~130 行）：Release / PR-Commit / SDD / Documentation / Refactor

收益：agent 更快命中相关指令，低频内容自然被 attention 降权。风险：零。

### 修正 2：Reasoning effort 应升为真正的 P0（最高 ROI）

**原分析**：放在"补充建议"章节，未纳入优先级体系

**Review 发现**：
- settings.local.json 无 reasoning effort 覆写，当前默认 max
- Codex 的 ui-fixer.toml 已使用 `model_reasoning_effort = "medium"`
- 降到 medium 可直接减少 50%+ 输出 token 和推理延迟
- 零重构风险、零迁移成本、即时生效

**修正**：新增 P0#0 — 配置 reasoning effort 为 medium（复杂任务手动提升）

### 修正 3："Skills 交叉引用"说法夸大

**原分析**：称"多个 skill 都指示 Read AGENTS.md、Read North Star，触发重复加载"

**实际验证**（grep 证据）：
- 引用 AGENTS.md 的 skill：仅 1/11（sdd-lifecycle）
- 引用 North Star 的 skill：仅 3/11（sdd-lifecycle, ui-ux-design-audit, pa-docs-lifecycle-manager）

**修正**：降级为次因中的低影响项。Skills 交叉引用不是主要 token 消耗源。

### 修正 4："仅 30% 相关"修正为 ~60%

**原分析**：称 AGENTS.md "仅 ~30% 适用于多数日常任务"

**实际逐段统计**（对 "实现 feature / 修 bug" 类任务）：
- 始终相关：Dev Environment + Build + Testing + Architecture + Memory/VSS + UI/React ≈ 220 行 (63%)
- 偶尔相关：Release + SDD + Docs + Refactor ≈ 130 行 (37%)

**修正**：~60% 对典型编码任务相关，~40% 为低频场景。原 "30%" 来源于仅计算 build commands 的误算。

### 修正 5："35% 减少"修正为 ~25%

**精确量化**：

| 文件 | 字节 | 行 | Tokens |
|------|-----:|---:|-------:|
| AGENTS.md | 21,397 | 350 | ~5,349 |
| CLAUDE.md | 1,292 | 38 | ~323 |
| settings.local.json | 719 | 22 | ~180 |
| **始终加载小计** | **23,408** | **410** | **~5,852** |
| North Star（多数任务触发） | 7,169 | 157 | ~1,792 |
| **有效总加载** | **30,577** | **567** | **~7,644** |

AGENTS.md 重排序不减少 token（内容不变），但 reasoning effort 从 max → medium 可减
少 50%+ 的输出 token。真正的 "35% context 减少" 需要删除内容（P1 级别动作）。

### 修正 6：补充发现

- **Codex .toml agents 不加载 AGENTS.md** — 它们有独立的 `developer_instructions`，且不重复 AGENTS.md 内容。C2 优化项为误判，删除。
- **pa-linear-product-manager skill 指针悬空** — 目标目录不存在，应清理。
- **Skill description 是否可控** — 由 SKILL.md frontmatter 的 `description` 字段决定，Claude Code 将其注入 system prompt。压缩该字段确实可减少每轮开销。

---

## 修正后的优先级（最终版）

### P0 — 即时生效、零风险

| # | 动作 | 预期收益 | 风险 |
|---|------|----------|------|
| 0 | **配置 reasoning effort = medium**（默认），复杂任务手动提升到 high/max | 输出 token -50%+，延迟显著降低 | 零 |
| 1 | AGENTS.md 重排序（高频前置，低频后移） | Agent attention 更快命中相关指令 | 零 |
| 2 | North Star 核心 6 行内联到 AGENTS.md，去掉 pre-read gate | 少 1 次 file read（~1,792 tokens + round-trip） | 极低 |
| 3 | 合并 review + review-followup skill | -1 skill, -60 行冗余 | 低 |
| 4 | 合并 pa-brat-beta-release + stable-release skill | -1 skill, 共享逻辑去重 | 低 |
| 5 | 压缩所有 skill description 到 20-30 词 | system prompt -500 tok/轮 | 低 |
| 6 | 清理 pa-linear-product-manager 悬空指针 | 去除无效配置 | 零 |

### P1 — 中期精简（需权衡质量）

| # | 动作 | 预期收益 |
|---|------|----------|
| 7 | 文档治理：5-lane → 3-lane | 流程认知负担减少 |
| 8 | 模板：9 → 5 | 维护成本下降 |
| 9 | Review Checklist：470 → 120 行 | 实际可用性提升 |
| 10 | Skills 提取 shared preamble | 多 skill 共用，维护一处 |

### P2 — 可选清理（不影响性能）

保持原有分析不变（#11 Archive, #12 docs:check, #13 Active Package）。

---

## 度量计划

为验证优化效果，需在执行前后收集：

| 指标 | 采集方式 | 基线时机 |
|------|----------|----------|
| 典型任务 token 消耗 | Claude API usage / Codex task 报告 | P0 执行前记录 3-5 个典型任务 |
| 任务响应延迟 | wall-clock（首 token 到完成） | 同上 |
| system prompt token count | 从 Claude 对话开头的 usage 字段读取 | P0#5 执行前后对比 |
| 主观流畅度 | 使用感受记录 | 持续观察 |

---

## 下一步

1. **立即执行 P0#0**：配置 reasoning effort = medium
2. P0#1-6 按序执行，每项完成后用度量计划验证
3. P1 待 P0 验证效果后决定是否推进
4. P2 作为低优先级 backlog 保留
