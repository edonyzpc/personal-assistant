# Agent Operations 能力层

Document status: Current
Delivery status: Closed
Updated: 2026-08-01
Work item: B-101
Authority: [Owner decision record](../proposal-review-response-2026-07-28.md)、[DEC-014](../../../product/decisions/dec-014-defer-operations-agent.md) 与 [DEC-011](../../../product/decisions/dec-011-capability-policy-boundary.md)。
Restart condition: Step 2/3 已关闭；额外写工具或 Pagelet 直接动作仍需独立需求证据、新 work item 与 owner 授权。

> 定义 PA Agent 在 Obsidian vault 中的写操作能力。
> 核心场景：Chat 对话结论落地到 vault + Pagelet insight 的推荐动作执行。
> 出发点：Agent 能力必要性——成熟的 Obsidian AI 助手必须能操作 vault。

---

## 1 · 需求场景

### 1.1 主场景：Chat 对话结论落地

用户在 Chat Agent 中讨论 vault 内容（分析、推理、脑暴），讨论成熟后将结论持久化到 vault：

```
用户与 Chat Agent 讨论 vault 内容
    ↓
对话到达一定深度，产出结论/决策/分析
    ↓
触发方式：
  - 用户显式请求："把这段总结保存到 vault"
  - Agent 主动建议："这个结论值得保存，要帮你写入 vault 吗？"
    ↓
Agent 判断写入目标：
  - 自主判断（根据 vault 结构和对话意图），确认时展示目标
  - 无法判断时 fallback 到默认路径（如 0.unsorted/）
    ↓
Agent 生成内容：
  - 根据内容深度判断格式（结构化笔记 vs 简洁要点）
  - 使用 bundled obsidian-markdown skill 指导格式
    ↓
确认 → 执行写入
```

### 1.2 辅助场景：Pagelet Insight 简单动作

> Step 3 delivered：本节与 1.3 已按 [focused SDD](./operations-agent-step3-sdd.md) 交付；直接动作仍限单文件、确定性、显式确认。

Pagelet Agent 发现 insight 后，当前 Step 3 只开放一个简单直接操作：

- 在 insight anchor note 的 `pa-related` Property 中加入一条指向所选 source note 的单向 wikilink。

用户在完整 insight Panel 点击 action → 查看内联预览 → 确认 → 执行。互相链接、
任意 tag/status 更新与正文/section append **不属于当前 Pagelet 直接动作**；需要这些变更时
进入 Chat 讨论并使用已有 Operations 确认流，是否扩为新的 Pagelet 直接动作留待未来独立授权。

### 1.3 升级场景：Pagelet → Chat 协作

Pagelet 发现的 insight 中，部分推荐动作是复杂的，需要讨论和澄清：

```
Pagelet Agent 发现复杂 insight
  → 推荐动作需要 Agent 推理能力（如"这几篇笔记应该整合"）
  → 带上下文进入 Chat Agent
  → 用户与 Agent 讨论具体怎么做
  → 讨论结论落地到 vault（回到主场景）
```

### 1.4 Pagelet 和 Chat 的关系

不是两个并列的独立 Agent，而是**同一个伙伴的两种工作模式**：

| | Pagelet 模式 | Chat 模式 |
|---|---|---|
| 性质 | 安静观察、主动发现 | 主动对话、深度讨论 |
| 触发 | 系统事件 | 用户提问 |
| 写能力 | 单向 `pa-related` 直接动作 | 对话结论落地及其他修改 |
| 升级 | 复杂问题 → 交给 Chat | — |

**写能力是共享的底层**，两种模式通过同一套写入工具操作 vault。

---

## 2 · 竞品参考

| 能力 | Obsidian Copilot | Claudian | PA (当前) | PA (目标) |
|------|-----------------|----------|-----------|-----------|
| 笔记问答 | ✓ | ✓ | ✓ | ✓ |
| Web 搜索 | ✓ | ✓ | ✓ | ✓ |
| 跨笔记深度分析 | ✓ (Vault模式) | ✓ | 弱 | ✓ (Pagelet Agent) |
| 生成新笔记 | ✓ | ✓ | ✓ (Step 2 opt-in) | ✓ |
| 修改现有笔记 | ✓ | ✓ | ✓ (Step 2 opt-in) | ✓ |
| 多步任务执行 | ✓ (Agent模式) | ✓ | ✓ (intent-level opt-in) | ✓ |
| 后台主动发现 | ✗ | ✗ | ✓ (Pagelet) | ✓ (Pagelet Agent) |

**PA 的差异化**：后台主动发现（竞品没有）+ 安静可信的交互模式。
**PA 的当前交付**：Step 2 已补齐有界 Chat 写入；Step 3 已交付 Pagelet 单文件确认动作与完整 Chat handoff。

---

## 3 · 所需写入能力

### 3.1 核心写入操作（覆盖 90% 场景）

| Tool | 用途 | 场景 |
|------|------|------|
| `vault_create` | 创建新笔记 | Chat 结论生成新笔记；Pagelet 创建 MOC 走 Chat/未来授权 |
| `vault_append` | 追加内容到笔记末尾 | Chat 结论追加到已有笔记；Pagelet append 走 Chat/未来授权 |
| `vault_process` | 在已有笔记的指定位置插入/替换/删除 | Chat 修改；Pagelet section/link 修改走 Chat/未来授权 |
| `frontmatter_update` | 修改 frontmatter 属性 | Chat 可加 tag/改 status；当前 Pagelet 只设置单向 `pa-related` |

当前 Step 3 不把 Chat 已有的四个工具等同于四类 Pagelet 直接动作。Pagelet Panel 仅以
确定性本地参数调用一次 `frontmatter_update`，目标固定为 anchor note，字段固定为
`pa-related`，值为保留既有 scalar/array 内容、去重后追加 source wikilink 的数组。

### 3.2 vault_process 的三种 operation

```typescript
vault_process: {
  path: string;
  operation: 'replace' | 'insert' | 'delete';
  params: ReplaceParams | InsertParams | DeleteParams;
}

ReplaceParams: {
  search: string;
  replace: string;
  occurrence?: 'first' | 'all';  // 默认 'first'
}

InsertParams: {
  anchor: { heading: string } | { line: number };
  position: 'before' | 'after';
  content: string;
}

DeleteParams:
  | { section: string }
  | { from: number; to: number }
```

### 3.3 辅助操作（按需扩展）

| Tool | 用途 | 优先级 |
|------|------|--------|
| `vault_create_folder` | 创建文件夹 | 低——大部分时候写入已有目录 |
| `file_rename` | 重命名/移动（自动更新 backlinks） | 中——整理 vault 结构时需要 |
| `vault_trash` | 移到回收站 | 低——谨慎操作 |
| `generate_link` | 生成正确格式的 wikilink | 辅助——插入链接时确保格式 |
| `command_execute` | 执行 Obsidian 命令 | 延后——需要更多验证 |
| `command_list` | 列出可用命令 | 延后 |

### 3.4 不暴露的 API

| 类别 | 原因 |
|------|------|
| Workspace layout | UI 编排不是 Agent 职责 |
| Editor 光标/选区 | 太底层 |
| DataAdapter | 绕过 Vault 抽象，不安全 |
| Node/Electron API | 安全边界外 |
| DOM 操作 | UI 层面 |

---

## 4 · Agent 主动建议保存的触发设计

### 4.1 触发条件

Agent 在以下情况主动建议"要保存到 vault 吗"：

- 对话产出了**明确结论或决策**（不是还在探索中）
- 对话产出了**结构化分析**（对比表、优缺点、方案设计）
- 对话产出了**可执行的方案**（步骤、计划、设计决策）
- 用户明确说"总结一下"/"帮我梳理一下"等收敛性指令

### 4.2 不触发的情况

- 闲聊、简短问答
- 用户还在探索中（连续追问、没有收敛）
- 对话内容是关于 vault 外的事情

### 4.3 建议方式

内联在对话中，不打断：

```
Agent：[完成了分析内容]

      这个分析可以保存到 vault。建议写入 `3.literature/literature-AI/agent-security-summary.md`。
      [保存] [不用]
```

---

## 5 · 写入目标判断

### 5.1 Agent 自主判断逻辑

Agent 根据以下信号判断写到哪：

| 信号 | 判断依据 |
|------|---------|
| 对话中引用了哪些笔记 | 如果讨论围绕某篇笔记 → 考虑追加到该笔记 |
| 内容的成熟度 | 完整结论 → `4.permanent/`；思考过程 → `3.literature/`；快速记录 → `0.unsorted/` |
| 用户显式指定 | "保存到 xxx" → 直接用指定路径 |
| vault 现有结构 | 根据主题匹配已有目录和笔记 |

### 5.2 Fallback

无法判断时 → 建议写入 `0.unsorted/`（vault 的 inbox，符合 GTD 工作流）。

### 5.3 确认展示

```
保存到：3.literature/literature-AI/agent-security-summary.md（新建）
内容预览：
  [前 3 行预览...]
[确认] [换个位置] [取消]
```

---

## 6 · 确认与安全机制

### 6.1 内联确认（非弹窗）

所有写操作确认内联在交互流程中：

**Chat 场景**：Agent 展示目标和内容摘要 → [确认] [取消]
**Pagelet 场景（Step 3）**：用户打开完整 insight card，确定性单文件动作切换为确认态 → [确认] [取消]

### 6.2 风险分级

| 操作 | 风险 | 确认方式 |
|------|------|---------|
| 创建新笔记 | 低 | 一键确认（展示路径和内容预览） |
| 追加到已有笔记 | 低-中 | 展示目标笔记 + 追加内容 |
| 修改已有笔记内容 | 中 | 展示具体变更（mini diff） |
| 修改 frontmatter | 低 | 展示属性变化 |
| 重命名/移动 | 高 | 展示影响范围（多少 backlinks 会更新） |
| 删除 | 高 | 明确标注 + 展示 |

### 6.3 审计

- 所有写操作记录到 `.obsidian/plugins/personal-assistant/audit/`
- 每次操作一个独立 JSON 文件（防多设备 conflict）
- 默认只记录 content-free metadata（操作类型、目标路径、状态）
- 完整 before/after 内容 opt-in
- 30/90 天自动清理

### 6.4 回滚

- 即时撤销：操作完成后内联 [撤销] 按钮；Step 2 receipt 只在当前运行时内存中短期保留
- 历史回滚：未来能力，不属于 Step 2，也没有操作历史 Tab
- 回滚前验证：当前内容 == 操作后的 expected 状态，否则 fail closed
- 文件已被用户编辑 → Step 2 fail closed 并报告 drift，不提供继续覆盖或 diff 决策 UI

---

## 7 · 实现形态

### 7.1 结构化 Tool Call

写操作以结构化 tool call 实现，不使用代码执行/eval：

```typescript
// 核心 4 个
vault_create:       { path: string; content: string } → { success, file }
vault_append:       { path: string; content: string } → { success }
vault_process:      { path: string; operation: 'replace'|'insert'|'delete'; params } → { success }
frontmatter_update: { path: string; set?: Record; delete?: string[] } → { success }
```

### 7.2 按需加载

- 读工具：常驻（~1.5K tokens）
- 写工具：每个 run 按需暴露——仅当最新用户消息命中显式写意图时加载
- 后续 turn 重新判断写意图；不会因为同一对话曾加载过就持续暴露

### 7.3 内容生成指导

Agent 生成写入内容时：
- 对 substantial Markdown 加载 bundled `obsidian-markdown` skill 获取格式规范
- 根据 vault 的 Zettelkasten 结构判断 frontmatter 字段
- 直接生成 Obsidian-compatible wikilink；Step 2 不导出 `generate_link` tool

---

## 8 · 与现有系统的关系

### 8.1 与 B-101 Operations Agent Plan

| 维度 | B-101 原方案 | 本方案 |
|------|-------------|--------|
| 出发点 | 安全边界先行 | 需求场景先行 |
| 首个能力 | append-to-current-note（单一操作） | Chat 结论落地（含 create/append/process/frontmatter） |
| 确认机制 | 4-gate 逐操作 | 意图级内联确认 |
| 扩展方式 | 每个 action family 单独审批 | 按需求场景逐步验证扩展 |

本方案不否定 B-101 的安全考量（target confinement、stale check 等仍有价值），但从需求侧重新组织优先级。

### 8.2 与 Write Action Framework

现有 WAF 代码（runtime flag 关闭）渐进过渡：
1. 本方案独立实现
2. WAF 代码保留（不影响运行时）
3. 验证通过后评估 WAF 可复用部分
4. 清理无价值的旧代码

### 8.3 与 Pagelet Agent

Step 3 共享同一套写入工具层：Pagelet action 按钮触发简单单文件写入，或带完整可见上下文升级到 Chat。实现边界与 T10 传递契约见 [Step 3 SDD](./operations-agent-step3-sdd.md)。

---

## 9 · 实施路径

### 9.1 Phase 1：Chat 对话结论落地（Delivered 2026-08-01）

交付与验证证据见 [Step 2 SDD](./operations-agent-step2-sdd.md#14-closeout-evidence-2026-08-01)。

- 实现 4 个核心写入 tool（create/append/process/frontmatter_update）
- 实现内联确认 UI
- 实现 Agent 主动建议保存的触发逻辑
- 实现写入目标自主判断 + fallback
- 审计日志（content-free）
- 验证：dogfooding 日常使用 Chat 讨论后保存到 vault

### 9.2 Phase 2：Pagelet 简单 Action（Delivered 2026-08-01）

- Pagelet 完整 insight Panel 的 action 按钮接入共享写入层
- 当前直接动作仅为 anchor note → source note 的单向 `pa-related` wikilink
- 互链、tag/status、正文/section append 与其他复杂操作升级到 Chat；未来若要直接执行需独立授权
- 验证：Pagelet 发现 insight → 预览并确认单向链接 → 可撤销

### 9.3 Phase 3：扩展操作（未授权；按独立需求重启）

- file_rename（当整理结构成为高频需求时）
- command_execute（当有明确安全场景时）
- 更复杂的多文件操作

### 9.4 不做的

- 通用代码执行 / eval
- 任意 Obsidian command 不设 allowlist
- 全自动后台写入（无用户确认）
- 完整 before/after content 默认持久化

---

## 10 · 技术问题（SDD 必须解决）

| ID | 问题 | 描述 | 方案 |
|----|------|------|------|
| T6 | 原子性 | append/modify 之间可能并发编辑 | 使用 `vault.process()` 原子回调 |
| T7 | 回滚 drift | 用户编辑后 before-snapshot 覆盖新工作 | 回滚前验证 current == expected after；drift 时 fail closed |
| T8 | 目标确认 stale | 确认后到执行间目标笔记被修改 | 执行前 re-read 验证 |
| T9 | 审计隐私 | 笔记内容不应默认持久化 | 默认 content-free；full diff opt-in |
| T11 | Rollback 存储 vs 审计分离 | 审计默认 content-free，但回滚需要 before-snapshot | 定义独立的短期回滚缓存（内存/临时文件），和审计日志分开；回滚窗口过期后清除 |
| T12 | vault_create 已存在行为 | 文件已存在时 create 应该怎样 | 返回 error，不覆盖；Agent 需先检查或使用 vault_append |
| T13 | vault_process.search 匹配方式 | 字面匹配还是正则 | 字面匹配（安全、可预测）；不支持正则 |
| T14 | vault_process heading 格式 | heading 参数格式和找不到时的行为 | 参数为 heading 文本（不含 `#` 前缀）；找不到时返回 error |
| T15 | 多文件原子性 | 未来一个意图涉及多文件（如双向链接），部分失败怎么办 | 不进入当前 Pagelet 直接动作；先走 Chat，未来扩展时再定义逐步执行与回滚策略 |
| T16 | 主动建议频率控制 | Agent 每条消息都建议保存会很烦 | 每次对话最多建议 1 次；用户拒绝后同一对话不再建议；可在 Settings 关闭 |
| T17 | 单意图多操作确认 | 未来“添加双向链接”= 两个操作，几次确认？ | 当前 Step 3 不开放；走 Chat 现有 intent 预览，未来 Pagelet 扩展需独立决策 |

---

## 11 · 设计决策记录

| # | 决策 | 理由 |
|---|------|------|
| D1 | 从需求场景出发，不从 API 能力出发 | 避免过度设计不被使用的能力 |
| D2 | 主场景是"Chat 对话结论落地到 vault" | 竞品验证 + 使用场景分析 |
| D3 | Agent 主动建议保存（对话深度/结论类型触发） | 降低用户操作负担 |
| D4 | Agent 自主判断写入目标 + fallback 到 0.unsorted | 平衡智能和确定性 |
| D5 | 内容格式由 Agent 判断 + obsidian skill 指导 | 适应不同深度的内容 |
| D6 | Pagelet 和 Chat 共享写入层，但触发/确认流程不同 | 统一底层能力，差异化产品行为 |
| D7 | Pagelet 复杂 action 升级到 Chat | 同一伙伴的两种工作模式 |
| D8 | 结构化 tool call，不用代码执行 | 类型安全、可预览、无 eval 风险 |
| D9 | vault_process 精简为 3 种 operation | 最少原子操作，靠 Agent 组合 |
| D10 | 写工具按需加载 | 避免 token 浪费和幻觉 |
| D11 | 确认 UI 内联在对话/卡片中 | 不打断心流 |
| D12 | 审计默认 content-free | 隐私保护 |
| D13 | 回滚需验证 drift | 防止覆盖用户后续编辑 |
| D14 | command_execute 延后 | 需要更多场景验证 |
| D15 | Phase 1 只做 Chat 结论落地 | 最高频场景先验证 |
