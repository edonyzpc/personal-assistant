# SDD: Architecture Refactor — Codex 驱动实施规范

> 将 `docs/architecture-refactor-plan.md` 的 16 步重构方案拆解为 Codex 可独立执行的原子任务。每个 SPEC 是一个自包含的 Codex 任务 prompt——包含完整上下文、精确改动规则和自动化验证命令。
>
> - **What lives here**：每个 SPEC 的执行规范、依赖关系、验证命令、Codex prompt 模板
> - **What does NOT live here**：架构决策推导过程（→ `docs/architecture-refactor-plan.md`）、产品定价策略（→ memory `tier-pricing-strategy`）
> - **Traceability**：每个 SPEC 对应 `architecture-refactor-plan.md` 的一个 Step

---

## 0. Status & Execution Strategy

| 字段 | 值 |
|------|---|
| Spec version | 1.0 |
| 源方案 | `docs/architecture-refactor-plan.md`（经 2 轮 agent review，9+3 项修复） |
| 目标 | 16 个 SPEC，每个可作为独立 Codex task 执行 |
| 执行模式 | 顺序执行（遵循依赖图），每个 SPEC 产出一个 commit |
| 验证基线 | `tsc -noEmit -skipLibCheck && npm test`（每个 SPEC 必须通过） |
| 手动验证 | 关键节点（1.3b, 1.4c, 1.5, 1.7）需人工 `make deploy` + 冒烟测试 |

> **Closeout note (2026-06-18):** This document keeps the original SPEC prompts and checklist templates for traceability. Live completion status, accepted deviations, and follow-up work are tracked in `docs/architecture-refactor-development-tracker.md`.

### Codex 执行原则

1. **每个 SPEC 是一个 Codex task**：直接复制 SPEC 的 Prompt 部分作为 Codex 输入
2. **顺序执行**：前一个 SPEC 的 PR 合并后再启动下一个
3. **不做额外决策**：所有设计决策已锁定，Codex 只做机械性实施
4. **验证即完成**：`tsc -noEmit -skipLibCheck && npm test` 全绿 = SPEC 完成
5. **不改测试逻辑**：只改测试中的 mock 结构以匹配新接口，不改断言逻辑

### Phase 0 不走 Codex

Phase 0（测试审计）是探索性工作，需要人工判断哪些 mock 结构需要预适配。在 Phase 0 手动完成以下产出物后再启动 Codex：

1. 跑 `grep -rln 'createPlugin\|fakePlugin\|plugin:.*any' __tests__/` 产出完整测试文件清单
2. 在 `src/tests/factories/` 创建共享 fixture 函数
3. 确认所有现有测试绿色

---

## 依赖图

```
SPEC-01 → SPEC-02 → SPEC-03 → SPEC-04（Memory 子链）
                                  ↓
                     SPEC-05 → SPEC-06 → SPEC-07（AI 子链）
                                  ↓
                               SPEC-08（Chat）
                               SPEC-09（Stats，独立）
                                  ↓
                               SPEC-10（三阶段启动，依赖 04-09）
                               SPEC-11（Vault event，依赖 10）
                                  ↓
                     SPEC-12 / SPEC-13 / SPEC-14（Phase 2 拆分）
                                  ↓
                     SPEC-15 → SPEC-16（Phase 3 Tier）
```

可并行执行的 SPEC：
- SPEC-09（Stats）与 SPEC-05/06/07/08 无依赖，可并行
- SPEC-12/13/14 互相独立，可并行

---

## SPEC-01: 定义 MemoryHost + Port 接口

| 字段 | 值 |
|------|---|
| 对应 Step | 1.1 |
| 前置 | Phase 0 完成 |
| 分支 | `refactor/memory-host-interfaces` |
| 改动性质 | 纯新增（type-only），零运行时变更 |
| 预估 | ~100 行新增 |

### Codex Prompt

```
你是一个 TypeScript 重构专家。请在这个 Obsidian 插件项目中创建 Memory 子系统的 Host 和 Port 接口定义。

## 上下文
这个项目正在将 God Object `PluginManager`（src/plugin.ts）拆解为通过 Host 接口隔离的子系统。已有一个成功案例 `src/pagelet/PageletHost.ts`——所有新接口遵循相同模式。

## 任务
创建以下 4 个文件：

### 1. `src/memory/MemoryHost.ts`
定义 Memory 子系统（VSS + MemoryManager）的 Host 接口：
- `readonly app: App`
- `readonly pluginId: string`
- `settings` 切片包含：memoryEnabled, memoryAutoCheckBeforeChat, memoryApprovalPolicy (string), vssCacheExcludePath (string[]), debug (boolean), aiProvider (string), embeddingModelName (string), baseURL (string), statisticsVaultId (string)
- `log(message: string, ...args: unknown[]): void`
- `registerEvent(ref: EventRef): void`
- `saveSettings(): Promise<void> | void`
- `getVSSFiles(): TFile[]`
- `getAPIToken(): Promise<string>`
- `notifyStatusChanged(): void`
- `updateMemorySetting<K extends keyof settings>(key: K, value: settings[K]): void`

import 类型从 "obsidian" 获取 App, EventRef, TFile。

### 2. `src/memory/MemorySearchPort.ts`
AI Services 消费的窄搜索接口（3 方法）：
- `ensureReadyForChat(query?: string): Promise<MemoryDecisionResult>`
- `searchHybrid(query: string, opts?): Promise<unknown[]>`
- `getChunksByPath(paths: string[], opts?): Promise<unknown[]>`

opts 参数和返回类型使用 unknown 或导入自 src/vss.ts 和 src/memory-manager.ts 的现有类型。

### 3. `src/memory/MemoryStatusPort.ts`
Chat UI 消费的状态接口（5 方法）：
- `getMaintenancePlan(): Promise<MemoryMaintenancePlan>`
- `prepareFromCommand(): Promise<void>`
- `updateFromCommand(): Promise<void>`
- `showTechnicalStatus(): void`
- `onStatusChanged(listener: () => void | Promise<void>): () => void`

### 4. `src/memory/index.ts`
barrel export，re-export 上面 3 个文件的所有 public 类型。

## 参考
阅读 `src/pagelet/PageletHost.ts` 了解接口风格和 JSDoc 注释模式。

## 验证
运行 `npx tsc -noEmit -skipLibCheck` 确认编译通过。这些是纯类型文件，不应影响任何运行时行为。
运行 `npm test` 确认所有现有测试仍然通过。
```

### 验证命令
```bash
npx tsc -noEmit -skipLibCheck && npm test
```

### 完成标准
- [ ] 4 个文件已创建
- [ ] `tsc -noEmit -skipLibCheck` 通过
- [ ] `npm test` 全绿
- [ ] 无运行时行为变更

---

## SPEC-02: 创建 MemoryHost 适配器

| 字段 | 值 |
|------|---|
| 对应 Step | 1.2 |
| 前置 | SPEC-01 |
| 分支 | `refactor/memory-host-adapter` |
| 改动性质 | plugin.ts 新增方法，不消费 |
| 预估 | ~40 行 |

### Codex Prompt

```
你是一个 TypeScript 重构专家。在 src/plugin.ts 中新增 `createMemoryHost()` 私有方法。

## 上下文
SPEC-01 已创建 `src/memory/MemoryHost.ts` 接口。现在需要在 PluginManager 中创建返回该接口的适配器方法，与现有的 `createPageletHost()`（约 line 798）采用相同模式。

## 任务
1. 在 `src/plugin.ts` 顶部添加 import：`import type { MemoryHost } from './memory'`
2. 在 PluginManager 类中添加以下私有方法（放在 `createPageletHost()` 方法附近）：

```typescript
private createMemoryHost(): MemoryHost {
    return {
        app: this.app,
        pluginId: this.manifest.id,
        settings: this.settings,
        log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
        registerEvent: (ref) => this.registerEvent(ref),
        saveSettings: () => this.saveSettings(),
        getVSSFiles: () => this.getVSSFiles(),
        getAPIToken: () => this.getAPIToken(),
        notifyStatusChanged: () => void this.updateMemoryStatusBar(),  // SPEC-11 会升级为 debounced 版本
        updateMemorySetting: (key, value) => {
            (this.settings as Record<string, unknown>)[key] = value;
            void this.saveSettings();
        },
    };
}
```

注意：此方法仅定义，本 SPEC 不消费它。消费在后续 SPEC-04 中进行。

## 验证
运行 `npx tsc -noEmit -skipLibCheck` 确认编译通过。
运行 `npm test` 确认所有测试通过。
```

### 验证命令
```bash
npx tsc -noEmit -skipLibCheck && npm test
```

---

## SPEC-03: 重构 AIUtils 接受窄接口

| 字段 | 值 |
|------|---|
| 对应 Step | 1.3a |
| 前置 | SPEC-01 |
| 分支 | `refactor/ai-utils-narrow-interface` |
| 改动性质 | AIUtils 构造函数改窄 + VSS 死代码清理 |
| 预估 | ~50 行 |

### Codex Prompt

```
你是一个 TypeScript 重构专家。将 AIUtils 的构造函数从依赖 PluginManager 改为依赖窄接口。

## 上下文
`src/ai-services/ai-utils.ts` 中的 AIUtils 类构造函数当前接受 `plugin: PluginManager`。后续重构将使 VSS 和 ChatService 不再持有 PluginManager 引用，但它们内部会 `new AIUtils(plugin)` ——必须先让 AIUtils 接受窄接口。

## 任务

### 1. 修改 `src/ai-services/ai-utils.ts`
- 查找 AIUtils 类的构造函数（搜索 `constructor`）
- 定义或 inline 一个窄类型替代 PluginManager：
  ```typescript
  interface AIUtilsHost {
      readonly settings: {
          aiProvider: string;
          chatModelName: string;
          embeddingModelName: string;
          baseURL: string;
      };
      getAPIToken(): Promise<string>;
      log(message: string, ...args: unknown[]): void;
  }
  ```
- 将构造函数参数从 `plugin: PluginManager` 改为 `host: AIUtilsHost`（或让 AIUtilsHost 作为接口 export）
- 更新类内所有 `this.plugin.settings.X` → `this.host.settings.X`
- 更新所有 `this.plugin.log(...)` → `this.host.log(...)`
- 更新 API token 获取路径
- 移除 `import type { PluginManager } from "../plugin"` 如果不再需要

### 2. 清理 `src/vss.ts` 死代码
- 搜索 `aiService` 字段声明和赋值（约 line 247 声明，line 292 构造）
- 确认 `this.aiService` 在文件内无调用点（零使用）
- 删除字段声明和构造行
- 如果 `import { AIService }` 因此变为未使用，也删除该 import

### 3. 更新调用点
- `src/vss.ts` 中的 `new AIUtils(plugin)` 保持不变——PluginManager 结构性满足 AIUtilsHost，无需 cast。SPEC-04 会将 plugin 替换为 host
- `src/ai-services/chat-service.ts` 中的 `new AIUtils(plugin)` 同理——结构性兼容，无需 `as any`

## 验证
运行 `npx tsc -noEmit -skipLibCheck` 确认编译通过。
运行 `npm test` 确认所有测试通过（重点关注 `ai-utils.test.ts`）。
```

### 验证命令
```bash
npx tsc -noEmit -skipLibCheck && npm test
```

---

## SPEC-04: 接入 MemoryHost，合并 MemoryManager + VSS

| 字段 | 值 |
|------|---|
| 对应 Step | 1.3b |
| 前置 | SPEC-02 + SPEC-03 |
| 分支 | `refactor/memory-host-wiring` |
| 改动性质 | 构造函数签名变更 + 全量 plugin→host 替换 |
| 预估 | ~220 行 |
| 人工验证 | **需要 `make deploy` + Memory 冒烟测试** |

### Codex Prompt

```
你是一个 TypeScript 重构专家。将 MemoryManager 和 VSS 的构造函数从依赖 PluginManager 改为依赖 MemoryHost。

## 上下文
- `src/memory/MemoryHost.ts` 已定义（SPEC-01）
- `src/plugin.ts` 已有 `createMemoryHost()` 方法（SPEC-02）
- `src/ai-services/ai-utils.ts` 的 AIUtils 已接受窄接口（SPEC-03）

## 任务

### 1. 修改 `src/memory-manager.ts`
构造函数从 `(plugin: PluginManager)` 改为 `(host: MemoryHost, vss: VSS)`。

替换规则（对文件内所有 `this.plugin.*` 引用）：
| 原代码 | 新代码 |
|--------|--------|
| `this.plugin.vss.*` | `this.vss.*` |
| `this.plugin.settings.*` | `this.host.settings.*` |
| `this.plugin.log(...)` | `this.host.log(...)` |
| `this.plugin.updateMemoryStatusBar()` | `this.host.notifyStatusChanged()` |
| `this.plugin.settings.memoryApprovalPolicy = X` | `this.host.updateMemorySetting("memoryApprovalPolicy", X)` |
| `(this.plugin as ...).saveSettings?.()` | `this.host.saveSettings()` |

对于 MemoryApprovalModal 构造调用（memory-manager.ts:632 附近）：实际签名是 `new MemoryApprovalModal(this.plugin, plan, resolve, context)`。将第一个参数从 `this.plugin` 改为 `this.host.app`，同时修改 MemoryApprovalModal 构造函数的第一个参数类型从 `PluginManager` 改为 `App`（modal 内部只用 `super(app)` 调用父类，plugin 字段是死代码）。

移除 `import type { PluginManager } from "../plugin"`，改为 `import type { MemoryHost } from "./memory"`。

### 2. 修改 `src/vss.ts`
构造函数从 `(plugin: PluginManager, cacheDir: string, stateStore: VSSIndexStateStore)` 改为 `(host: MemoryHost, cacheDir: string, stateStore: VSSIndexStateStore)`。

替换规则：
| 原代码 | 新代码 |
|--------|--------|
| `this.plugin.log(...)` | `this.host.log(...)` |
| `this.plugin.app.vault` | `this.host.app.vault` |
| `this.plugin.app.metadataCache` | `this.host.app.metadataCache` |
| `this.plugin.getVSSFiles()` | `this.host.getVSSFiles()` |
| `this.plugin.manifest` (在 getPluginId) | `this.host.pluginId` |
| `new AIUtils(plugin)` 或 `new AIUtils(this.plugin)` | `new AIUtils(host)` |

移除 `import { PluginManager }` 或 `import type { PluginManager }`。

### 3. 修改 `src/plugin.ts` 的实例化
找到 VSS 和 MemoryManager 的创建代码，替换为：
```typescript
const memoryHost = this.createMemoryHost();
this.vss = new VSS(memoryHost, this.vssCacheDir, this.createVSSIndexStateStore());
this.memoryManager = new MemoryManager(memoryHost, this.vss);
```

### 4. 更新测试
- `__tests__/vss.test.ts`：mock 对象结构适配 MemoryHost（保留所有现有断言不变，只改 mock 对象的属性名和结构）
- `__tests__/memory-manager.test.ts`：同上，构造调用改为 `new MemoryManager(mockHost, mockVss)`
- 其他引用这两个类的测试文件

## 验证
运行 `npx tsc -noEmit -skipLibCheck` 确认编译通过。
运行 `npm test` 确认所有测试通过。
重点关注：`vss.test.ts`, `vss-data-safety.test.ts`, `vss-state.test.ts`, `memory-manager.test.ts`。
```

### 验证命令
```bash
npx tsc -noEmit -skipLibCheck && npm test
```

---

## SPEC-05: 定义 AiServiceHost 接口

| 字段 | 值 |
|------|---|
| 对应 Step | 1.4a (接口定义部分) |
| 前置 | SPEC-01（MemorySearchPort 类型） |
| 分支 | `refactor/ai-service-host-interface` |
| 改动性质 | 纯新增（type-only） |
| 预估 | ~50 行 |

### Codex Prompt

```
你是一个 TypeScript 重构专家。创建 AI Services 子系统的 Host 接口。

## 任务
创建 `src/ai-services/AiServiceHost.ts`：

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
    getMemoryExtractionPromptContext(): Record<string, unknown> | undefined;
    readonly memorySearch: MemorySearchPort;
    getResolvedLinks(): Record<string, Record<string, number>> | undefined;
}
```

参考 `src/pagelet/PageletHost.ts` 的 JSDoc 注释风格添加接口文档。

## 验证
运行 `npx tsc -noEmit -skipLibCheck` 确认编译通过。
运行 `npm test` 确认所有测试通过。
```

---

## SPEC-06: 重接 PaAgentRuntime + ChatService 到 AiServiceHost

| 字段 | 值 |
|------|---|
| 对应 Step | 1.4a (重接部分) |
| 前置 | SPEC-04 + SPEC-05 |
| 分支 | `refactor/ai-service-host-wiring` |
| 改动性质 | 构造函数签名变更 + plugin→host 替换 |
| 预估 | ~150 行 |

### Codex Prompt

```
你是一个 TypeScript 重构专家。将 PaAgentRuntime 和 ChatService 的构造函数从依赖 PluginManager 改为依赖 AiServiceHost。

## 任务

### 1. 修改 `src/ai-services/pa-agent-runtime.ts`
将 PaAgentRuntime 构造函数的 `plugin: PluginManager` 参数改为 `host: AiServiceHost`。

替换所有 `this.plugin.*` 引用：
| 原代码 | 新代码 |
|--------|--------|
| `this.plugin.settings.X` | `this.host.settings.X` |
| `this.plugin.log(...)` | `this.host.log(...)` |
| `this.plugin.isOperationsAgentEnabled` | `this.host.isOperationsAgentEnabled` |
| `this.plugin.getMemoryExtractionPromptContext()` | `this.host.getMemoryExtractionPromptContext()` |
| `this.plugin.memoryManager.ensureReadyForChat(query)` | `this.host.memorySearch.ensureReadyForChat(query)` |
| `this.plugin.vss.searchHybrid(...)` | `this.host.memorySearch.searchHybrid(...)` |
| `this.plugin.vss.getChunksByPath(...)` | `this.host.memorySearch.getChunksByPath(...)` |
| `this.plugin.app?.metadataCache?.resolvedLinks` | `this.host.getResolvedLinks()` |
| `this.plugin.app` | `this.host.app` |

同样更新文件内的 MemorySearchTool 类（如果它持有 plugin 引用）。

### 2. 修改 `src/ai-services/chat-service.ts`
构造函数从 `(plugin: PluginManager)` 改为 `(host: AiServiceHost)`。
更新所有 `this.plugin.*` 引用。
`new AIUtils(plugin)` 改为 `new AIUtils(host)`（AIUtils 已在 SPEC-03 接受窄接口）。

### 3. 在 `src/plugin.ts` 中添加 `createAiServiceHost()` 适配器
```typescript
private createAiServiceHost(): AiServiceHost {
    return {
        app: this.app,
        settings: this.settings,
        log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
        getAPIToken: () => this.getAPIToken(),
        isOperationsAgentEnabled: this.isOperationsAgentEnabled,
        getMemoryExtractionPromptContext: () => this.getMemoryExtractionPromptContext?.(),
        memorySearch: {
            ensureReadyForChat: (query) => this.memoryManager?.ensureReadyForChat(query) ?? Promise.resolve({ decision: "answer-now" }),
            searchHybrid: (query, opts) => this.vss?.searchHybrid(query, opts) ?? Promise.resolve([]),
            getChunksByPath: (paths, opts) => this.vss?.getChunksByPath(paths, opts) ?? Promise.resolve([]),
        },
        getResolvedLinks: () => this.app?.metadataCache?.resolvedLinks as Record<string, Record<string, number>> | undefined,
    };
}
```

更新 ChatService 的创建点，使用 `new ChatService(this.createAiServiceHost())`。

### 4. 更新测试
- `__tests__/chat-service.test.ts`：mock 结构适配 AiServiceHost
- `__tests__/pa-agent-runtime-*.test.ts`：同上
- 保留所有断言逻辑不变

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
重点关注：`chat-service.test.ts`, `pa-agent-runtime-*.test.ts`, `pa-agent-loop.test.ts`。
```

---

## SPEC-07: AgentCapabilityContext 级联更新

| 字段 | 值 |
|------|---|
| 对应 Step | 1.4b + 1.4c |
| 前置 | SPEC-06 |
| 分支 | `refactor/capability-context-host` |
| 改动性质 | 机械性 plugin→host 重命名，涉及 12+ 源文件 + 7 测试文件 |
| 预估 | ~350 行 |

### Codex Prompt

```
你是一个 TypeScript 重构专家。将 AgentCapabilityContext 中的 `plugin: PluginManager` 字段重命名为 `host: AiServiceHost`，并级联更新所有消费者。

## 上下文
SPEC-06 已将 PaAgentRuntime 和 ChatService 重接到 AiServiceHost。但 AgentCapabilityContext（定义在 src/ai-services/capability-types.ts 约 line 70）仍持有 `plugin: PluginManager`。所有 tool execution 代码通过 `context.plugin.*` 访问 app、settings、log 等。

## 任务

### Step 1: 修改 context 定义
- `src/ai-services/capability-types.ts`：将 `plugin: PluginManager` 改为 `host: AiServiceHost`
- `src/ai-services/chat-tool-types.ts`：更新 context 类型引用
- `src/ai-services/pa-agent-host-tools.ts`：更新 context 使用

### Step 2: 级联更新全部 context.plugin 消费者
对以下每个文件，将所有 `context.plugin` 替换为 `context.host`：

源文件清单：
- `src/ai-services/chat-tool-factories.ts`（17 处，最大消费者）
- `src/ai-services/chat-tool-execution-helpers.ts`（15+ 函数的 `plugin: PluginManager` 参数类型改为 `host: AiServiceHost`，注意这些是函数参数而非 `context.plugin` 属性访问）
- `src/ai-services/capability-adapter.ts`（3 处，lines 271/288/301 附近）
- `src/ai-services/capability-registry.ts`（2 处 context.plugin.log，lines 251/263 附近）
- `src/ai-services/append-tool-provider.ts`（1 处，line 139 附近）
- `src/ai-services/write-action-framework/types.ts`（3 处方法签名）
- `src/ai-services/write-action-framework/runtime-integration.ts`（3 处）

### Step 3: 更新测试文件
对以下测试文件，将 mock 中的 `plugin` 属性改为 `host`，mock 结构适配 AiServiceHost：
- `__tests__/capability-registry.test.ts`
- `__tests__/skill-context-provider.test.ts`
- `__tests__/pagelet-self-write-no-loop.spec.ts`
- `__tests__/pagelet-prompt-injection.spec.ts`
- `__tests__/pagelet-cancel-abort.spec.ts`
- `__tests__/e2e-pagelet-write.spec.ts`
- `src/ai-services/write-action-framework/runtime-integration.spec.ts`（如果存在）

不要修改任何断言逻辑——只改 mock 对象的属性名和结构。

### Step 4: 更新 context 创建点
在 `src/ai-services/pa-agent-runtime.ts` 中找到构建 AgentCapabilityContext 的代码，将 `plugin: this.plugin` 改为 `host: this.host`。

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
如果有遗漏的 `context.plugin` 引用，tsc 会报错——根据错误信息继续替换直到编译通过。
```

---

## SPEC-08: 定义 ChatHost，重接 LLMView

| 字段 | 值 |
|------|---|
| 对应 Step | 1.5 |
| 前置 | SPEC-04（MemoryStatusPort）+ SPEC-06（ChatService 已重接） |
| 分支 | `refactor/chat-host` |
| 改动性质 | 接口定义 + 构造函数变更 + plugin→host 替换 |
| 预估 | ~220 行 |
| 人工验证 | **需要 `make deploy` + Chat 冒烟测试** |

### Codex Prompt

```
你是一个 TypeScript 重构专家。创建 ChatHost 接口并将 LLMView 从依赖 PluginManager 改为依赖 ChatHost。

## 任务

### 1. 创建 `src/chat/ChatHost.ts`
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

### 2. 修改 `src/chat/chat-view.ts`
- 构造函数从 `(leaf: WorkspaceLeaf, plugin: PluginManager, vss: VSS)` 改为 `(leaf: WorkspaceLeaf, host: ChatHost)`
- 删除 `vss` 参数（不再直接使用）
- 替换所有 `this.plugin.*` 引用为 `this.host.*`（约 30+ 处，其中 17 处是 log）
- 关键替换：
  - `this.plugin.memoryManager.getMaintenancePlan()` → `this.host.memoryStatus.getMaintenancePlan()`
  - `this.plugin.memoryManager.prepareFromCommand()` → `this.host.memoryStatus.prepareFromCommand()`
  - `this.plugin.memoryManager.updateFromCommand()` → `this.host.memoryStatus.updateFromCommand()`
  - `this.plugin.chatHistoryManager` → `this.host.chatHistoryManager`
  - `this.plugin.getAISetupIssue()` → `this.host.getAISetupIssue()`

### 3. 在 `src/plugin.ts` 中添加 `createChatHost()` 适配器
并更新 `registerView(VIEW_TYPE_LLM, ...)` 的 factory：
从 `(leaf) => new LLMView(leaf, this, this.vss)` 改为 `(leaf) => new LLMView(leaf, this.createChatHost())`

createChatHost 内部通过 `this.createAiServiceHost()` 创建 ChatService：
```typescript
createChatService: () => new ChatService(this.createAiServiceHost()),
```

### 4. 更新测试
- `__tests__/chat-view.test.ts`：mock 结构从 plugin 适配为 ChatHost

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
重点关注：`chat-view.test.ts`。
```

---

## SPEC-09: 定义 StatsHost + EditorPluginHost，重接 StatsManager

| 字段 | 值 |
|------|---|
| 对应 Step | 1.6 |
| 前置 | 无（独立于 SPEC-04-08） |
| 分支 | `refactor/stats-host` |
| 改动性质 | 接口定义 + 构造函数变更 |
| 预估 | ~100 行 |

### Codex Prompt

```
你是一个 TypeScript 重构专家。创建 StatsHost 和 EditorPluginHost 接口，并重接 StatsManager。

## 任务

### 1. 创建 `src/stats/StatsHost.ts`
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

### 2. 创建 `src/stats/EditorPluginHost.ts`
```typescript
import type { App } from "obsidian";
import type StatsManager from "./stats-manager";
export interface EditorPluginHost {
    readonly app: App;
    readonly settings: {
        displaySectionCounts: boolean;
        countComments: boolean;
    };
    readonly statsManager: StatsManager | undefined;
}
```

### 3. 修改 `src/stats/stats-manager.ts`
- 构造函数从 `(app: App, plugin: PluginManager)` 改为 `(host: StatsHost)`
- 内部 `this.app` → `this.host.app`，`this.plugin.settings.*` → `this.host.settings.*`
- `this.plugin.log(...)` → `this.host.log(...)`
- `this.plugin.registerEvent(...)` → `this.host.registerEvent(...)`

### 4. 修改 `src/stats/editor-plugin.ts`
- `pluginField` 的类型从 `StateField<PluginManager>` 改为 `StateField<EditorPluginHost | null>`
- 更新 `StatusBarEditorPlugin` 和 `SectionWordCountEditorPlugin` 中的属性访问

### 5. 更新测试
- `__tests__/stats-manager.test.ts`：mock 适配 StatsHost

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
```

---

## SPEC-10: 三阶段启动重构

| 字段 | 值 |
|------|---|
| 对应 Step | 1.7 |
| 前置 | SPEC-04 + SPEC-06 + SPEC-08 + SPEC-09 |
| 分支 | `refactor/three-phase-startup` |
| 改动性质 | onload() 重构 + 字段懒化 + 平台感知 |
| 预估 | ~200 行 |
| 人工验证 | **需要 `make deploy` + 冷启动冒烟测试（桌面 + 移动端）** |

### Codex Prompt

```
你是一个 TypeScript 重构专家。将 PluginManager 的 onload() 方法重构为三阶段启动。

## 上下文
当前 onload() 同步初始化所有子系统（~380 行）。最初目标是把重型子系统后移；2026-06-18 review 后的验收决策是以功能完整稳定为先，接受 Memory/Stats 早初始化，同时保留 `onLayoutReady()` / `onIdle()` 的阶段边界：
- Phase 1（onload 同步）：Settings + UI 注册 + Commands + Memory/Stats shell init
- Phase 2（onLayoutReady）：ChatHistory.initialize + Callout + Settings watcher + 幂等 Memory/Stats guard
- Phase 3（setTimeout 0）：Pagelet + MemoryExtraction

## 任务

### 1. 重构 `src/plugin.ts` 的 onload()

将 onload() 拆分为三个方法：`onload()`、`private onLayoutReady()`、`private onIdle()`。

**Phase 1 (onload) 保留：**
- loadSettings / migrateSettings
- debug 设置
- addIcon / addRibbonIcon / setupStatusBar（桌面）
- chatHistoryStore + chatHistoryManager 创建（纯同步构造函数）
- registerView ×4
- registerEditorExtension
- Memory 子系统创建（VSS + MemoryManager + startAutoMaintenance），用于避免早期命令、事件、Chat restore 访问空 runtime
- StatsManager 创建，用于避免编辑器扩展和早期 workspace 事件访问空 runtime
- vault event 注册（保持 inline，handler 内 null-safe 访问 vss/memoryManager；SPEC-11 会提取为 registerVaultEventDispatch 方法）
- addCommand ×所有
- addSettingTab
- `this.app.workspace.onLayoutReady(() => this.onLayoutReady())`

**Phase 2 (onLayoutReady) 移入：**
- `initializeMemorySubsystem()` 幂等调用（早初始化已完成时只刷新状态）
- chatHistoryManager.initialize()（异步）
- `initializeStatsSubsystem()` 幂等调用
- MutationObserver（桌面专用：`if (Platform.isDesktop)`）
- initializeCalloutManager
- setupSettingsWatcher
- `this.phase3Handle = setPlatformTimeout(() => this.onIdle(), 0)`

**Phase 3 (onIdle) 移入：**
- syncPageletRuntime
- syncMemoryExtractionRuntime

### 2. 添加 onunload 保护
```typescript
private phase3Handle: PlatformTimeoutHandle | null = null;
private unloading = false;
```
在 onLayoutReady 和 onIdle 开头检查 `if (this.unloading) return`。
在 onunload 中：`this.unloading = true; if (this.phase3Handle) clearPlatformTimeout(this.phase3Handle)`。

### 3. 字段懒化
将 `private localGraph = new LocalGraph(this.app, this)` 改为懒加载 getter：
```typescript
private _localGraph: LocalGraph | null = null;
private get localGraph(): LocalGraph {
    return (this._localGraph ??= new LocalGraph(this.app, this));
}
```

### 4. 命令 null guard
找到 `runMemoryCommand()` 方法，在开头添加：
```typescript
if (!this.vss || !this.memoryManager) return false;
```
将 `vss!: VSS` 改为 `vss: VSS | null = null`，`memoryManager!: MemoryManager` 改为 `memoryManager: MemoryManager | null = null`。
检查所有直接访问 `this.vss.` 和 `this.memoryManager.` 的地方，添加 `?.` 或 null check。

### 5. Vault event handler null-safety
在 registerVaultEventDispatch 中，所有 handler 使用 optional chaining：
- `this.vss?.markDirtyIfEligible(file)`
- `this.memoryManager?.scheduleAutoFlush(...)`
- `this.memoryExtractionScheduler?.handleVaultEvent(...)`

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
特别注意：nullable 字段变更可能导致 tsc 报告 ~20+ 个类型错误。每个都需要加 null check 或 optional chaining。根据 tsc 输出逐一修复直到编译通过。
```

---

## SPEC-11: Vault Event 派发整合 + debounce

| 字段 | 值 |
|------|---|
| 对应 Step | 1.8 |
| 前置 | SPEC-10 |
| 分支 | `refactor/vault-event-dispatch` |
| 改动性质 | 提取方法 + debounce |
| 预估 | ~80 行 |

### Codex Prompt

```
你是一个 TypeScript 重构专家。整合 PluginManager 中的 vault event handler 并添加 debounced statusBar 更新。

## 任务

### 1. 在 `src/plugin.ts` 中添加 debounced statusBar
```typescript
private debouncedStatusBarUpdate = debounce(() => {
    void this.updateMemoryStatusBar();
}, 300, true);
```

### 2. 提取 `registerVaultEventDispatch()`
将 onload() 中散落的 6 个 `this.registerEvent(this.app.vault.on(...))` 和 `this.registerEvent(this.app.workspace.on(...))` 调用合并到一个私有方法中。

在每个 handler 内：
- 将 `await this.updateMemoryStatusBar()` 替换为 `this.debouncedStatusBarUpdate()`
- 确保所有子系统访问使用 optional chaining（SPEC-10 已处理）
- 不要遗漏 `memoryExtractionScheduler?.handleVaultEvent()` 转发

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
```

---

## SPEC-12: 拆分 pa-agent-runtime.ts

| 字段 | 值 |
|------|---|
| 对应 Step | 2.1 |
| 前置 | SPEC-07 |
| 分支 | `refactor/split-pa-agent-runtime` |
| 改动性质 | 文件拆分（移动代码 + barrel re-export） |
| 预估 | ~50 行新增（barrel），其余是移动 |

### Codex Prompt

```
你是一个 TypeScript 重构专家。将 src/ai-services/pa-agent-runtime.ts（~2365 行）拆分为 4 个文件。

## 任务

### 1. 提取 `src/ai-services/memory-search-tool.ts`
将 MemorySearchTool 类及其依赖的 helper 函数（normalizeSearchCandidates, expandByOneHop, flattenCandidateDocuments, parseRerankResponse 等）移到新文件。

### 2. 提取 `src/ai-services/pa-agent-stream-bridge.ts`
将 CanonicalToLegacyEventAdapter 等 stream/event adapter 相关类移到新文件。（注意：类名是 `CanonicalToLegacyEventAdapter`，不是 `PaStreamBridge`——后者不存在）

### 3. 提取 `src/ai-services/pa-agent-prompts.ts`
将所有 prompt 模板常量和 builder 函数移到新文件。

### 4. 更新 `src/ai-services/pa-agent-runtime.ts`
保留 PaAgentRuntime 核心类（~600 行）。在文件末尾添加 re-export：
```typescript
export { MemorySearchTool } from "./memory-search-tool";
export { CanonicalToLegacyEventAdapter } from "./pa-agent-stream-bridge";
// ... 其他需要保持兼容的导出
```

关键原则：外部 import 路径不变。所有从 `pa-agent-runtime` 导入的符号通过 barrel re-export 保持可用。

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
不应有任何测试需要修改 import 路径。
```

---

## SPEC-13: 拆分 vss.ts

| 字段 | 值 |
|------|---|
| 对应 Step | 2.2 |
| 前置 | SPEC-04 |
| 分支 | `refactor/split-vss` |
| 改动性质 | 文件拆分 |
| 预估 | ~30 行新增（barrel） |

### Codex Prompt

```
你是一个 TypeScript 重构专家。将 src/vss.ts（~2759 行）拆分为 4 个文件。

## 任务

### 1. 提取 `src/vss/vss-indexer.ts`
移入 rebuildLocalIndex / refreshLocalIndex 相关逻辑（~600 行）。

### 2. 提取 `src/vss/vss-reconciler.ts`
移入 reconcileLocalFiles / verifyPendingChanges 相关逻辑（~400 行）。

### 3. 提取 `src/vss/vss-maintenance.ts`
移入 dirty tracking / flush / legacy cleanup 逻辑（~400 行）。

### 4. 更新 `src/vss.ts`
保留 VSS 核心（init, search, dispose，~800 行）。
在文件末尾 re-export 保持外部 import 兼容。

src/vss/ 目录已有 types.ts, rrf.ts, sqlite-vector-index.ts 等模块，新文件与现有结构一致。

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
重点：所有 vss 相关测试通过。
```

---

## SPEC-14: 拆分 chat-view.ts

| 字段 | 值 |
|------|---|
| 对应 Step | 2.3 |
| 前置 | SPEC-08 |
| 分支 | `refactor/split-chat-view` |
| 改动性质 | 文件拆分（提取类） |
| 预估 | ~50 行新增（接口 + wiring） |

### Codex Prompt

```
你是一个 TypeScript 重构专家。从 src/chat/chat-view.ts（~3424 行）中提取两个独立类。

## 任务

### 1. 提取 `src/chat/MobileInputAdapter.ts`
提取所有移动端键盘和 tab bar 处理逻辑：
- 所有以 `keyboard` 和 `nativeKeyboard` 开头的字段（约 9 个）
- 所有以 `mobileTabBar` 开头的字段（约 4 个）
- 相关方法：setupMobileTabBarAutoHide, teardownMobileTabBarAutoHide, 以及所有 keyboard/viewport 事件处理方法

创建类：
```typescript
export class MobileInputAdapter {
    constructor(
        private readonly containerEl: HTMLElement,
        private readonly log: (msg: string, ...args: unknown[]) => void,
    ) {}
    setup(): void { /* 移入的初始化逻辑 */ }
    teardown(): void { /* 移入的清理逻辑 */ }
}
```

在 LLMView 中：`if (Platform.isMobile) { this.mobileAdapter = new MobileInputAdapter(this.containerEl, (...args) => this.host.log(...args)); }`

### 2. 提取 `src/chat/ConversationPersistence.ts`
提取会话持久化逻辑：
- 字段：activeConversationId, activeConversation, nextTurnIndex, persistedTurnIndexByEntry, persistChain
- 方法：switchActiveConversation, persistTurn, deleteTurn, loadConversation, createNewConversation（以及相关的 helper）

创建类：
```typescript
export class ConversationPersistence {
    constructor(
        private readonly getChatHistoryManager: () => ChatHistoryManager | undefined,
        private readonly log: (msg: string, ...args: unknown[]) => void,
    ) {}
    // ... 提取的方法
}
```

### 3. 更新 `src/chat/chat-view.ts`
LLMView 持有 `private mobileAdapter` 和 `private persistence` 实例，委托调用。

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
重点：`chat-view.test.ts` 通过。
```

---

## SPEC-15: PolicyEngine Tier Gate

| 字段 | 值 |
|------|---|
| 对应 Step | 3.1 + 3.2 |
| 前置 | SPEC-07 |
| 分支 | `feat/capability-tier-gate` |
| 改动性质 | 接口扩展 + gate 逻辑 |
| 预估 | ~55 行 |

### Codex Prompt

```
你是一个 TypeScript 开发者。为 PolicyEngine 添加 capability tier gate。

## 任务

### 1. 修改 `src/ai-services/capability-types.ts`
添加类型和字段：
```typescript
export type AgentCapabilityTier = "free" | "paid";
```
在 AgentCapability 接口中添加可选字段：`tier?: AgentCapabilityTier`（undefined 等同于 "free"）。

### 2. 修改 `src/ai-services/policy-engine.ts`
在 evaluate() 方法中添加 tier 检查（在现有检查之前）：
```typescript
const capabilityTier = capability.tier ?? "free";
if (capabilityTier === "paid" && this.licenseTier === "free") {
    return { allowed: false, reason: "premium-required" };
}
```
PolicyEngine 构造函数或 options 中接受 `licenseTier` 参数（默认 "free"）。

### 3. 修改 `src/ai-services/chat-tool-factories.ts`
为以下 tool 添加 `tier: "paid"`：
- Web Search tool
- Append / Write action tools
- Skills-related tools

其余 tools（Memory Search, Vault Search, Note Inspect）保持默认（free）。

### 4. 添加测试
在 `__tests__/policy-engine.test.ts` 中添加 tier gate 测试用例。

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
```

---

## SPEC-16: License Settings

| 字段 | 值 |
|------|---|
| 对应 Step | 3.3 |
| 前置 | SPEC-15 |
| 分支 | `feat/license-settings` |
| 改动性质 | Settings 字段 + PolicyEngine 传参 |
| 预估 | ~15 行 |

### Codex Prompt

```
你是一个 TypeScript 开发者。添加 license tier 到 settings 并传给 PolicyEngine。

## 任务

### 1. 修改 `src/settings.ts`
在 PluginManagerSettings 中添加：`licenseTier: AgentCapabilityTier`（默认 "free"）。
在 DEFAULT_SETTINGS 中添加默认值。

### 2. 修改 `src/plugin.ts`
在 createAiServiceHost() 中，将 `this.settings.licenseTier` 传给 PolicyEngine（通过 AiServiceHost 或直接在构造 runtime 时传递）。

## 验证
运行 `npx tsc -noEmit -skipLibCheck && npm test`。
```

---

## 执行 Checklist

| SPEC | Step | 依赖 | 可并行 | 人工验证 |
|------|------|------|--------|---------|
| 01 | 1.1 | Phase 0 | — | 否 |
| 02 | 1.2 | 01 | — | 否 |
| 03 | 1.3a | 01 | 与 02 并行 | 否 |
| 04 | 1.3b | 02+03 | — | **make deploy + Memory 冒烟** |
| 05 | 1.4a(接口) | 01 | 与 02/03 并行 | 否 |
| 06 | 1.4a(重接) | 04+05 | — | 否 |
| 07 | 1.4b+c | 06 | — | **make deploy + Chat 冒烟** |
| 08 | 1.5 | 04+06 | — | **make deploy + Chat 冒烟** |
| 09 | 1.6 | 无 | **可与 05-08 并行** | 否 |
| 10 | 1.7 | 04+06+08+09 | — | **make deploy + 冷启动冒烟** |
| 11 | 1.8 | 10 | — | 否 |
| 12 | 2.1 | 07 | 与 13/14 并行 | 否 |
| 13 | 2.2 | 04 | 与 12/14 并行 | 否 |
| 14 | 2.3 | 08 | 与 12/13 并行 | 否 |
| 15 | 3.1+3.2 | 07 | — | 否 |
| 16 | 3.3 | 15 | — | **make deploy + Tier 验证** |

### 预估总量

| 指标 | 值 |
|------|---|
| 总 SPEC 数 | 16 |
| 可并行组 | 3 组（02∥03∥05、09∥05-08、12∥13∥14） |
| 需人工验证的节点 | 5 个（SPEC-04, 07, 08, 10, 16） |
| 串行关键路径 | 01→02→04→06→07→08→10→11（8 步） |
| 预估总改动 | ~2,290 行 |
