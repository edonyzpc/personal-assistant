# PA Plugin 架构重构实施方案

## 概述

### 背景

PluginManager 是一个 God Object（2300 行、42 imports、76 dependents、85 commits / 14.5% of all），导致三个核心痛点：

- **Feature 开发慢**：每次加功能都要理解 2300 行上下文
- **Bug 多 / 回归多**：改一处风险连锁扩散到 76 个依赖文件
- **心理负担**：架构混乱的累积效应

### 重构目标

1. **降耦合**：PluginManager 从 76 dependents 降至 < 10，通过 Host 接口隔离子系统
2. **稳启动**：以功能完整稳定为先，保留阶段化启动边界；移动端跳过桌面组件
3. **降复杂度**：最大文件从 3424 行降至 < 800 行
4. **支撑产品演进**：Capability Tier 系统为免费/付费分层提供架构基础

### 重构原则

- **渐进式**：每步独立可提交、可部署，回滚沿依赖图逆序（leaf 步骤先 revert）
- **行为不变**：纯结构性重构（Phase 3 除外，那是新功能），不改运行时行为
- **模板复用**：所有 Host 接口复用已验证的 `PageletHost` 模式
- **不引入 DI 框架**：Host 接口 + 手动 wiring，对独立开发者更简单可控

### 核心模板：PageletHost 模式

已验证的解耦模式（`src/pagelet/PageletHost.ts`），Pagelet 72 个文件零导入 PluginManager：

```
1. 窄接口定义 → 只暴露子系统实际需要的方法和 settings 切片
2. PluginManager 内 createXxxHost() → 返回对象字面量适配器
3. 构造函数注入 → new Orchestrator(host: XxxHost)
4. Settings 用 live 引用 → host.settings 是 this.settings 的直接引用，非拷贝
5. TypeScript 结构类型 → 子委托定义更窄接口，自动满足
```

---

## 设计决策汇总

以下 8 项决策已在前序讨论中拍板确认：

| # | 问题 | 决策 |
|---|------|------|
| 1 | 跨子系统通信模式 | Multi-port 窄接口注入（MemorySearchPort / MemoryStatusPort / VaultMetadataPort） |
| 2 | MemoryManager + VSS 关系 | 合并为 Memory 子系统，内部直接引用，对外暴露窄 Port |
| 3 | Settings 分发 | 每个 Host 传 settings 切片（沿用 PageletHost 模式），debug/log 放 Host 基础接口 |
| 4 | Vault event 派发 | PluginManager 集中派发 + debounce statusBar |
| 5 | ChatView 拆分 | Phase 2 提取 MobileInputAdapter + ConversationPersistence |
| 6 | 三阶段启动 UX | 沿用 VSS 的 `await initialize()` 按需初始化模式 |
| 7 | Phase 0 测试策略 | 审计现有测试（251 文件 / 74,813 行）+ 补缝隙 |
| 8 | Tier System | 三层模型（Free / Lite / Premium），Phase 3 先建 Free + Lite |

---

## 目标架构

```
PluginManager（~600 行，纯协调器）
  │
  ├── MemoryHost ──→ Memory 子系统（VSS + MemoryManager 合并）
  │     ├── 对外：MemorySearchPort（AI Services 消费）
  │     └── 对外：MemoryStatusPort（Chat UI 消费）
  │
  ├── AiServiceHost ──→ AI Services 子系统
  │     ├── PaAgentRuntime（纯 orchestration，~600 行）
  │     ├── MemorySearchTool（从 runtime 提取）
  │     ├── ChatPlanner（从 runtime 提取）
  │     ├── CapabilityRegistry + PolicyEngine（不变 ✓）
  │     ├── ContextManager（不变 ✓）
  │     └── WriteActionFramework（不变 ✓）
  │
  ├── PageletHost ──→ Pagelet 子系统（已完成 ✓）
  │
  ├── ChatHost ──→ Chat 子系统
  │     ├── LLMView（thin shell）
  │     ├── MobileInputAdapter（提取）
  │     └── ConversationPersistence（提取）
  │
  └── StatsHost ──→ Stats 子系统
```

### 三阶段启动

| 阶段 | 时机 | 内容 | 目标耗时 |
|------|------|------|---------|
| Phase 1 | onload 同步 | loadSettings / registerViews / addCommands / ribbonIcon / statusBar / Memory+Stats shell init | 稳定性优先 |
| Phase 2 | onLayoutReady | ChatHistory.initialize / Callout / settings watcher / MutationObserver（桌面）/ 幂等 Memory+Stats guard | 布局就绪后 |
| Phase 3 | setTimeout(0) | Pagelet / MemoryExtraction | 空闲时 |

---

## Phase 0: 测试审计（1-2 天）

### 目标

确认重构涉及的代码路径已被现有测试覆盖，补缝隙。**零产品代码变更**。

### 审计重点

| 子系统 | 关键测试文件 | 检查要点 |
|--------|-------------|---------|
| Memory/VSS | `vss.test.ts` (2295L), `memory-manager.test.ts` (642L), `vss-data-safety.test.ts`, `vss-state.test.ts` | 构造注入路径的 mock 结构是否匹配 MemoryHost 形状；searchHybrid/flush/verify/reconcile 覆盖 |
| AI Services | `chat-service.test.ts` (684L), `pa-agent-runtime-memory.test.ts`, `pa-agent-loop.test.ts` (2312L) | MemorySearchTool 的 plugin.vss/plugin.memoryManager mock 结构；AgentCapabilityContext.plugin 使用 |
| Chat | `chat-view.test.ts` (4775L) | plugin.chatHistoryManager / plugin.memoryManager / plugin.getAISetupIssue mock 结构 |
| Stats | `stats-manager.test.ts` (931L) | plugin.settings / plugin.registerEvent mock 结构 |

### 可能需要补的缝隙

- `updateMemoryStatusBar()` 通知链（当前无测试覆盖）
- `getAISetupIssue()` 各种 settings 状态返回值
- `onSettingsChanged()` 回调派发
- `isOperationsAgentEnabled` getter 行为

### 完整测试文件盘点

> **Review 修复 #9：** 原方案仅列 7 个测试文件，实际 19+ 个含 plugin mock 需更新。

Phase 0 第一步跑：`grep -rln 'createPlugin\|fakePlugin\|makeFakePlugin\|makePlugin\|plugin:.*any\|plugin:.*PluginManager' __tests__/` 产出完整清单。

**已知高影响测试文件（原方案未列出）：**
- `obsidian-operations-tools.test.ts`（44 处 plugin 引用）
- `pa-agent-host-tools.test.ts`（10+ createPlugin 调用）
- `settings.test.ts`（136 处 plugin 引用）
- `plugin-record-note.test.ts`（132 处 plugin 引用）

**Phase 0 产出物：** 创建共享 test fixture 函数 `createMemoryHost(overrides?)`、`createAiServiceHost(overrides?)`、`createChatHost(overrides?)` 在 `src/tests/factories/` 下，供所有测试复用。

### 完成标准

- `make deploy` 通过，所有现有测试绿色
- 重构涉及的每个构造注入路径至少 1 个测试覆盖
- 共享 test fixture 函数已创建
- 缝隙测试作为独立 PR 提交

---

## Phase 1: Host 接口提取 + 三阶段启动（5-10 天）

每步独立可提交、可部署、可回滚。

### Step 1.1: 定义 MemoryHost + Port 接口

**创建文件：**
- `src/memory/MemoryHost.ts`
- `src/memory/MemorySearchPort.ts`
- `src/memory/MemoryStatusPort.ts`
- `src/memory/index.ts`（barrel export）

**MemoryHost 接口：**

```typescript
import type { App, EventRef, TFile } from "obsidian";

export interface MemoryHost {
    readonly app: App;
    readonly pluginId: string;
    readonly settings: {
        memoryEnabled: boolean;
        memoryAutoCheckBeforeChat: boolean;
        memoryApprovalPolicy: string;
        vssCacheExcludePath: string[];
        debug: boolean;
        aiProvider: string;
        embeddingModelName: string;
        baseURL: string;
        statisticsVaultId: string;
    };
    log(message: string, ...args: unknown[]): void;
    registerEvent(ref: EventRef): void;
    saveSettings(): Promise<void> | void;
    getVSSFiles(): TFile[];
    getAPIToken(): Promise<string>;
    notifyStatusChanged(): void;
    updateMemorySetting<K extends keyof MemoryHost["settings"]>(
        key: K, value: MemoryHost["settings"][K]
    ): void;
}
```

> **Review 修复：** 新增 `pluginId`（VSS.getPluginId() 需要 plugin.manifest）、`getAPIToken()`（AIUtils 创建模型需要）、`notifyStatusChanged()`（MemoryManager 5 处调用 updateMemoryStatusBar）、`updateMemorySetting()`（enableAutoRefreshAfterPrepare 写 settings）。

**MemorySearchPort（AI Services 消费）：**

```typescript
export interface MemorySearchPort {
    ensureReadyForChat(query?: string): Promise<MemoryDecisionResult>;
    searchHybrid(query: string, opts?: SearchHybridOptions): Promise<SearchResult[]>;
    getChunksByPath(paths: string[], opts?: ChunkOptions): Promise<Chunk[]>;
}
```

> **Review 修复：** `getMaintenancePlan()` 从 MemorySearchPort 移至 MemoryStatusPort（它是状态查询不是搜索）。

**MemoryStatusPort（Chat UI 消费）：**

```typescript
export interface MemoryStatusPort {
    getMaintenancePlan(): Promise<MemoryMaintenancePlan>;
    prepareFromCommand(): Promise<void>;
    updateFromCommand(): Promise<void>;
    showTechnicalStatus(): void;
    onStatusChanged(listener: () => void | Promise<void>): () => void;
}
```

> **Review 修复：** 新增 `showTechnicalStatus()`（LLMView 两处调用 showTechnicalMemoryStatus）。

**改动量：** ~100 行新增
**运行时变更：** 无
**验证：** `tsc --noEmit` 通过

---

### Step 1.2: 创建 MemoryHost 适配器

**修改 `src/plugin.ts`** — 新增 `private createMemoryHost(): MemoryHost`

```typescript
private createMemoryHost(): MemoryHost {
    return {
        app: this.app,
        pluginId: this.manifest.id,
        settings: this.settings,  // live 引用
        log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
        registerEvent: (ref) => this.registerEvent(ref),
        saveSettings: () => this.saveSettings(),
        getVSSFiles: () => this.getVSSFiles(),
        getAPIToken: () => this.getAPIToken(),
        notifyStatusChanged: () => this.debouncedStatusBarUpdate(),
        updateMemorySetting: (key, value) => {
            (this.settings as Record<string, unknown>)[key] = value;
            void this.saveSettings();
        },
    };
}
```

**改动量：** ~40 行新增
**验证：** 编译通过，此步适配器仅定义不消费

---

### Step 1.3a: 重构 AIUtils 接受窄接口（前置条件）

> **Review 修复：** VSS 构造函数内 `new AIUtils(plugin)` 和 `new AIService(plugin)` 在 plugin 变量消失后会编译失败。必须先处理。

**修改文件：**
- `src/ai-services/ai-utils.ts` — 构造函数从 `(plugin: PluginManager)` 改为接受窄接口
- `src/vss.ts` — 删除死代码 `this.aiService = new AIService(plugin)`（声明于 247 行，构造于 292 行，零调用点）

AIUtils 实际只需要：`{ settings: { aiProvider, chatModelName, embeddingModelName, baseURL }, getAPIToken(): Promise<string>, log() }`。MemoryHost 和 AiServiceHost 都结构性满足这个窄类型。

**改动量：** ~50 行
**验证：** 编译通过 + 现有 `ai-utils.test.ts` 通过

---

### Step 1.3b: 接入 MemoryHost，合并 MemoryManager + VSS

**修改文件：**
- `src/memory-manager.ts` — 构造函数 `(plugin: PluginManager)` → `(host: MemoryHost, vss: VSS)`
- `src/vss.ts` — 构造函数 `(plugin: PluginManager, ...)` → `(host: MemoryHost, ...)`
- `src/plugin.ts` — 更新实例化

**替换规则：**

| 原代码 | 新代码 | 文件 |
|--------|--------|------|
| `this.plugin.vss.flush(...)` | `this.vss.flush(...)` | memory-manager.ts |
| `this.plugin.vss.searchHybrid(...)` | `this.vss.searchHybrid(...)` | memory-manager.ts |
| `this.plugin.vss.rebuildLocalIndex(...)` | `this.vss.rebuildLocalIndex(...)` | memory-manager.ts |
| `this.plugin.vss.refreshLocalIndex(...)` | `this.vss.refreshLocalIndex(...)` | memory-manager.ts |
| `this.plugin.vss.verifyPendingChanges(...)` | `this.vss.verifyPendingChanges(...)` | memory-manager.ts |
| `this.plugin.vss.reconcileLocalFiles(...)` | `this.vss.reconcileLocalFiles(...)` | memory-manager.ts |
| `this.plugin.vss.hasDirtyChanges()` | `this.vss.hasDirtyChanges()` | memory-manager.ts |
| `this.plugin.vss.hasPendingVerification()` | `this.vss.hasPendingVerification()` | memory-manager.ts |
| `this.plugin.vss.canAutoMaintain()` | `this.vss.canAutoMaintain()` | memory-manager.ts |
| `this.plugin.vss.getMemoryReadiness()` | `this.vss.getMemoryReadiness()` | memory-manager.ts |
| `this.plugin.settings.memoryEnabled` | `this.host.settings.memoryEnabled` | memory-manager.ts |
| `this.plugin.settings.memoryApprovalPolicy` | `this.host.settings.memoryApprovalPolicy` | memory-manager.ts |
| `this.plugin.updateMemoryStatusBar()` | `this.host.notifyStatusChanged()` | memory-manager.ts (5 处) |
| `this.plugin.settings.memoryApprovalPolicy = X` | `this.host.updateMemorySetting("memoryApprovalPolicy", X)` | memory-manager.ts |
| `(this.plugin as ...).saveSettings?.()` | `this.host.saveSettings()` | memory-manager.ts (去除 cast) |
| `this.plugin.log(...)` | `this.host.log(...)` | memory-manager.ts, vss.ts |
| `this.plugin.app.vault` | `this.host.app.vault` | vss.ts |
| `this.plugin.getVSSFiles()` | `this.host.getVSSFiles()` | vss.ts |
| `this.plugin.manifest` (getPluginId) | `this.host.pluginId` | vss.ts |
| `new AIUtils(plugin)` | `new AIUtils(host)` | vss.ts (Step 1.3a 使 AIUtils 接受窄接口) |
| `new MemoryApprovalModal(plugin)` | `new MemoryApprovalModal(host.app)` | memory-manager.ts |

**实例化变更（plugin.ts）：**
```typescript
const memoryHost = this.createMemoryHost();
this.vss = new VSS(memoryHost, this.vssCacheDir, this.createVSSIndexStateStore());
this.memoryManager = new MemoryManager(memoryHost, this.vss);
```

**测试更新：** mock 对象调整为 MemoryHost 结构（~60 行）

**改动量：** ~220 行
**验证：** 全部测试通过 + `make deploy` + 冒烟：Memory 准备 / 搜索正常

---

### Step 1.4: 定义 AiServiceHost，重接 AI Services（拆为 3 子步骤）

> **Review 修复：** AgentCapabilityContext.plugin 级联范围远大于原方案（12+ 源文件 + 7 测试文件）。拆为子步骤降低风险。

**创建 `src/ai-services/AiServiceHost.ts`：**

```typescript
import type { App } from "obsidian";
import type { MemorySearchPort } from "../memory/MemorySearchPort";

export interface AiServiceHost {
    readonly app: App;
    readonly settings: {
        debug: boolean;
        aiProvider: string;
        baseURL: string;
        chatModelName: string;
        policyModelName: string;
        embeddingModelName: string;
        shareAnonymousCapabilityUsage: boolean;
        skillContextEnabled: boolean;
        enabledSkillIds: string[];
        qwenThinkingEnabled: boolean;
        webSearchEnabled: boolean;
        memoryEnabled: boolean;
        operationsAgentEnabled: boolean;
        statisticsVaultId: string;
    };
    log(message: string, ...args: unknown[]): void;
    getAPIToken(): Promise<string>;
    readonly isOperationsAgentEnabled: boolean;
    getMemoryExtractionPromptContext(): Record<string, unknown>;
    readonly memorySearch: MemorySearchPort;
    getResolvedLinks(): Record<string, Record<string, number>> | undefined;
}
```

> **Review 修复：** 新增 `getAPIToken()`（AIUtils/ChatService 创建模型需要）。

#### Step 1.4a: 定义 AiServiceHost + 重接 PaAgentRuntime / ChatService

**修改文件：**
- `src/ai-services/pa-agent-runtime.ts` — `plugin: PluginManager` → `host: AiServiceHost`
- `src/ai-services/chat-service.ts` — 同上，`new AIUtils(plugin)` → `new AIUtils(host)`
- `src/plugin.ts` — 新增 `createAiServiceHost()` 适配器

**适配器中 MemorySearchPort 的实现：**
```typescript
memorySearch: {
    ensureReadyForChat: (query) => this.memoryManager.ensureReadyForChat(query),
    searchHybrid: (query, opts) => this.vss.searchHybrid(query, opts),
    getChunksByPath: (paths, opts) => this.vss.getChunksByPath(paths, opts),
},
```

**PaAgentRuntime 关键替换（15 处）：**

| 原代码 | 新代码 |
|--------|--------|
| `this.plugin.memoryManager.ensureReadyForChat(query)` | `this.host.memorySearch.ensureReadyForChat(query)` |
| `this.plugin.vss.searchHybrid(...)` | `this.host.memorySearch.searchHybrid(...)` |
| `this.plugin.vss.getChunksByPath(...)` | `this.host.memorySearch.getChunksByPath(...)` |
| `this.plugin.app.metadataCache.resolvedLinks` | `this.host.getResolvedLinks()` |
| `this.plugin.settings.policyModelName` | `this.host.settings.policyModelName` |
| `this.plugin.log(...)` | `this.host.log(...)` |

**改动量：** ~150 行

#### Step 1.4b: 重命名 AgentCapabilityContext.plugin → host

**修改文件：**
- `src/ai-services/capability-types.ts:70` — `plugin: PluginManager` → `host: AiServiceHost`
- `src/ai-services/chat-tool-types.ts` — 更新 context 类型
- `src/ai-services/pa-agent-host-tools.ts` — 更新 context 使用

**改动量：** ~80 行

#### Step 1.4c: 级联更新全部 context.plugin 消费者

**修改源文件（完整清单）：**
- `src/ai-services/chat-tool-factories.ts` — **17 处** `context.plugin` → `context.host`（最大消费者）
- `src/ai-services/chat-tool-execution-helpers.ts` — context 类型更新
- `src/ai-services/capability-adapter.ts` — 3 处 `context.plugin`（lines 271/288/301）
- `src/ai-services/capability-registry.ts` — 2 处 `context.plugin.log`（lines 251/263）
- `src/ai-services/append-tool-provider.ts` — 1 处（line 139）
- `src/ai-services/write-action-framework/types.ts` — 3 处方法签名
- `src/ai-services/write-action-framework/runtime-integration.ts` — 3 处

**修改测试文件（完整清单）：**
- `capability-registry.test.ts`、`skill-context-provider.test.ts`
- `pagelet-self-write-no-loop.spec.ts`、`pagelet-prompt-injection.spec.ts`、`pagelet-cancel-abort.spec.ts`
- `e2e-pagelet-write.spec.ts`、`write-action-framework/runtime-integration.spec.ts`

> **注意：** 架构图中 CapabilityRegistry 和 WriteActionFramework 标注"不变 ✓"指职责不变，类型签名需机械性更新。

**改动量：** ~270 行（含测试）

**Step 1.4 合计：** ~500 行
**验证：** 全部测试通过 + 冒烟：Chat + Memory search + tool calls

---

### Step 1.5: 定义 ChatHost，重接 LLMView

**创建 `src/chat/ChatHost.ts`：**

```typescript
import type { App } from "obsidian";
import type { MemoryStatusPort } from "../memory/MemoryStatusPort";
import type { ChatHistoryManager } from "./chat-history-manager";
import type { ChatService } from "../ai-services/chat-service";

export interface ChatHost {
    readonly app: App;
    readonly settings: {
        debug: boolean;
        skillContextEnabled: boolean;
        enabledSkillIds: string[];
        memoryEnabled: boolean;
        aiProvider: string;
        baseURL: string;
        chatModelName: string;
    };
    log(message: string, ...args: unknown[]): void;
    getAISetupIssue(): string | null;
    readonly chatHistoryManager: ChatHistoryManager | undefined;
    readonly memoryStatus: MemoryStatusPort;
    createChatService(): ChatService;
    onSettingsChanged(listener: () => void | Promise<void>): () => void;
    scheduleMemoryExtractionAfterChatTurn(conversationId: string, turnCount: number): void;
}
```

> **分层说明：** `createChatService()` 内部调用 `this.createAiServiceHost()` 构造 AiServiceHost 再传给 ChatService 构造函数。ChatHost 不直接暴露 AiServiceHost——这层委托封装在 `plugin.ts` 的 `createChatHost()` 适配器内：
> ```typescript
> createChatService: () => new ChatService(this.createAiServiceHost()),
> ```

**修改文件：**
- `src/chat/chat-view.ts` — 构造函数 `(leaf, plugin, vss)` → `(leaf, host: ChatHost)`
- `src/plugin.ts` — 新增 `createChatHost()` 适配器 + 更新 `registerView`

**LLMView 替换（17 处 log + 其余）：**

| 原代码 | 新代码 |
|--------|--------|
| `this.plugin.log(...)` (×17) | `this.host.log(...)` |
| `this.plugin.chatHistoryManager` | `this.host.chatHistoryManager` |
| `this.plugin.settings.skillContextEnabled` | `this.host.settings.skillContextEnabled` |
| `this.plugin.getAISetupIssue()` | `this.host.getAISetupIssue()` |
| `this.plugin.memoryManager.getMaintenancePlan()` | `this.host.memoryStatus.getMaintenancePlan()` |
| `this.plugin.memoryManager.prepareFromCommand()` | `this.host.memoryStatus.prepareFromCommand()` |

**改动量：** ~220 行
**验证：** 冒烟：Chat sidebar 全流程（发送、Memory chip、历史切换）

---

### Step 1.6: 定义 StatsHost，重接 StatsManager

**创建 `src/stats/StatsHost.ts`：**

```typescript
import type { App, EventRef } from "obsidian";

export interface StatsHost {
    readonly app: App;
    readonly settings: {
        debug: boolean;
        statsPath: string;
        statisticsVaultId: string;
        statisticsSyncEnabled: boolean;
        countComments: boolean;
    };
    log(message: string, ...args: unknown[]): void;
    registerEvent(ref: EventRef): void;
}
```

> **Review 修复：** 移除 4 个 StatsManager 实际未使用的字段（`statisticsType`、`fileFormat`、`targetPath`、`displaySectionCounts`），精确反映耦合面。

**修改文件：**
- `src/stats/stats-manager.ts` — `(app, plugin)` → `(host: StatsHost)`
- `src/stats/editor-plugin.ts` — `pluginField` 改为 `StateField<EditorPluginHost | null>`

**EditorPluginHost（独立于 StatsHost，解决 pluginField 双消费者问题）：**

> **Re-Review 修复：** `pluginField` 同时服务 `StatusBarEditorPlugin`（需要 `statsManager.debounceChange()`）和 `SectionWordCountEditorPlugin`（需要 `settings.displaySectionCounts`）。StatsHost 无法持有 StatsManager（循环依赖），因此 pluginField 需要独立的更宽类型。

```typescript
// src/stats/EditorPluginHost.ts
import type StatsManager from "./stats-manager";

export interface EditorPluginHost {
    readonly app: App;
    readonly settings: {
        displaySectionCounts: boolean;
    };
    readonly statsManager: StatsManager | undefined;
}
```

在 `plugin.ts` 中，`registerEditorExtension` 时传入：
```typescript
this.registerEditorExtension([
    pluginField.init(() => ({
        app: this.app,
        settings: this.settings,
        statsManager: this.statsManager,
    })),
    statusBarEditorPlugin,
    sectionWordCountEditorPlugin,
]);
```

`statsManager` 在 Phase 1 时为 `undefined`（Phase 2 才创建），`StatusBarEditorPlugin` 已有 `if (plugin && plugin.statsManager)` guard（`editor-plugin.ts:53`），安全。

**改动量：** ~100 行（含 EditorPluginHost 定义 + pluginField 改型）
**验证：** `stats-manager.test.ts` 通过 + 冒烟：编辑文件验证字数统计 + section count 显示

---

### Step 1.7: 三阶段启动重构

**修改 `src/plugin.ts` — 重构 `onload()` 方法**

**Phase 1（稳定性优先阻塞段）：**

```typescript
async onload() {
    await this.loadSettings();
    await this.migrateSettings();
    this.surfacePendingPageletReviewsFolderMigration();

    if (this.settings.debug) {
        new Notice(this.t("plugin.notice.starting"));
        monkeyPatchConsole(this);
    }

    // UI 注册（轻量）
    addIcon(PA_CHAT_SUBAGENT_ICON, icons[PA_CHAT_SUBAGENT_ICON]);
    addIcon('PluginAST', icons['PluginAST']);
    this.addRibbonIcon(/* ... */);
    if (Platform.isDesktop) { this.setupStatusBar(); }

    // Chat history（构造函数是纯同步的，必须在 registerView 前就绪）
    this.chatHistoryStore = this.createChatHistoryStore();
    this.chatHistoryManager = new ChatHistoryManager({...});

    // View 注册（Obsidian workspace restore 会立即调用 factory）
    this.registerView(RECORD_PREVIEW_TYPE, (leaf) => new RecordPreview(this.app, this, leaf));
    this.registerView(STAT_PREVIEW_TYPE, (leaf) => new Stat(this.app, this, leaf));
    this.registerView(VIEW_TYPE_LLM, (leaf) => new LLMView(leaf, this.createChatHost()));
    registerPageletDetailIcon();
    this.registerView(PAGELET_DETAIL_VIEW_TYPE, (leaf) => new PageletDetailView(leaf, ...));

    // Editor extensions（Obsidian API 要求在 onload 内注册）
    this.registerEditorExtension([pluginField.init(() => this.createStatsHost()), ...]);

    // Vault events（Phase 1 注册，handler 内 null-safe 访问 vss/memoryManager）
    this.registerVaultEventDispatch();

    // Commands 注册
    this.registerAllCommands();

    // Settings tab
    this.addSettingTab(new SettingTab(this.app, this));

    // Phase 2: onLayoutReady
    this.app.workspace.onLayoutReady(() => this.onLayoutReady());
}
```

> **Review 修复 #4：** Memory 命令的 `runMemoryCommand()` 加 null guard：
> ```typescript
> if (!this.vss || !this.memoryManager) return false;
> ```
> 字段声明改为 nullable：`vss: VSS | null = null`、`memoryManager: MemoryManager | null = null`。

> **Review 修复 #5：** `chatHistoryStore` + `chatHistoryManager` 创建移回 Phase 1（构造函数纯同步，无 I/O）。Obsidian workspace restore 时 view factory 立即执行，chatHistoryManager 必须已就绪。`initialize()` 仍延迟到 Phase 2。

> **Review 修复 #6：** `registerEditorExtension()` 保留在 Phase 1（Obsidian API 要求 onload 内调用）。StatsManager 原计划移至 Phase 2；2026-06-18 稳定性决策后改为在 `onload()` 早初始化，`onLayoutReady()` 保留幂等兜底。

> **Review 修复（vault events）：** Vault event 注册移回 Phase 1，handler 内用 null-safe 访问（`this.vss?.markDirtyIfEligible(file)`），避免漏掉 Sync 驱动的事件。
>
> **Review 决策（2026-06-18）：** 以功能完整稳定为先，接受 Memory/Stats 在 `onload()` 早初始化。`onLayoutReady()` 保留幂等 `initializeMemorySubsystem()` / `initializeStatsSubsystem()` 调用作为兜底，但不再把“轻量 onload”作为当前验收目标。

**Phase 2（onLayoutReady）：**

```typescript
private async onLayoutReady() {
    if (this.unloading) return;  // Review 修复 #8: onunload 保护

    // Memory 子系统（幂等；当前稳定性优先方案已在 onload() 早初始化）
    await this.initializeMemorySubsystem();

    // Chat history 异步初始化
    void this.chatHistoryManager?.initialize();

    // StatsManager（幂等；当前稳定性优先方案已在 onload() 早初始化）
    this.initializeStatsSubsystem();

    // MutationObserver（桌面专用）
    if (Platform.isDesktop) { this.setupHoverPopoverObserver(); }

    // Callout manager
    void this.initializeCalloutManager();

    // Settings watcher
    this.setupSettingsWatcher();

    // Phase 3: 空闲延迟
    this.phase3Handle = setPlatformTimeout(() => this.onIdle(), 0);
}
```

**Phase 3（空闲延迟）：**

```typescript
private phase3Handle: PlatformTimeoutHandle | null = null;
private unloading = false;

private onIdle() {
    if (this.unloading) return;
    this.phase3Handle = null;
    this.syncPageletRuntime();
    this.syncMemoryExtractionRuntime();
}
```

> **Review 修复 #8：** onunload 适配：
> ```typescript
> async onunload() {
>     this.unloading = true;
>     if (this.phase3Handle) {
>         clearPlatformTimeout(this.phase3Handle);
>         this.phase3Handle = null;
>     }
>     // ... existing teardown
> }
> ```

**字段懒化：**

```typescript
// 之前（构造期执行）
private localGraph = new LocalGraph(this.app, this);

// 之后（首次访问时构造）
private _localGraph: LocalGraph | null = null;
private get localGraph(): LocalGraph {
    return (this._localGraph ??= new LocalGraph(this.app, this));
}
```

**平台感知：**
- `Platform.isMobile` → 跳过 `setupHoverPopoverObserver()` 和 `setupStatusBar()`

**改动量：** ~200 行重构
**验证：** 冷启动 Obsidian，ribbon icon 立即出现，Chat 可用，Memory statusBar 延迟出现

---

### Step 1.8: Vault Event 派发整合

**修改 `src/plugin.ts`：**

提取 `private registerVaultEventDispatch()` 方法，合并 5 处 `updateMemoryStatusBar()` 为 debounced 版本：

```typescript
private debouncedStatusBarUpdate = debounce(() => {
    void this.updateMemoryStatusBar();
}, 300, true);
```

所有 vault handler 内 `await this.updateMemoryStatusBar()` → `this.debouncedStatusBarUpdate()`

**Vault event handler null-safety 完整清单：**

| Handler | 不安全调用 | null-safe 写法 |
|---------|----------|---------------|
| vault `create` | `pageletRuntime.isRecentSelfWrite(path)` | `this.pageletRuntime?.isRecentSelfWrite(path)` |
| vault `create` | `memoryExtractionScheduler.handleVaultEvent(file)` | `this.memoryExtractionScheduler?.handleVaultEvent(file, "vault-create")` |
| vault `create` | `vss.markDirtyIfEligible(file)` | `this.vss?.markDirtyIfEligible(file)` |
| vault `create` | `memoryManager.scheduleAutoFlush()` | `this.memoryManager?.scheduleAutoFlush("vault-create")` |
| vault `modify` | 同 create（4 处） | 同上 |
| vault `rename` | `memoryExtractionScheduler.handleVaultEvent(file)` | `this.memoryExtractionScheduler?.handleVaultEvent(file, "vault-rename")` |
| vault `rename` | `vss.handleRename(file, oldPath)` | `this.vss?.handleRename(file, oldPath)` |
| vault `rename` | `memoryManager.scheduleAutoFlush()` | `this.memoryManager?.scheduleAutoFlush("vault-rename")` |
| vault `delete` | `memoryExtractionScheduler.handleVaultEvent(file)` | `this.memoryExtractionScheduler?.handleVaultEvent(file, "vault-delete")` |
| vault `delete` | `vss.handleDelete(file)` | `await this.vss?.handleDelete(file)` |
| `active-leaf-change` | `vss.handleActiveLeafChange()` | `await this.vss?.handleActiveLeafChange()` |
| `file-open` | `vss.handleFileOpen(file)` | `this.vss?.handleFileOpen(file)` |
| `file-open` | `memoryManager.scheduleVerify/scheduleAutoFlush` | `this.memoryManager?.scheduleVerify(...)` |

> **注意：** `memoryExtractionScheduler` 转发路径在每个 vault handler 中都存在，整合到 `registerVaultEventDispatch()` 时不要遗漏。

**改动量：** ~80 行重构
**验证：** 快速编辑多个笔记，statusBar 合并更新（不再每次文件操作都刷新）

---

## Phase 2: 大文件拆分

### Step 2.1: 拆分 pa-agent-runtime.ts（2365 行 → 4 文件）

| 提取到 | 内容 | 预估行数 |
|--------|------|---------|
| `src/ai-services/memory-search-tool.ts` | `MemorySearchTool` 类 + RRF/expansion/rerank helpers | ~200 |
| `src/ai-services/pa-agent-stream-bridge.ts` | `PaStreamBridge` 类 + stream adapter | ~300 |
| `src/ai-services/pa-agent-prompts.ts` | prompt 模板常量 + builders | ~500 |
| `src/ai-services/pa-agent-runtime.ts`（保留） | `PaAgentRuntime` 核心类 | ~600 |

原模块通过 barrel re-export 保持导入路径兼容，避免更新外部 import。

**验证：** 所有测试通过（不改 import 路径）

---

### Step 2.2: 拆分 vss.ts（2759 行 → 4 文件）

| 提取到 | 内容 | 预估行数 |
|--------|------|---------|
| `src/vss/vss-indexer.ts` | `rebuildLocalIndex` / `refreshLocalIndex` 索引逻辑 | ~600 |
| `src/vss/vss-reconciler.ts` | `reconcileLocalFiles` / `verifyPendingChanges` 对账逻辑 | ~400 |
| `src/vss/vss-maintenance.ts` | dirty tracking / `flush` / legacy cleanup | ~400 |
| `src/vss.ts`（保留） | VSS 核心（init / search / dispose） + barrel re-export | ~800 |

`src/vss/` 目录已有 `types.ts`、`rrf.ts`、`sqlite-vector-index.ts` 等模块，拆分与现有结构一致。

**验证：** 所有 vss 相关测试通过

---

### Step 2.3: 拆分 chat-view.ts（3424 行 → 3 文件）

| 提取到 | 内容 | 预估行数 |
|--------|------|---------|
| `src/chat/MobileInputAdapter.ts` | keyboard + tab bar handling（13 字段） | ~600 |
| `src/chat/ConversationPersistence.ts` | 会话存储 / 恢复 / 切换（9 字段） | ~500 |
| `src/chat/chat-view.ts`（保留） | LLMView thin shell（渲染 + scroll + composer） | ~2300 |

**MobileInputAdapter 提取原则：**
- 所有 `keyboard*`、`nativeKeyboard*`、`mobileTabBar*` 字段和方法
- 构造条件：`Platform.isMobile` 时才创建
- 依赖：仅需 DOM 容器引用 + log 函数，不依赖会话状态

**ConversationPersistence 提取原则：**
- `activeConversationId`、`activeConversation`、`nextTurnIndex`、`persistedTurnIndexByEntry`、`persistChain` 字段
- `switchActiveConversation`、`persistTurn`、`deleteTurn`、`loadConversation` 方法
- 接收 `getChatHistoryManager()` 回调

**验证：** chat-view.test.ts 通过 + 冒烟：Chat 全流程（桌面 + 移动端）

---

## Phase 3: Capability Tier 系统

### Step 3.1: PolicyEngine 加 tier gate

**修改文件：**
- `src/ai-services/capability-types.ts` — `AgentCapability` 加 `tier?: 'free' | 'paid'`
- `src/ai-services/policy-engine.ts` — `evaluate()` 加 tier 检查

```typescript
// capability-types.ts
export type AgentCapabilityTier = "free" | "paid";

export interface AgentCapability {
    // ... existing fields
    tier?: AgentCapabilityTier;  // undefined = "free"（向后兼容）
}
```

```typescript
// policy-engine.ts — evaluate() 内新增
const capabilityTier = capability.tier ?? "free";
if (capabilityTier === "paid" && this.licenseTier === "free") {
    return { allowed: false, reason: "premium-required" };
}
```

**改动量：** ~25 行
**验证：** `policy-engine.test.ts` 扩展 tier gate 测试

---

### Step 3.2: Capability tier 标注

**修改 `src/ai-services/chat-tool-factories.ts`** — 各工厂函数加 `tier` 标注：

| Capability | Tier |
|-----------|------|
| Memory Search | `free` |
| Vault Search | `free` |
| Note Inspect | `free` |
| Web Search | `paid` |
| Append / Write Actions | `paid` |
| Skills | `paid` |

**改动量：** ~30 行

---

### Step 3.3: License settings

**修改文件：**
- `src/settings.ts` — `PluginManagerSettings` 加 `licenseTier: AgentCapabilityTier`（默认 `"free"`）
- `src/plugin.ts` — `createAiServiceHost()` 内传 `licenseTier` 给 PolicyEngine

**改动量：** ~15 行

---

## 验证策略

### 启动性能 Benchmark 基线

> Step 1.7 前采集一次基线，Step 1.7 后对比。

在 `onload()` 首行和末行加 `performance.now()` 测量：

```typescript
async onload() {
    const t0 = performance.now();
    // ... existing code ...
    console.log(`[PA] onload completed in ${(performance.now() - t0).toFixed(1)}ms`);
}
```

分别在 **桌面** 和 **移动端** 冷启动 3 次取均值，记录为基线。Step 1.7 完成后用同样方式对比。目标：Phase 1 阻塞部分 ≤ 100ms（桌面）/ ≤ 200ms（移动端）。

### 每步验证 Checklist

```
□ tsc --noEmit          — 类型检查通过
□ npm test              — 全部测试绿色
□ make deploy           — 构建 + 部署到测试 vault
□ 手动冒烟测试对应功能     — 见下方 Step 冒烟矩阵
```

### Step 冒烟测试矩阵

| Step | 冒烟测试内容 |
|------|------------|
| 1.1-1.2 | 无运行时变更，编译通过即可 |
| 1.3 | 打开 Memory 状态，触发 Memory 准备，验证 embedding 完成 |
| 1.4 | 发送 Chat 消息（Memory enabled），验证 tool calls 和搜索结果 |
| 1.5 | 打开 Chat sidebar，验证 Memory chip 状态，发送消息，验证 streaming |
| 1.6 | 打开 Statistics view，编辑文件，验证字数统计更新 |
| 1.7 | 冷重启 Obsidian，主观验证启动速度，确认所有功能可用 |
| 1.8 | 快速编辑多个笔记，验证 statusBar debounce 合并更新 |
| 2.1-2.3 | 全量回归：Chat / Memory / Pagelet / Stats 全部验证 |
| 3.1-3.3 | 验证 free-tier capability 可用，paid capability 无 license 时被拒绝 |

---

## 提交策略

每步一个 conventional commit，签名（`git commit -s`），不加 Co-Authored-By：

```
refactor(memory): define MemoryHost + Port interfaces [Step 1.1]
refactor(memory): add createMemoryHost adapter [Step 1.2]
refactor(memory): wire MemoryManager + VSS to accept MemoryHost [Step 1.3]
refactor(ai): define AiServiceHost, rewire PaAgentRuntime + ChatService [Step 1.4]
refactor(chat): define ChatHost, rewire LLMView [Step 1.5]
refactor(stats): define StatsHost, rewire StatsManager [Step 1.6]
refactor(startup): three-phase startup restructuring [Step 1.7]
refactor(events): consolidate vault event dispatch with debounced status bar [Step 1.8]
refactor(ai): extract MemorySearchTool from pa-agent-runtime [Step 2.1]
refactor(vss): split vss.ts into indexer/reconciler/maintenance [Step 2.2]
refactor(chat): extract MobileInputAdapter + ConversationPersistence [Step 2.3]
feat(tier): add capability tier gate to PolicyEngine [Step 3.1]
feat(tier): annotate capabilities with free/paid tier [Step 3.2]
feat(tier): add license settings [Step 3.3]
```

---

## Phase 依赖图

```
Phase 0（测试审计 + 共享 fixture）
    ↓
Phase 1（Host 接口 + 启动优化）
    ├── Step 1.1 → 1.2 → 1.3a → 1.3b（Memory + AIUtils 前置）
    ├── Step 1.4a → 1.4b → 1.4c（AI，依赖 1.3b 的 MemorySearchPort）
    ├── Step 1.5（Chat，依赖 1.3b 的 MemoryStatusPort）
    ├── Step 1.6（Stats，独立）
    ├── Step 1.7（启动重构，依赖 1.3b-1.6）
    └── Step 1.8（事件整合，依赖 1.7）
    ↓
Phase 2（文件拆分，可与 Phase 1 后半交替）
    ├── Step 2.1（pa-agent-runtime，依赖 1.4c）
    ├── Step 2.2（vss，依赖 1.3b）
    └── Step 2.3（chat-view，依赖 1.5）
    ↓
Phase 3（Tier 系统，依赖 1.4c）
    └── Step 3.1 → 3.2 → 3.3
```

---

## 刻意留在 PluginManager 上的文件

> **Review 修复：** 明确列出不在本轮重构范围内的文件，防止实施时误判"是否遗漏"。

| 文件 | 理由 |
|------|------|
| `src/settings.ts` | SettingTab UI 直接操作 Obsidian 设置面板，与 Plugin 生命周期绑定 |
| `src/local-graph.ts` | 桌面专用、命令驱动、低 churn，Host 化收益低 |
| `src/view.ts` / `src/preview.ts` | Obsidian ViewPlugin 基类，直接依赖 Plugin 实例 |
| `src/callout.ts` | CalloutManager 集成，独立性强但改动频率极低 |
| `src/progress-bar.ts` | UI 工具类，Plugin 引用仅用于 app 访问 |
| `src/ai.ts`（AssistantHelper） | 命令回调内按需创建，不常驻，后续可渐进提取 |
| `src/plugin-manifest.ts` / `src/theme-manifest.ts` | 低频命令，独立工具类 |
| `src/chat/modals.ts` | 仅用 `PluginManager` 类型做 `import type`，运行时访问 `app` 属性，低耦合 |
| `src/stats-view.ts` | Obsidian ItemView 子类，直接依赖 Plugin 实例获取 `statsManager`，后续可随 StatsHost 扩展 |

## 预估改动量总结

| Phase | 步骤数 | 预估总改动行数 | 预估工时 |
|-------|--------|-------------|---------|
| Phase 0 | - | ~200 行（测试补缝 + fixture） | 1-2 天 |
| Phase 1 | 10 步（含子步骤） | ~1,820 行 | 7-12 天 |
| Phase 2 | 3 步 | ~200 行（主要是文件移动） | 3-5 天 |
| Phase 3 | 3 步 | ~70 行 | 1-2 天 |
| **合计** | **16 步** | **~2,290 行** | **12-21 天** |

> **Review 修复 #9：** 原估算 ~1,570 行低估了 AgentCapabilityContext 级联（+200 行）、AIUtils 重构（+50 行）、测试 fixture（+100 行）、MemoryHost 补全（+50 行）等，修正为 ~2,270 行。
