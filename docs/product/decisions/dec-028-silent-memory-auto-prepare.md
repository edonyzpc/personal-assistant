# DEC-028 — 首次 Memory 构建采用静默后台准备，不阻断用户交互

Decision ID: DEC-028
Status: Accepted
Updated: 2026-08-11
Work item: B-126
Authority: Owner 于 2026-08-11 在 PR #378 当前 review follow-up 中明确选择方案 A：保留首次 Chat 静默后台 whole-vault Memory 构建；同日后续明确选择方案 1：IndexedDB marker 状态未知时 destructive rebuild fail closed。两项选择共同授权对应契约与 CI/test 修复；本记录不把更早讨论视为已验证授权。
Supersedes: 仅替代 [PA Data Boundary Product Spec](../specs/pa-data-boundary-product-spec.md) 与 [VSS SQLite/WASM Architecture](../../architecture/vss-sqlite-wasm-architecture.md) 中“首次 Prepare 必须阻断确认”的条款；本地索引丢失、profile/settings stale、手动 Prepare/Update 与其他 costly rebuild 继续阻断确认。
Revisit trigger: 隐私法规变化要求 explicit opt-in；用户反馈显示 silent build 造成意外成本或混淆；total failure 率过高需要 fallback 到确认流程

## Context

PA 的 Memory 系统在首次使用时需要将 vault 中的 Markdown 笔记文本发送到用户已配置的 embedding API（如 Qwen DashScope）进行向量化。此前的实现要求通过一个 5-section Approval Modal 获得用户明确确认后才开始构建。

该 Modal 在首次 Chat 消息时弹出，包含 Data safety、AI Provider、Memory Search、Background Updates、Cost 五个信息段落，用户必须点击"Prepare Memory"才能开始构建。

### 问题

1. **打断用户意图**：用户想提问时被阻断，需要理解技术段落并做决策
2. **违背 North Star**："随手记下，需要时自然浮现"要求 Memory 是"自然发生"的事
3. **首次体验 deal-breaker**：Modal + 15 分钟构建时间 = 用户在关键前 5 分钟内无法正常使用

### 前提条件

用户已经完成了以下明确操作才会触发 Memory 构建：
1. 安装了 PA 插件
2. 主动选择了 AI Provider
3. 主动输入了 API Token
4. 主动发送了 Chat 消息
5. `memoryEnabled` 设置默认为 true（可在 Settings 关闭）

## Decision

**批准首次 Memory 构建在后台静默执行，不弹出 Approval Modal。**

### 行为规范

| 项 | 规则 |
|---|------|
| 触发时机 | 用户首次发送 Chat 消息时，`ensureReadyForChat()` 检测到 `reason: "first-use"` |
| 用户通知 | Chat 响应附带消息“Memory 正在后台准备中，准备完成后将自动启用” |
| 阻断行为 | 无。用户立即获得 answer-now 响应，不等待 Memory |
| 数据范围 | vault 中符合 data boundary 设置的 eligible Markdown 文件 |
| 排除规则 | 尊重 `vssCacheExcludePath`、data boundary folder/tag 排除 |
| Provider | 使用用户已配置的 embedding provider（同一个 API key） |
| 成本 | embedding API 调用，与用户配置的 provider 计费规则一致 |
| Opt-out | 用户可在 Settings → Memory & Personalization 关闭 `memoryEnabled` |
| 失败处理 | 后台 total failure、abort、unload、opt-out 或 marker truth preflight 失败时不制造 ready、不升级自动策略；durable rebuild guard 保留原 `first-use`/`settings-changed`/`local-memory-missing` reason，后续 hydrate 按原路径重试 |
| 策略升级 | 仅在 durable backend 报告 usable ready 且本轮未 abort/total-fail 后升级为 `auto-refresh-after-prepare`；partial success 仅在 durable usable 时允许升级，失败文件保持可重试 |
| 后续更新 | 策略升级后，vault 文件变更自动后台增量更新（已有行为） |

### Destructive rebuild marker truth gate

- In-memory `marker === null` 只有在当前 IndexedDB state store 已成功 hydrate 后才能表示“known absent”；hydrate/open 失败时必须视为 unknown。
- 在 `index.reset()` 或任何 embedding-provider call 前，rebuild 必须 durable 保存 whole-vault retry journal，并以 hydrated known absence 或同一 state generation 的 durable invalidation 建立 marker truth。
- 任一步失败都保留既有 OPFS index/marker，reset 与 provider call 均为 0；首次 Chat 已经走 `answer-now`，只显示非 ready/失败状态，待 state store 恢复后重新判定。
- 该 fail-closed 选择只收紧 destructive rebuild，不把浏览器 persistent-storage permission denied 等同于 marker unknown，也不扩大改变普通 non-destructive maintenance 的既有 process-local retry 语义。

### Recovery reason 与 ready admission

- Destructive rebuild 在 reset 前以 content-free durable guard 保存原始 reason：`first-use`、`settings-changed` 或 `local-memory-missing`；marker、dirty journal 与 guard 作为一个 state transition 更新。
- Hydration 优先 guard，而不是从 null marker 猜测 fresh install。Abort/total failure 保留 guard，因此已确认过的 settings/missing recovery 在重启后仍走原 blocking reason，不会变成 silent first-use。
- Guard 只有在 durable ready marker 与 `memoryApprovalPolicy`/lifecycle admission 都成功后清除。若 policy save 或 lifecycle admission 失败，VSS compensation rollback 为 non-ready 并恢复原 guard/reason；不得留下可搜索的 ready admission。

### 保留 Modal 的场景

以下场景仍保留 Approval Modal（非首次使用，通常表示数据状态异常）：
- `reason: "local-memory-missing"` — 本地索引丢失，需要重建
- `reason: "settings-changed"` — embedding 模型/Provider 变更，需要全量重建
- 手动 Prepare/Update 与其他非首次 costly rebuild

### 不适用

- 不适用于 Pagelet/Write Action Framework 的数据访问（各有独立授权）
- 不适用于 Memory Extraction（有独立 consent 机制）

## Alternatives Considered

1. **保持现有 5-section Modal** — 拒绝：违背 North Star，首次体验差
2. **轻量 Toast 通知** — 未选择：告知但不阻断是本方案已有行为（Chat 消息附带说明）
3. **Setup wizard checkbox** — 未选择：增加配置步骤，与"2 步完成配置"目标冲突

## Consequences

- 用户完成 AI 配置并首次发送 Chat 后，Memory 自动开始构建，无额外交互
- 首次 Chat 不使用 Memory（answer-now），但用户被告知 Memory 正在准备
- Memory durable usable ready 后，后续 Chat 自动使用 Memory
- 用户可随时在 Settings 关闭 Memory
- IndexedDB marker truth 未知时不会为了 silent first-use 冒险清空旧 index 或发送笔记；用户本次 Chat 仍正常得到回答。
- 失败/取消后的重启保留原 recovery reason；需要确认的 recovery 不会被误降为 silent first-use，policy admission 失败也不会暴露 prepared-but-unadmitted ready。

## Traceability

- Work item: `B-126`
- Discovery: [First-Run Experience & Platform Robustness](../../development/discovery/first-run-and-platform-robustness.md)
- Product Spec: [Silent First-Use Memory Preparation](../specs/pa-silent-first-use-memory-preparation-product-spec.md)
- Architecture: [VSS SQLite/WASM Current Architecture](../../architecture/vss-sqlite-wasm-architecture.md)、[VSS Local State](../../architecture/vss-local-state-plan.md)、[VSS Embedding Refresh](../../architecture/vss-embedding-refresh.md)
- Active Package: [B-126 Feature Home](../../development/active/silent-first-use-memory-preparation/README.md)、[Tracker](../../development/active/silent-first-use-memory-preparation/tracker.md)
- Source request: Owner decisions on 2026-08-11 in the current PR #378 review follow-up—option A for silent first-use and the later option 1 for unknown-marker fail-closed; no earlier discussion is used as approval evidence.
