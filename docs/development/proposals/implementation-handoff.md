# Implementation Handoff Brief

Updated: 2026-07-30
Target: Codex (implementation advisor → designer → developer → tester)
Authority: Project owner decision

---

## Background

PA Agent 需要两项核心能力演进：
1. **Pagelet Agent 化**：让 AI 深度参与笔记分析，产出当前 single-shot 管道做不到的跨笔记深层洞察
2. **Operations 能力**：让 Agent 能将对话结论写入 vault，以及执行 Pagelet 推荐的动作

方向已验证（Pagelet Agent 实验在真实 vault 上产出了 6 条高价值跨笔记洞察，用户确认有价值）。设计决策已确定。现在需要进入 SDD 设计和实现。

---

## 你的角色

**Implementation advisor → designer → developer → tester**

你需要做的：
1. 为每个 Step 编写 SDD（实现设计）
2. 实现代码
3. 通过 `make deploy` 验证
4. 在真实 vault 上 dogfood 验证

你不需要做的：
- 重新评判方向是否正确（已决定）
- 添加治理流程（无需 Decision/Spec/Active Package 审批链）
- 重新讨论已决策的设计选择

---

## 必读文档（按此顺序）

1. `docs/development/proposals/proposal-review-response-2026-07-28.md` — **权威决策记录**，所有设计决策和规则在这里
2. `docs/development/proposals/pagelet-agent/pagelet-agent-proposal.md` — Pagelet Agent 方向文档（含实验验证）
3. `docs/development/proposals/operations-agent/agent-operations-capability.md` — Operations 方向文档
4. `docs/architecture/pa-agent-architecture-plan.md` — 当前 PA Agent 架构（实现基础）
5. `src/ai-services/pa-agent-loop.ts` — PaAgentLoop 源码（Pagelet Agent 复用基础）
6. `src/ai-services/chat-tool-factories.ts` — 现有工具定义（复用基础）

---

## 实施计划

### Step 1：Pagelet Agent Deep Discover

**目标**：实现 agent loop 并在真实 vault 上验证比 single-shot 更好。

**完成标准**：
1. 实现 agent loop（复用 PaAgentLoop，Pagelet mode 配置）
2. 能以一篇笔记为锚点，自主使用 vault 读工具探索
3. 在真实 vault 上跑 20+ 个 case，和 single-shot 做对比
4. 对比结果证明质量有提升（dogfood 判断）
5. 触发机制可用（编辑结束后 / 显式触发）
6. 结果能在 UI 中展示（复用现有 Panel/Bubble）
7. 无 insight 时保持沉默（不凑数）

**技术问题必须解决**：
- T1: 锚点冻结（path + content + mtime snapshot；使用 path-bound 工具变体）
- T2: Cache 失效（anchor snapshot + source snapshots + Data Boundary identity + pipeline version）
- T3: 质量门（source 验证 + novelty check vs 已有 backlinks 和已展示 insights）
- T4: 并发调度（Chat 优先，Pagelet 暂停；简单信号量）
- T5: 成本控制（36 次/天上限 + 熔断器 30 calls/180s + Settings 展示消耗量）
- T6: B-121 集成（Agent insight 转为 DeliveryCandidate，参与 Attention-Aware Delivery 管道）
- T7: 迁移（直接替换所有 single-shot 管道：preload/discovery/review/recap/quiet-recall）

**已确认的设计选择**：
- Agent loop: 复用 PaAgentLoop + Pagelet mode config（LeadDrivenPolicy + insight cache 输出）
- 模型: 和 Chat Agent 用同一个模型
- Token 预算: 不设 per-run 限制，后续优化
- 每日上限: 36 次/天
- 迁移: 直接替换，Agent 上线后关掉 single-shot
- UI: 复用 Bubble → Panel，insight 作为 DeliveryCandidate 进入 B-121 管道
- 输出: 不强制结构化 schema，Agent 自由表达
- 读工具子集: search_memory, get_current_note_context(anchor-bound), search_vault_snippets, inspect_obsidian_note, search_vault_metadata, list_recent_notes, read_note_outline + webSearch
- 停止逻辑: lead-driven（Agent 自己判断），正常预期 8-12 tool calls，熔断器 30/180s
- 质量: source grounding + novelty check，不靠 model confidence

**实现基础**：
- `PaAgentLoop` 已有多轮、工具预算、墙钟限制、取消和 host policy
- 需要新增 Pagelet mode 的 policy（LeadDrivenPolicy）
- 需要新增 anchor freeze 机制（path-bound 工具变体）
- 需要输出 sink 写到 insight cache（非 chat stream）
- 需要 insight → DeliveryCandidate 适配层（接入 B-121）
- 需要移除现有 single-shot 调用路径

---

### Step 2：Operations Phase 1 — Chat 对话结论落地

**目标**：用户在 Chat 中讨论后能将结论保存到 vault。

**完成标准**：
1. 4 个核心写入 tool 可用（vault_create / vault_append / vault_process / frontmatter_update）
2. Agent 能在对话中主动建议保存（触发条件生效）
3. Agent 能自主判断写入目标（路径+文件名），无法判断时 fallback 到 0.unsorted/
4. 使用 obsidian-markdown skill 指导内容格式
5. 内联确认 UI 可用（Chat 中展示目标+预览 → 确认/取消）
6. 写入成功后展示结果 + 撤销按钮
7. 审计日志记录（content-free）
8. dogfooding：日常对话中能自然地将结论保存到 vault

**技术问题必须解决**：
- T6: 原子性（使用 vault.process() 原子回调）
- T7: 回滚 drift 检测（current == expected after-state）
- T8: 目标 stale re-read（确认后到执行间重新验证）
- T9: 审计隐私（content-free default，full diff opt-in）
- T11: Rollback 存储独立于审计（短期内存/临时缓存，和 content-free 审计日志分开）
- T12: vault_create 文件已存在时返回 error（不覆盖）
- T13: vault_process.search 使用字面匹配（不支持正则）
- T14: vault_process heading 参数为纯文本（不含 # 前缀），找不到时返回 error
- T15: 多文件操作逐步执行，部分失败时汇报状态，用户可选回滚已完成部分
- T16: 主动建议频率：每次对话最多 1 次，拒绝后不再建议，Settings 可关闭
- T17: 单意图多操作 = 一次确认（展示所有涉及文件）

**关键设计约束**：
- vault_process 只有 3 种 operation：replace / insert / delete
- 写工具按需加载（Agent 识别到写意图时才加载，不常驻）
- 确认 UI 内联在对话中（不弹 modal）
- Agent 主动建议保存的触发：对话产出明确结论/决策/结构化分析时
- 不触发的情况：闲聊、探索中、vault 外话题
- 写入目标判断依据：对话引用的笔记、内容成熟度、vault 现有结构
- 内容格式由 Agent 根据深度判断 + obsidian-markdown skill 指导

**实现基础**：
- 写工具注册到 CapabilityRegistry
- 确认 UI 复用现有 Chat 渲染管道
- 审计日志写入 `.obsidian/plugins/personal-assistant/audit/`
- 每次操作独立 JSON 文件（防多设备 conflict）

---

### Step 3：Pagelet + Operations 联动

**目标**：Pagelet 发现 insight 后用户能一键执行动作或升级到 Chat 讨论。

**完成标准**：
1. Pagelet insight card 展示 action 按钮（根据 insight 内容生成具体动作文案）
2. 简单动作（加链接、改 frontmatter）点击后内联确认 → 直接执行
3. 复杂动作点击后带上下文进入 Chat Agent 继续讨论
4. Chat 和 Pagelet 共享写入 tool 层（同一套实现）
5. dogfooding：从 Pagelet 发现 → 一键执行或升级到 Chat → 结论落地，全链路可用

**技术问题必须解决**：
- T10: Pagelet → Chat 上下文传递（insight + sources + reasoning 完整传入）

**关键设计约束**：
- Pagelet 和 Chat 是同一个伙伴的两种模式，共享写入层
- 简单 vs 复杂的路由判断：涉及单文件 + 确定性操作 = 简单；涉及多文件 / 需要用户判断 / 不确定性高 = 复杂

**依赖**：Step 1 和 Step 2 都 functional 之后才开始。

---

## 约束（硬性规则）

1. **不要重新讨论已决策的设计** — 15 条已决策见 review-response §6
2. **不要添加治理流程** — 过程是：SDD → 实现 → make deploy → dogfood
3. **不要删除 proposal 文件** — 它们是方向文档，永久保留
4. **不要扩展 Operations scope** — Step 2 只有 4 个 core tools，其他延后
5. **不要强制 Pagelet 输出 schema** — Agent 自由表达，质量靠 source grounding
6. **不要用代码执行 / eval** — 结构化 tool call only
7. **model freedom 优先** — 当设计有选择时，选给模型更多自由度的方案
8. **验证用 make deploy** — 确保 lint/build 全链路通过
9. **commit 规范** — git commit -s 签名，不加 Co-Authored-By

---

## 开始方式

1. 先读完必读文档
2. 选择一个 Step 开始（Step 1 或 Step 2，可并行）
3. 为该 Step 编写 SDD（需要解决对应的技术问题）
4. SDD 完成后开始实现
5. 实现后 `make deploy` 验证
6. 在真实 vault 上 dogfood

如有技术问题需要澄清（不是方向问题），可以提出。方向问题请 escalate 给 owner。
