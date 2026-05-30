# SDD: 聊天历史持久化

**Status:** Implemented; historical design record
**Phase:** 3.5

---

## Implementation Status (2026-05-30)

This SDD has been implemented in current code. The implementation uses `src/chat/chat-history-store.ts` for IndexedDB/Memory/Unavailable stores, `src/chat/chat-history-manager.ts` for conversation/turn lifecycle, `src/plugin.ts` for plugin-level initialization/disposal, and `src/chat/chat-view.ts` for restore, conversation switching, delete/clear, and finalize-time persistence.

Regression coverage exists in `__tests__/chat-history-store.test.ts`, `__tests__/chat-history-manager.test.ts`, and `__tests__/pa-agent-history.test.ts`. This document is retained as a historical design record, not as an open implementation plan.

---

## 1. Context

设计时 AI Chat 的对话历史完全存活在 `LLMView` 实例的内存中（`chatHistory: ChatMessage[]` + `timelineEntries: TimelineEntry[]`），sidebar 关闭、插件 reload、Obsidian 重启都会清空所有对话。这个问题已按本设计在当前代码中落地修复。

**关键约束:**
- Obsidian plugin 跨 desktop/mobile，需要在 iOS/Android WebView 也能工作
- 单实例 view（Obsidian 同一时间只有一个 `LLMView`，无并发写入冲突）
- 已有 IndexedDB 三层模式（`stats-local-store.ts` / `vss/local-state-store.ts`），有成熟示范

**现有数据结构:**
- `ChatMessage` — 显示用 message（role/content/sourceRecords/runtimeWarnings 等）
- `HistoryTurnEntry` — 一对 user+assistant 的 timeline 条目（含 memoryMetadata、contextUsedItems、activityDetails、canonicalTurn）
- `PaAgentPersistedTurn` — runtime 完整轮次（含原始 API messages，10-50KB/轮，**不持久化**）

---

## 2. Goals

1. 关闭 sidebar / reload 插件 / 重启 Obsidian 后，对话历史完整恢复
2. 支持多对话切换（最多 50 个对话，超出 LRU 淘汰）
3. 保存时机零阻塞：streaming 中不写入，仅在 turn finalize 后批量持久化
4. iOS/Android 兼容（IndexedDB on WebKit）
5. IndexedDB 不可用时优雅降级（`UnavailableChatHistoryStore`，行为同今日）

## Non-goals

- 不跨设备同步（device-local，避免 sync 冲突）
- 不额外加密 IndexedDB 内容；隐私边界与本机 Obsidian profile / OS 用户账户一致
- 不持久化 `canonicalTurn.messages`（原始 API 流，体积过大）
- 不在 streaming 过程中实时写入（避免 I/O 风暴）
- 不支持搜索历史对话（v2 再做）

---

## 3. 存储策略对比

| 选项 | 评价 |
|------|------|
| **A. `plugin.saveData()`（vault config JSON）** | 与 ~80 字段的 settings 共用一个 blob，每次 streaming 都序列化整个 blob → I/O 风暴 + sync 冲突。**不可行。** |
| **B. IndexedDB（device-local, unencrypted）** | 复用 `stats-local-store.ts` 三层模式，device-local 无冲突，mobile WebKit 支持，<10ms keyed 读取。**最佳选择。** |
| **C. vault 内独立 JSON 文件** | 重复造轮子，仍有 sync 冲突。比 B 差。 |

✅ **选定 Option B**

---

## 4. 数据模型

### 4.1 类型定义（`src/chat/chat-history-store.ts`）

```typescript
export const CHAT_HISTORY_SCHEMA_VERSION = 1;
export const MAX_CONVERSATIONS = 50;

/** 对话元数据 — 存于 conversations 对象库 */
export interface PersistedConversation {
    id: string;                  // UUID v4, primary key
    title: string;               // 自动从首条用户消息派生
    createdAt: string;           // ISO-8601
    updatedAt: string;           // ISO-8601
    turnCount: number;
    preview: string;             // 首条用户消息（截断 200 字符）
}

/** 单轮 turn — 存于 turns 对象库，复合主键 [conversationId, turnIndex] */
export interface PersistedTurn {
    conversationId: string;      // 外键
    turnIndex: number;           // 0-based 序号
    user: PersistedChatMessage;
    assistant: PersistedChatMessage;
    memoryMetadata?: ChatTurnMemoryMetadata;
    contextUsed?: ChatContextUsedItem[];
    activityDetails?: string[];
    providerReasoningObserved?: boolean;
}

/** 简化的 message 表示（**故意不存** PaAgentMessage[]） */
export interface PersistedChatMessage {
    role: 'user' | 'assistant';
    content: string;
    sourceRecords?: SourceRecord[];
    runtimeWarnings?: ChatRuntimeWarning[];
    turnStatus?: TurnEndStatus;
}
```

**关键设计决策:**
- **不持久化 `canonicalTurn.messages[]`** — 原始 API 流（含 tool 调用 input/output）每轮 10-50KB，UI 恢复完全用不到，只需提取 `sourceRecords` 和 `memoryMetadata`
- **conversations / turns 分两个 store** — 列表加载只读元数据（~200 bytes/条），打开特定对话才加载 turns
- **`turnIndex` 复合主键** — 保持顺序无需依赖时间戳

---

## 5. 存储接口与实现（三层模式）

### 5.1 接口

```typescript
export interface ChatHistoryStore {
    initialize(): Promise<void>;

    listConversations(): Promise<PersistedConversation[]>;
    getConversation(id: string): Promise<PersistedConversation | null>;
    upsertConversation(conversation: PersistedConversation): Promise<void>;
    deleteConversation(id: string): Promise<void>;

    getTurns(conversationId: string): Promise<PersistedTurn[]>;
    appendTurn(turn: PersistedTurn): Promise<void>;
    deleteTurnsForConversation(conversationId: string): Promise<void>;

    pruneOldConversations(maxConversations: number): Promise<string[]>;

    /** 活动对话指针 —— 单独的 metadata key，不混在 conversations store */
    getActiveConversationId(): Promise<string | null>;
    setActiveConversationId(id: string | null): Promise<void>;

    dispose(): Promise<void>;
}
```

`activeConversationId` 用专属 get/set 而非埋在 `conversations` store 里，理由：
- 语义清晰（指针 vs 列表）
- 切换对话只需写一个 key，不动 conversations 数据
- 单测时 mock 简单（独立的两个方法，无副作用耦合）

### 5.2 三个实现

| 类 | 用途 |
|----|------|
| `IndexedDbChatHistoryStore` | 生产运行时，3 个 object store：`conversations`（keyPath: `id`）+ `turns`（keyPath: `[conversationId, turnIndex]`，外加 `conversationId` 索引）+ `metadata`（活动对话指针等 key-value） |
| `MemoryChatHistoryStore` | 单测用，内存 Map |
| `UnavailableChatHistoryStore` | IndexedDB 不可用时 fallback，所有方法 throw，由调用方静默降级 |

### 5.3 数据库命名

按 vault 隔离的 hashScope（与 `stats-local-store.ts` 模式一致，但**不复用**它的 hash 输入，避免不同 store 串扰）：

```typescript
const CHAT_HISTORY_DB_NAME_PREFIX = "personal-assistant-chat-history-v1";
function buildDbName(vaultId: string, pluginId: string, basePath: string): string {
    return `${CHAT_HISTORY_DB_NAME_PREFIX}-${hashScope(vaultId, pluginId, basePath)}`;
}
```

**hashScope 输入对齐:** `vaultId + pluginId + basePath`（不含 `configDir` —— 它对单一 plugin 来说是固定的 `obsidian` 子目录，不增加区分度）。这与 `stats-local-store.ts:78` 当前用 `(vaultId, pluginId, basePath)` 一致；如果 stats 实际用了不同输入需先确认（见 §15 Critical Files 的 grep 步骤）。

### 5.4 Schema 版本 vs IDB 版本

两套版本号要分清：

| 版本 | 含义 | 存放位置 |
|------|------|--------|
| `CHAT_HISTORY_SCHEMA_VERSION` | 应用层语义版本（PersistedTurn 结构变更时 +1） | metadata store key `schema-version` |
| `CHAT_HISTORY_IDB_VERSION` | IndexedDB 物理版本（onupgradeneeded 触发条件） | DB 自身 |

应用层 schema 升级（如 PersistedTurn 加字段）走第一种 —— 读出时检查并迁移；IDB 物理升级（如新增 store）走第二种。两者解耦后不会因为加字段就触发整个 IDB 升级。

---

## 6. 高层管理器（`src/chat/chat-history-manager.ts`）

封装 store + 业务逻辑：
- 当前活动对话 ID 跟踪（`activeConversationId`）
- 序列化/反序列化 `HistoryTurnEntry` ↔ `PersistedTurn`
- 自动 prune
- 标题自动生成（首条 user message，首行截断 60 字符）

**关键序列化逻辑:**

```typescript
// 序列化（runtime → persisted）
serializeTurn(entry: HistoryTurnEntry): PersistedTurn {
    return {
        conversationId, turnIndex,
        user: { role: 'user', content: entry.user.content },
        assistant: {
            role: 'assistant',
            content: entry.assistant.content,
            sourceRecords: entry.assistant.canonicalTurn?.sourceRecords,
            runtimeWarnings: entry.assistant.runtimeWarnings,
            turnStatus: entry.assistant.canonicalTurn?.status,
        },
        memoryMetadata: entry.assistant.memoryMetadata,
        contextUsed: entry.contextUsedItems,
        activityDetails: entry.activityDetails,
        providerReasoningObserved: entry.providerReasoningObserved,
    };
}

// 反序列化（persisted → runtime）
//
// canonicalTurn 不重建（原始 API messages 已丢弃），但 memoryMetadata 必须双写：
//   - HistoryTurnEntry.memoryMetadata（runtime 入口，timeline 渲染读取）
//   - assistantMessage.memoryMetadata（ChatMessage 字段，个别消费者从这里读，e.g. tool-result inspector）
// 不双写会导致重启后 memoryMetadata 在某些读路径返回 undefined。
deserializeTurn(turn: PersistedTurn): {
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
    historyEntry: HistoryTurnEntry;
}
```

**故意丢弃 `canonicalTurn.messages[]`:** 原始 API 流（含 tool 调用 input/output）每轮 10-50KB，UI 恢复完全用不到。但 `canonicalTurn` 上的派生字段（`sourceRecords`, `status`）是 UI 必需的，要在 serialize 时取出，在 deserialize 时重建一个**裁剪版** `canonicalTurn`：

```typescript
assistantMessage.canonicalTurn = {
    messages: [],  // 故意空 —— 重启后不需要
    sourceRecords: turn.assistant.sourceRecords ?? [],
    status: turn.assistant.turnStatus ?? "completed",
    // 其他 readChatHistoryTurnMetadata 读取的字段
};
```

**位置说明:** `canonicalTurn` 来自 `assistant: ChatMessage`，不是来自 `HistoryTurnEntry` 顶层。原 SDD 文字"它仅在 runtime 用于 readChatHistoryTurnMetadata()"准确，但读取入口是 `assistantMessage.canonicalTurn`。

`TerminalTurnEntry`（错误/取消）也不持久化（短暂状态，重启后无意义）。

---

## 7. 生命周期：何时存、何时读

### 7.1 保存时机

| 触发点 | 行为 |
|--------|------|
| `finalizeSuccessfulTurn()`（chat-view.ts:~1580） | `appendTurn()` + `upsertConversation()` 原子化更新元数据 |
| `deleteHistoryPairForMessages()`（chat-view.ts:~945） | 删除对应 `PersistedTurn`，更新 `turnCount` |
| "Clear chat" 按钮（chat-view.ts:~1836） | `deleteConversation()` + `deleteTurnsForConversation()` |
| 首条 user message | 若 `activeConversationId` 为 null，创建新 `PersistedConversation`（UUID + 自动标题） |

**绝不**在 streaming 中间写入：单次 `put()` <5ms，turn finalize 后再写一次代价微乎其微。

### 7.2 加载时机

`LLMView.onOpen()`（line 146）UI 构建后插入恢复步骤：
```
1. 从 store metadata 读 activeConversationId
2. 若存在，调 getTurns(id)
3. 转换 PersistedTurn[] → TimelineEntry[] + ChatMessage[]
4. 填充 this.chatHistory 和 this.timelineEntries
5. 调 renderTimeline()（已有方法，line 977）
```

`renderTimeline()` 已能从 `timelineEntries` 重建 UI，恢复只需在它运行前填好数据。

### 7.3 Prune 时机

新对话创建后异步调 `pruneOldConversations(MAX_CONVERSATIONS)`（按 `updatedAt` 升序删除超出的）。无需阻塞 UI。

### 7.4 活动对话 ID 持久化

`activeConversationId: string | null` 字段在 `LLMView` 缓存，写盘走 `ChatHistoryStore.setActiveConversationId()`（独立的 metadata key）。Sidebar close/reopen 后调 `getActiveConversationId()` 恢复指针。

### 7.5 切换对话的 streaming 守卫

切换活动对话有 race window：当前 turn 还在 streaming 中、SSE 数据还在到达，此时切换会让数据写到错误对话。两种应对：

**A（采用）:** 切换时若 `LLMView.isStreaming === true`，UI 禁用切换按钮（disabled state + tooltip "等待当前回答完成"），用户必须先 cancel 或等完成。

**B（弃用）:** 允许切换但取消当前 streaming —— 用户体验差，且 cancel 路径需要清理半成品 turn，复杂度高。

**`switchActiveConversation(id)` helper:**

```typescript
async switchActiveConversation(newId: string): Promise<void> {
    if (this.isStreaming) {
        new Notice("Wait for the current response to finish before switching.");
        return;
    }
    await this.persistDirtyTurnsIfAny();  // 双保险
    this.activeConversationId = newId;
    await this.chatHistoryManager.setActiveConversationId(newId);
    const turns = await this.chatHistoryManager.getTurns(newId);
    this.rehydrateFromTurns(turns);
    this.renderTimeline();
}
```

---

## 8. UI 集成

### 8.1 v1（本 SDD 范围）

- ✅ 当前对话自动恢复
- ✅ 替换"Clear chat"为：
  - **"New Chat"** — 保存当前对话（已增量持久化），开新对话（`activeConversationId = null`）
  - **"Clear chat"** — 删除当前对话（`deleteConversation`）
- ✅ 简单的"History"按钮 → 弹出 `Modal` 显示对话列表（按 `updatedAt` 倒序），点击切换

### 8.2 未来（v2，不在本 SDD）

- 对话列表面板（嵌入 sidebar 而非 modal）
- 支持搜索/筛选
- 重命名 / 置顶 / 导出

---

## 9. 代码变更清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/chat/chat-history-store.ts` | 接口 + 3 个实现 + 数据类型 |
| `src/chat/chat-history-manager.ts` | 业务层（活动对话/序列化/prune/标题生成） |
| `__tests__/chat-history-store.test.ts` | MemoryChatHistoryStore 单测 |
| `__tests__/chat-history-manager.test.ts` | Manager 单测 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/chat/chat-view.ts` | (1) 新增 `activeConversationId` 字段；(2) `onOpen()` 末尾调恢复；(3) `finalizeSuccessfulTurn()` 末尾调 `appendTurn`；(4) `deleteHistoryPairForMessages()` 末尾删 turn；(5) "Clear chat" → 新行为；(6) 新增 "New Chat" / "History" 按钮；(7) 新增 `switchActiveConversation()` helper（含 streaming 守卫） |
| `src/plugin.ts` | (1) `onload()` 初始化 `ChatHistoryStore`（参考 `createVSSIndexStateStore()`）；(2) 暴露为字段 `this.chatHistoryStore`；(3) `onunload()` dispose |
| `src/chat/types.ts` | （可选）导出 `HistoryTurnEntry` 转换 helper |

---

## 10. Migration 策略

**首次运行 v1:**
1. `IndexedDbChatHistoryStore.initialize()` 打开 DB；不存在则 `onupgradeneeded` 创建 2 个 store
2. `ChatHistoryManager.loadActiveConversation()` 返回 null
3. ChatView 显示空状态（与今日行为一致）
4. 首条 user message 触发新对话创建

**未来 schema 升级:** `onupgradeneeded` 检查 `oldVersion`，参考 `stats-local-store.ts` 的版本迁移模式。

---

## 11. 性能分析

| 操作 | 数据量 | 预期耗时 |
|------|------|--------|
| 对话列表加载 | 50 对话 × 200 bytes | <1ms |
| 单对话内容加载 | 20 turns × 2-5KB | 10-50ms |
| Turn 追加 | 1 put + 1 put | <5ms |
| Prune | 列出 + sort + N delete | 异步，非阻塞 |
| Store 初始化（IndexedDB open） | — | 10-30ms（在 plugin.onload，view 打开前） |

---

## 12. Test Plan

### 单测（`MemoryChatHistoryStore`）

1. CRUD: 创建/读/更新/删除 conversation
2. Turn 追加/读取/删除
3. `turnIndex` 顺序保留（0,1,2...）
4. `pruneOldConversations` 按 `updatedAt` 保留 N 个
5. `deleteTurnsForConversation` 级联清理
6. Conversation `updatedAt` + `turnCount` 在 turn 追加时同步更新

### 单测（`ChatHistoryManager`）

7. `serializeTurn` 正确剥离 `canonicalTurn.messages`（保留 sourceRecords / status）
8. `deserializeTurn` 正确重建 `ChatMessage[]` + `HistoryTurnEntry`，**memoryMetadata 双写**到 entry 和 assistantMessage
9. Round-trip：序列化 + 反序列化保留所有字段
10. 标题自动生成（首行 + 60 字符截断 + 换行处理）
11. `activeConversationId` 持久化 + 恢复（独立 metadata key，不影响 conversations）
12. 首条消息自动建对话
13. "Clear" 删对话 + 所有 turns

### 单测（streaming 守卫）

22. `switchActiveConversation` 在 `isStreaming === true` 时拒绝（不写 storage，不切换状态）
23. Streaming 完成后立即切换，旧对话最后一轮已 finalize 写盘
24. Cancel 当前 streaming 后切换，半成品 turn 不入库

### 手动集成测试（Obsidian）

14. 发 3 条消息 → 关闭 sidebar → 重开：3 轮完整可见
15. 删除中间一轮 → 关闭重开：删除生效
16. Clear chat → 关闭重开：空状态
17. 创建 51 个对话 → 最旧的被自动 prune
18. Plugin reload（Cmd+R）：当前对话恢复
19. iOS Obsidian 实测
20. Android Obsidian 实测
21. Mock IndexedDB 不可用 → 验证 graceful fallback（chat 工作如今日，无 crash）

---

## 13. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| IndexedDB 在某些 platform 不可用 | 中 | `UnavailableChatHistoryStore` fallback，记 warning，行为同今日 |
| 大对话（100+ turns）恢复慢 | 低 | v1 限对话 50 个，每对话典型 5-20 轮；未来可分页 |
| 用户期待跨设备同步 | 低 | 文档明示 device-local（与 ChatGPT/Claude 客户端一致）；Obsidian Sync 不参与 |
| Schema 演进 breaking | 中 | `CHAT_HISTORY_SCHEMA_VERSION`（应用层）+ `CHAT_HISTORY_IDB_VERSION`（IDB 层）解耦，应用层加字段不触发 IDB 升级 |
| 多 view 并发写 | 无 | Obsidian 单 `LLMView` 实例，`activateView` 已分离旧 view |
| 序列化 round-trip 漏字段 | 中 | 单测 #9 强制 round-trip 全字段对比 |
| Streaming 中切换对话导致数据写错位置 | 高 | streaming 守卫禁用切换 + 单测 #22-24 |
| `memoryMetadata` 单写漏读路径 | 中 | deserialize 双写 entry + assistantMessage，单测 #8 强制断言两处都有 |
| `canonicalTurn` 重建漏字段 | 中 | 重建裁剪版 canonicalTurn 显式枚举字段，round-trip 测试覆盖 |

---

## 14. Verification Checklist

Historical SDD checklist. Current code/test status is tracked in `docs/v2-fix-plan.md`; do not treat unchecked boxes here as current release blockers without re-auditing the code.

- `tsc -noEmit -skipLibCheck`
- `npm test -- --testPathPattern=chat-history`
- `npm test`（全量）
- `npm run build`
- `npm run audit:bundle`
- 真实 vault 手动 21 项测试
- iOS Obsidian 实测
- Android Obsidian 实测

---

## 15. Critical Files

- `src/chat/chat-view.ts` — 主修改文件（save/load/clear/switch + streaming 守卫集成点）
- `src/stats/stats-local-store.ts` — 参考模式（IndexedDB 三层 + hashScope 输入对齐）
- `src/ai-services/chat-types.ts` — `ChatMessage` / `PaAgentPersistedTurn` / `SourceRecord` 类型
- `src/chat/types.ts` — `HistoryTurnEntry` / `TimelineEntry` 类型
- `src/plugin.ts` — store 初始化/dispose

**实施前 grep 验证（可在 worktree 准备阶段执行）:**
- `grep -n hashScope src/stats/stats-local-store.ts` 确认参数顺序与 §5.3 一致
- `grep -n "memoryMetadata" src/chat/ src/ai-services/chat-types.ts` 列出所有读取入口，验证双写位置覆盖
- `grep -n "canonicalTurn" src/chat/ src/ai-services/` 确认 readChatHistoryTurnMetadata 入口

---

## 16. Historical Workflow

1. 设计记录定稿并通过 review。
2. 原计划通过独立开发分支或 worktree 实施，避免与其他 Phase 3 项目互相阻塞。
3. 完成 TypeScript、Jest、lint/build 与必要的 Obsidian smoke 验证后合入。

This workflow is historical because chat history persistence is implemented in current code.
