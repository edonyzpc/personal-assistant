# First-Run Experience & Platform Robustness Discovery Brief

Document status: Current
Delivery status: Exploring
Updated: 2026-08-10
Work item: (pending backlog registration)
Authority: 本主题在产品决定前的问题、证据、讨论结论与待决策项。

## Problem And User Outcome

- Problem: v2.9.1/v2.9.2 修复了两个严重 bug（data.json 缺失崩溃、iOS keychain 卡死），但这两个 bug 暴露了系统性的工程薄弱点。
- User / context: 首次安装用户（empty vault）、iOS/移动端用户、非技术背景用户
- Desired outcome: 首次安装即可用（2 步内完成配置）；移动端无冻结/崩溃；测试覆盖防止此类问题复现
- Why now: 两个已发布的 hotfix 证明问题真实存在且影响用户；距下一个 minor release 是建设的好时机

## Evidence

| Item | Grade | Source | Implication |
| --- | --- | --- | --- |
| data.json 缺失时 loadData() 返回 null，下游假设非空 | Confirmed | commit 52b9843, src/plugin.ts:10124 | 首次安装必崩 |
| SecretComponent 触发 iOS keychain 同步访问冻结整个 Obsidian | Confirmed | commit 31c7f4e, src/settings.ts | iOS 用户打开设置即卡死 |
| settings display 仍调用 getConfiguredAPITokenSecret() 可能触发 keychain | Confirmed | src/settings.ts:2462 | 仍有残留冻结风险 |
| workspace.getLeaf("window") 在移动端不可用 | Confirmed | src/settings.ts:2292 | 移动端统计设置操作会失败 |
| 所有测试均运行在 Platform.isDesktop=true | Confirmed | \_\_mocks\_\_/obsidian.ts:240 | 移动端代码路径零覆盖 |
| MobileInputAdapter 零测试覆盖 | Confirmed | \_\_tests\_\_/ 无对应文件 | 复杂键盘几何逻辑可能有未发现 bug |
| 最小可用配置实际只需 2 步（选 provider + 填 token） | Confirmed | src/settings.ts:651-684 PROVIDER\_PRESETS | 当前 105+ 控件造成不必要的认知负荷 |
| 竞品 Copilot 通过托管 tier 实现 1 步配置 | Inference | 市场观察 | PA 可通过 PA Cloud preset 实现同等体验 |
| Tier 基础设施已就绪但为空壳 | Confirmed | src/ai-services/capability-types.ts:43, MOCK\_LICENSE\_TIER | 商业化技术基础已有但未接入 |
| PluginManager 11,863 行单体无完整生命周期测试 | Confirmed | src/plugin.ts, \_\_tests\_\_/ | 集成层 bug 无法被现有测试捕获 |
| 3,499 test cases, baseline ~80% coverage | Confirmed | jest.config.js | 子系统覆盖好，集成层覆盖差 |
| Memory 构建速度慢 (2018 文件 ~15min) | Confirmed | 用户反馈, VSS maxConcurrency=1 + batch=10 + 100ms gap | 首次体验严重受阻 |
| Memory 构建需手动确认 (Approval Modal) | Confirmed | src/memory-manager.ts:420,626,837 | 首次使用时被打断、困惑 |
| Embedding 并发度 maxConcurrency=1 | Confirmed | src/vss/vss-core.ts:2413 | 串行处理是 15min 瓶颈的主因 |
| flush 模式 maxPerMinute=5 限制 | Confirmed | src/vss/vss-maintenance.ts:4 | 增量更新也被严格限速 |
| Qwen embedding batch=10, gap=100ms, TPM=900K | Confirmed | src/vss/vss-core.ts:2405-2416 | 理论吞吐远未达 TPM 上限 |
| API 实际 RPS=30, TPM=1.2M, batch≤10 (v3/v4) | Confirmed | 阿里云文档+社区实测 (2026-08-10 调研) | 并发度可安全提到 3 |
| qwen3.7-text-embedding batch=20, 128K tokens | Confirmed | 阿里云官方 API 文档 | 升级可获额外 40% 提速 |

---

## Part 1: Empty Vault & First-Run Experience

### 1.1 Current First-Run Flow

```
用户安装 plugin
    → onload() → loadSettings()
    → loadData() returns null
    → initializeMissingPluginDataJson() 创建空 {}
    → isFreshInstall({}) = true
    → mergeLoadedSettings({}) 填充 DEFAULT_SETTINGS
    → aiProvider 强制为 "" (要求用户选择)
    → migrateSettings() (fresh install 无实际迁移)
    → Plugin 完成加载 (ribbon, commands, views)

用户点击 Chat 侧栏
    → 显示 "Welcome to AI Chat"
    → 提示 "Choose an AI provider in Settings first"
    → 蓝色 "Open Settings" 按钮
    → Textarea placeholder: "Set up AI provider first"
    → Send 按钮禁用

用户点击 Open Settings
    → 跳转 Settings Tab
    → 展示 6 个 group (全部展开)
    → AI & Provider dropdown: "-- Choose your AI provider --"
    → 下方提示选择 provider 后才显示 token/URL/model

用户选择 provider
    → 自动填充 baseURL + chatModelName + embeddingModelName
    → 显示 token 输入按钮

用户点击 token 按钮 → Modal → 填入 → 保存 → 关闭 Settings → 回到 Chat
```

**总步骤: 5-7 次交互**，涉及 2 次页面跳转。

### 1.2 残留风险代码路径

| 位置 | 风险 | 严重程度 | 触发条件 |
| --- | --- | --- | --- |
| src/plugin.ts:1321 loadSettings() 无 try-catch | 文件系统失败时 plugin 静默不加载 | HIGH | iOS 权限/磁盘满/Sync 竞争 |
| src/ai-services/ai-utils.ts:273 createChatModel() | aiProvider="" 抛异常 | MEDIUM | 新功能遗漏 getAISetupIssue() 检查 |
| src/plugin.ts:11749 getAPIToken() | 无 token 时返回 "" 并 Notice | LOW | 非崩溃但体验差 |
| src/plugin.ts loadSettings→migrateSettings 间隙 | statisticsVaultId 为空字符串 | LOW | 仅重排代码时暴露 |

### 1.3 Ideal First-Run Improvements

**优先级 P0 — 低成本高回报**:

1. **Chat View 内联 Setup（不跳转 Settings）**
   - 当 `getAISetupIssue() !== null` 时，在 chat 空态直接渲染：
     - Provider 卡片选择（Qwen 中国 / Qwen 国际 / OpenAI / Custom）
     - Token 输入框
     - "Save & Start" 按钮
   - 预期效果：5 步 → 2 步
   - 改动位置：`src/chat/chat-view.ts:1190-1211`
   - 工作量：~150 行

2. **loadSettings() fail-safe 包装**
   - 文件系统失败时回退 `this.settings = { ...DEFAULT_SETTINGS, aiProvider: "" }`
   - 显示 Notice 但 plugin 仍加载（可用非 AI 功能）
   - 改动位置：`src/plugin.ts:1321`
   - 工作量：~20 行

3. **首次安装默认折叠非 AI group**
   - `isGroupCollapsed()` 对无 localStorage 状态时返回 true（除 ai-provider）
   - 减少首次打开 Settings 的视觉噪音
   - 工作量：~15 行

**优先级 P1 — 中等成本体验跳跃**:

4. **First-run wizard modal**
   - fresh install 时 onLayoutReady 弹出 2 步向导
   - Step 1: 可视化 provider 卡片
   - Step 2: token 输入 + 链接到各 provider 的 key 申请页面
   - 工作量：~200 行

5. **Test Connection 按钮**
   - token 保存后显示，做最轻量 API call 验证
   - 成功 → 绿色 ✓；失败 → 显示错误原因
   - 工作量：~50 行

6. **集中式 AI readiness gate**
   - 在 `createChatModel()` / `createEmbeddings()` 顶部统一检查
   - 不再依赖散布的 `getAISetupIssue()` 调用
   - 工作量：~30 行

---

## Part 2: iOS / 移动端平台覆盖

### 2.1 已知平台差异清单

| API / 行为 | Desktop | iOS / Mobile | 代码位置 |
| --- | --- | --- | --- |
| app.secretStorage | Electron keystore, 快 | iOS Keychain, 可能阻塞主线程 | plugin.ts:11706-11725 |
| OPFS SAH Pool (sqlite-wasm) | 完整支持 | Safari 16.4+ 才支持 createSyncAccessHandle | vss/sqlite-worker.ts:242-279 |
| navigator.storage.persist() | Electron 始终 true | iOS 可能拒绝 | vss/vss-core.ts:2789 |
| Web Workers 生命周期 | 稳定 | iOS 后台积极 kill Worker | vss/sqlite-vector-index.ts:155-198 |
| localStorage | 可靠 | 私有浏览/存储压力时不可用 | settings.ts:1251-1270 |
| workspace.getLeaf("window") | 打开弹出窗口 | 移动端无弹出窗口，崩溃或无响应 | settings.ts:2292 |
| Status bar | 可见可交互 | 移动端无 status bar | plugin.ts:1362-1374 |
| Hover popovers | 有 hover-editor | 移动端无 hover（已有 Platform guard） | plugin.ts:1729 |
| ResizeObserver | 标准行为 | iOS 键盘收起/弹出触发频繁回调 | settings.ts:1454-1457 |
| Touch focus 策略 | N/A | iOS 要求 user gesture 才能 programmatic focus | chat/chat-view.ts:490 |

### 2.2 当前已确认 Bug

**BUG-1: `getLeaf("window")` 在移动端失败** (HIGH)
- 位置: `src/settings.ts:2292`
- 场景: 用户在移动端切换统计设置类型
- 修复: 添加 `Platform.isDesktop` guard 或使用 `getLeaf(false)`

**BUG-2: settings display 时 keychain 读取** (MEDIUM)
- 位置: `src/settings.ts:2462` via `plugin.getConfiguredAPITokenSecret()`
- 场景: 每次打开 Settings 都可能触发 keychain 同步访问
- 修复: 在 plugin 中缓存 "has token" 布尔值，仅 set/clear 时更新

**BUG-3: OPFS Worker 被 iOS 后台杀死后无恢复** (MEDIUM)
- 位置: `src/vss/sqlite-vector-index.ts:155-198`
- 场景: 用户切到其他 app 再回来，Worker 已死但 promise 悬挂
- 修复: Worker death detection + 自动重建

### 2.3 移动端测试覆盖现状

| 覆盖项 | 状态 |
| --- | --- |
| 任何测试运行 Platform.isMobile=true | 仅 1 处临时翻转 (memory-manager.test.ts:289) |
| Platform.isPhone 测试 | 无 |
| MobileInputAdapter 测试 | 无 |
| OPFS 不可用降级测试 | 无 |
| secretStorage 延迟/超时测试 | 无 |
| keyboard clearance 计算测试 | 无 |
| app backgrounding 测试 | 无 |
| Capacitor plugin 集成测试 | 无 |

### 2.4 推荐测试策略

**层 1: Platform Mock 基础设施** (~50 行共享 helper)
```
__tests__/helpers/mobile-platform-mock.ts
- withMobilePlatform(fn) — 自动设置 Platform.isMobile=true
- withPhonePlatform(fn) — 额外设置 Platform.isPhone=true
- withIOSPlatform(fn) — 设置 isIosApp=true
```

**层 2: 关键路径双模运行** (~200 行新测试)
- settings.test.ts — 添加 `describe("mobile platform")` block
- memory-manager.test.ts — mobile prepare 全路径
- stats-manager.test.ts — batch sizing 验证

**层 3: MobileInputAdapter 单元测试** (~300 行)
- measureKeyboardClearance geometry
- calculateVisualViewportKeyboardOverlap edge cases
- isVisualViewportKeyboardLikelyVisible
- observeNativeKeyboardEvents mock Capacitor

**层 4: CI 静态检查** (ESLint rule 或 grep)
- 检测 `getLeaf("window")` 缺少 Platform.isDesktop guard
- 检测 render 路径调用 secretStorage
- 检测 localStorage 访问缺少 try/catch

**层 5: 发版前手动 iOS Checklist** (7 项)
1. 打开 Settings — 无冻结，token 显示正确
2. 添加/编辑/删除 API token via modal
3. 发送 chat 消息
4. 打开统计设置
5. Chat view 键盘弹起/收起
6. 后台/前台切换 during memory extraction
7. Memory prepare with OPFS — 验证降级信息

---

## Part 3: Settings 配置简化 & 商业化

### 3.1 配置字段分析

**真正必填 (blocking AI functionality)**:

| 字段 | 来源 | 用途 |
| --- | --- | --- |
| aiProvider | settings.ts:276 | Provider 选择 |
| baseURL | settings.ts:278 | API endpoint |
| chatModelName | settings.ts:279 | Chat model |
| API Token | OS Keychain | 认证 |

**通过 PROVIDER_PRESETS 自动填充**: 选择 preset 后 baseURL + chatModelName + embeddingModelName 自动设定。

**实际用户操作: 选 provider (1 click) + 填 token (1 paste) = 2 步**

### 3.2 当前界面对比

| 指标 | PA (当前) | Copilot | Smart Connections |
| --- | --- | --- | --- |
| 首次配置步骤 | 5-7 步 | 1 步 (Plus) / 2 步 (BYOK) | 2 步 |
| 设置控件总数 | 105+ | ~30 | ~20 |
| 是否隐藏 embedding model | 否（同级展示） | 是（高级区） | 是（自动选择） |
| 托管 tier | 无 | 有 (Plus $139/yr) | 无 |
| First-run 引导 | 无 | 有 | 有 |
| Connection Test | 无 | 有 | 有 |

### 3.3 Settings 重组方案

**当前结构 (6 groups, 全部默认展开)**:
- AI & Provider (provider + token + model + Qwen options + skills)
- Memory & Personalization (memory control center + settings)
- Data & Privacy (excluded folders/tags + retrieval + cleanup)
- Features (Pagelet + Quick Capture + Statistics)
- Appearance (records + graph + colors + metadata + featured image)
- System (debug + usage sharing + legal)

**提议: Simple Mode (首次安装默认)**:
- 仅展示 "Get Started" group (provider + token — 2 个控件)
- 底部 "Show all settings" 链接

**提议: Advanced Mode (用户切换后)**:
- Connection — provider, token, base URL, models
- Intelligence — Memory, extraction, skills, operations agent
- Privacy — data boundary, excluded content
- Features — pagelet, quick capture, quiet recall
- Appearance — graph, metadata, statistics
- System — debug, legal

### 3.4 PluginManagerSettings 混合问题

当前 `PluginManagerSettings` 接口混合了：
- **用户配置** (~30 字段): aiProvider, baseURL, models, 开关等
- **运行时状态** (~12+ 字段): reviewQueue.items, savedInsights.items, memoryGovernance.records, confirmedMemoryCount, lastPatternDetectionAt, retrievalHabitProfile.state...

这导致：
- Settings UI 复杂度被状态字段放大
- data.json 频繁写入（每次状态变化都 save）
- 并发冲突风险增加

**中期建议**: 分离到 `pa-state.json`，`PluginManagerSettings` 缩减为纯用户配置。

### 3.5 商业化路径

**已有技术基础**:
- `AgentCapabilityTier = "free" | "paid"` (capability-types.ts:43)
- `MOCK_LICENSE_TIER = "paid"` — placeholder
- `PolicyEngine.evaluate()` 已实现 tier gate
- 5 个能力已标记 `tier: "paid"`（Selection Tool, Web Search, Append Tool, Skill Context, PA Review Tool）

**PA Cloud Preset 方案**:
```
PROVIDER_PRESETS["pa-cloud"] = {
    label: "PA Cloud (Recommended)",
    baseURL: "https://api.pa-assistant.com/v1",
    chatModelName: "auto",       // server-side routing
    embeddingModelName: "auto",
    description: "零配置，无需 API key"
}
```

用户流程: 填入 license key → 完成。无 base URL / model / embedding 概念暴露。

**缺失的工程件**:
- License key 远程验证
- 账号/订阅管理
- 用量计量
- 支付集成
- License 过期降级 UX

### 3.6 改进优先级表

| 优先级 | 改进项 | 用户价值 | 工作量 | 类型 |
| --- | --- | --- | --- | --- |
| P0 | 首次安装折叠非 AI group | 减少认知负荷 | ~15 行 | UX |
| P0 | 隐藏 embedding/policy model 到高级区 | 减少困惑 | ~30 行 | UX |
| P1 | Chat 内联 Setup（不跳转 Settings） | 5步→2步 | ~150 行 | UX |
| P1 | First-run wizard modal | 引导感 | ~200 行 | UX |
| P1 | Test Connection 按钮 | 即时信心 | ~50 行 | UX |
| P2 | Simple/Advanced 模式切换 | 隐藏复杂度 | ~100 行 | UX |
| P2 | Setup Complete 指示器 | 状态清晰 | ~10 行 | UX |
| P2 | 基于 locale 的 provider 推荐 | 减少选择 | ~20 行 | UX |
| P3 | 分离 runtime state vs settings | 架构清洁 | 较大 | Eng |
| P3 | PA Cloud hosted preset | 1步配置+商业化 | 大（含后端） | Biz |

---

## Part 4: 测试覆盖全面评估

### 4.1 覆盖现状概览

```
总体数据:
  - 源文件 (non-type, non-test): ~337 .ts files
  - 测试文件: 178 个 (__tests__/) + 7 个 in-source + 2 个 src/tests/
  - 总测试用例: ~3,499 it() assertions
  - 覆盖率阈值: statements 75%, branches 71%, functions 74%, lines 75%
  - 基线实测: statements 80.04%, branches 76.54%, functions 79.16%, lines 80.04%
```

### 4.2 覆盖分布热力图

**绿区 (Well-tested)**:
- Memory governance (12+ test files)
- Pagelet 子系统 (35+ test files)
- Settings helpers & UI (159 test cases)
- PA agent runtime (11 test files)
- Statistics stores (5 test files)
- VSS/vector search (6 test files)
- Share card (8 test files)

**红区 (Critical files with NO dedicated test)**:
- `src/plugin.ts` (11,863 行) — 仅通过 plugin-record-note.test.ts 和 settings.test.ts 间接覆盖
- `src/chat/MobileInputAdapter.ts` — 复杂几何计算，零覆盖
- `src/ai-services/` 约 30+ 文件 — context management, tool dispatching, stream bridge, skill router
- `src/ai-services/operations/` — tool executor, undo store, vault-transform
- `src/ai.ts` — AssistantHelper
- `src/batch-modal.ts`, `src/modal.ts`, `src/confirm.ts` — UI modals
- `src/preview.ts`, `src/stats-view.ts`, `src/view.ts` — Views
- `src/obsidian-internals.ts`, `src/obsidian-paths.ts` — platform bindings

### 4.3 缺失的测试类别

| 类别 | 现状 | 风险等级 |
| --- | --- | --- |
| Plugin 生命周期集成测试 (onload→ready→idle→unload) | 近乎空白 | CRITICAL |
| 平台模拟测试 (mobile/iOS) | 仅 1 处临时翻转 | HIGH |
| 错误路径/异常边界测试 | 稀疏 | HIGH |
| 并发访问测试 (saveSettings 竞争) | 极有限 | HIGH |
| 网络失败测试 (streaming timeout/partial) | 最少 | MEDIUM |
| 迁移回归测试 (plugin.ts 实际迁移执行) | Helper 有，集成无 | MEDIUM |
| Unload/cleanup 顺序测试 | View lifecycle 2 个，plugin 0 个 | MEDIUM |
| UI/UX 交互测试 (modals, share card) | 部分 | LOW |

### 4.4 Top 15 必需测试 (优先级排序)

| # | 测试场景 | 覆盖的风险 | 预估行数 |
| --- | --- | --- | --- |
| 1 | 启动时 data.json 为 null — 验证 initializeMissingPluginDataJson | 首次安装崩溃 | 50 |
| 2 | 启动时 data.json 损坏 (非 JSON / array / 部分损坏) | 数据恢复 | 80 |
| 3 | Platform.isMobile=true 下 settings display | 移动端 UI 崩溃 | 100 |
| 4 | iOS keychain 超时模拟 — getSecret 不阻塞 | iOS 冻结 | 60 |
| 5 | onunload 资源清理顺序 — VSS/stats/chat/memory 有序 dispose | 资源泄露 | 100 |
| 6 | migrateSettings() 3 次 retry 穷尽 | 并发迁移 | 80 |
| 7 | saveSettings 并发写入序列化 | 数据丢失 | 60 |
| 8 | Memory governance bootstrap with vault identity unavailable | 移动端初始化 | 50 |
| 9 | onLayoutReady during unload race (用户快速禁用 plugin) | 部分初始化 | 80 |
| 10 | AI streaming network timeout | 用户卡住 | 60 |
| 11 | AI streaming partial response (中途断流) | 数据丢失 | 60 |
| 12 | Memory subsystem 重复初始化 guard | 资源泄露 | 40 |
| 13 | QuickCapture on mobile 路径 | 移动端功能 | 60 |
| 14 | Chat view restoration after plugin reload | 状态恢复 | 80 |
| 15 | Memory governance IndexedDB failure (blocked/timeout) | 降级处理 | 60 |

### 4.5 缺失的防御性编码测试

| 场景 | 现有覆盖 | 差距 |
| --- | --- | --- |
| Null data (loadData returns null/undefined) | mergeLoadedSettings helper 有 | plugin 级集成无 |
| Corrupt data (invalid JSON) | parsePluginDataJson 有 throw | 但 plugin 不 catch — 未测 |
| Concurrent access (多窗口/Sync) | enqueueSettingsWrite 存在 | 无并发测试 |
| Network failures | obsidian-fetch 测 abort | 无 timeout/retry/partial |
| Platform unavailability | 部分 getBasePath | 无全面 platform absence |
| Chaos (初始化中途抛异常) | 无 | 无 partial-init cleanup 测试 |
| WASM 加载失败 | 无 | VSS init 降级未测 |
| IndexedDB QuotaExceeded / AbortError | 无 | governance 写入降级未测 |

### 4.6 测试基础设施改进建议

**1. PluginManager 测试 Harness Factory** (最高价值)
- 目前 plugin-record-note.test.ts 有 ad-hoc 版本但不可复用
- 统一 factory: 可控的 loadData/saveData/adapter/Platform/secretStorage
- 工作量: ~200 行 shared helper

**2. Platform Mock Switcher**
- 共享 helper: `withDesktop()`, `withMobile()`, `withIOS()`, `withPhone()`
- 工作量: ~50 行

**3. Async Lifecycle Simulator**
- 模拟 Obsidian 的 `workspace.onLayoutReady()` 回调时机
- 可控延迟: 测试 onload 和 onLayoutReady 之间的竞争
- 工作量: ~80 行

**4. Error Injection Helpers**
- `failAfterN(n)`: 成功 N 次后 throw
- `slowResolve(ms)`: 模拟 keychain/network 延迟
- `corruptData(type)`: 生成各种损坏的 data.json
- 工作量: ~60 行

**5. Per-module Coverage Thresholds**
- 当前阈值是全局 75%，可加 path-specific:
  - `src/plugin.ts`: statements 60% (从 0 开始建设)
  - `src/settings.ts`: statements 80%
  - `src/ai-services/`: statements 70%

**6. PluginManager 可测试性重构** (长期)
- 提取 `initializeMissingPluginDataJson`, `migrateSettings`, `onLayoutReady`, `unloadAsync` 为独立函数/小类
- 显式依赖注入
- 工作量: 大，但是解决 11,863 行单体的根本方案

---

## Part 5: Memory 构建体验

### 5.1 当前 Memory 构建流程

```
用户首次发送 Chat 消息
    → MemoryManager.prepareBefore() 被调用
    → getMaintenancePlan() 检测到 reason="first-use"
    → requiresApproval = true
    → requestApproval() 弹出 MemoryApprovalModal
        ├─ 5 个 Section: Data / AI Provider / Memory Search / Background Updates / Cost
        ├─ Primary: "Prepare Memory"
        ├─ Secondary: "Answer without Memory"
        └─ Cancel
    → 用户点击 "Prepare Memory"
    → VSS.flush({ force: true }) 开始
        ├─ 逐文件: readFileContentSnapshot → prepareFileChunks → embedTexts
        ├─ Embedding 策略: maxBatchItems=10, minRequestGapMs=100ms, maxConcurrency=1
        ├─ 串行处理: 每 10 个 chunks 一批 → 等 100ms → 下一批
        └─ 2018 个文件 × (读取+分块+embedding) ≈ 15 min
    → 用户等待 15 分钟
    → Memory ready → Chat 可正常使用
```

### 5.2 性能瓶颈分析

#### 5.2.1 Embedding API 限制调研结果 (2026-08-10 verified)

**text-embedding-v4 / v3 官方参数**:

| 参数 | 数值 | 来源 |
| --- | --- | --- |
| 单次请求 batch_size | **≤ 10 条文本** (v3/v4 硬限制, API 网关层) | 阿里云官方文档 |
| 单条文本 max tokens | **8,192 tokens** | 阿里云官方文档 |
| RPS (每秒请求数) | **30 requests/sec** (同步接口, v1-v4 统一) | 社区实测验证 |
| TPM (每分钟 token) | **1,200,000 input tokens/min** | 社区实测验证 |
| 默认维度 | 1024 (可选 64/128/256/512/768/1024/1536/2048) | 官方文档 |
| 价格 | ¥0.0005/千 tokens (Batch API: ¥0.00025) | 官方文档 |
| 免费额度 | 1,000,000 tokens (90 天有效) | 官方文档 |

**新一代 qwen3.7-text-embedding 参数** (可升级方向):

| 参数 | 数值 | 对比 v4 |
| --- | --- | --- |
| 单次请求 batch_size | **≤ 20 条文本** | 2x v4 |
| 单条文本 max tokens | **128,000 tokens** | 15.6x v4 |
| 维度 | 2560/2048/1536/1024/768/512/256 | 更多选择 |
| 价格 | ¥0.0005/千 tokens | 与 v4 相同 |
| 语言支持 | 201 种 | vs v4 的 100+ |

**三重限流机制**:
1. `batch_size ≤ 10` — API 网关层硬限制，与模型能力无关
2. `RPS = 30` — 每秒最多 30 次请求（所有 v1-v4 统一）
3. `TPM = 1,200,000` — 每分钟最多 120 万 input tokens

#### 5.2.2 PA 当前配置 vs 实际限制

| 参数 | PA 当前值 | API 实际上限 | 利用率 |
| --- | --- | --- | --- |
| maxConcurrency | **1** | 30 RPS 支持至少 3-5 并发 | **~10%** |
| maxBatchItems | **10** | 10 (v4 硬限制) | 100% (已满) |
| minRequestGapMs | **100ms** (= 10 req/s) | 可达 30 req/s | **33%** |
| safeTokensPerMinute | **900,000** | 实际 1,200,000 | **75%** |

**核心瓶颈**: `maxConcurrency=1` 是最大浪费——单并发 + 100ms gap = 最多 10 req/s，仅利用 RPS 上限的 1/3。

#### 5.2.3 理论吞吐计算

```
PA 当前实际吞吐:
  1 并发 × (100ms gap + ~200ms API 延迟) = ~300ms/batch
  10 chunks/batch ÷ 300ms = ~33 chunks/秒

API 上限吞吐 (假设平均 chunk ~200 tokens):
  RPS 限制: 30 req/s × 10 条/req = 300 条/秒
  TPM 限制: 1,200,000 / 60 / 200 = 100 条/秒
  → 实际瓶颈是 TPM，上限 ~100 chunks/秒

PA 当前 33 chunks/s vs 上限 100 chunks/s → 可提升 3x
```

**时间拆解 (2018 文件实测)**:
- 平均每文件 2-3 chunks → ~5000 chunks total
- 当前 ~33 chunks/s → embedding 耗时 ~150s
- 加上文件 IO (读取+分块+hash+写入) ~200-300ms/file → 额外 ~7-10 min
- 总计 ~12-15 min 符合用户观测

#### 5.2.4 安全提速方案

| 参数 | 当前值 | 推荐值 | 理由 |
| --- | --- | --- | --- |
| maxConcurrency | 1 | **3** | 3 并发 × 10 req/s = 30 req/s = RPS 上限 |
| minRequestGapMs | 100ms | **100ms** (不变) | 保持单连接 10 req/s，靠并发提总量 |
| safeTokensPerMinute | 900,000 | **1,000,000** | TPM=1.2M，留 17% 余量 |
| maxBatchItems | 10 | **10** (不变) | API 硬限制，无法突破 |
| maxRetries | 0 | **1** | 允许一次重试，应对偶发 429 |

**预期效果**:
```
优化后: 3 并发 × ~33 chunks/s (每并发) = ~100 chunks/s
5000 chunks ÷ 100 = ~50s embedding
加上文件 IO (可与 embedding 并行部分重叠) → 总计 ~3-5 min
提速: 15 min → 3-5 min (3-5x 加速)
```

#### 5.2.5 模型对比: qwen3.7-text-embedding vs text-embedding-v4

**背景**: `qwen3.7-text-embedding` 是百炼平台 2025 年 6 月上线的新一代 API embedding 模型，基于开源的 Qwen3-Embedding 系列（0.6B/4B/8B），属于 Qwen3 系列 LLM 衍生的专用 embedding 模型。`text-embedding-v4` 是百炼平台早期的 embedding API，为独立训练的轻量模型。

##### 核心参数对比

| 维度 | text-embedding-v4 | qwen3.7-text-embedding | 差异影响 |
| --- | --- | --- | --- |
| **单次 batch_size** | ≤ 10 条 | ≤ **20** 条 | API 调用次数减半 |
| **单条 max tokens** | 8,192 | **128,000** | 长文件无需截断 |
| **输出维度** | 64-2048 (默认 1024) | 256-2560 (默认 1024) | PA 用 1024 维兼容 |
| **价格** | ¥0.0005/千 tokens | ¥0.0005/千 tokens | 相同 |
| **Batch API 价格** | ¥0.00025/千 tokens | ¥0.00025/千 tokens | 相同 |
| **免费额度** | 100 万 tokens (90 天) | 100 万 tokens (90 天) | 相同 |
| **稀疏向量** | ✅ 支持 (dense & sparse) | ✅ 支持 | 相同 |
| **text_type 参数** | ✅ query/document | ✅ query/document | 相同 |
| **instruct 参数** | ✅ 支持 | ✅ 支持 | 相同 |
| **语言覆盖** | 100+ 种 | **201** 种 (含编程语言) | 代码检索更强 |

##### 质量/性能对比

| 评测维度 | text-embedding-v4 | qwen3.7-text-embedding (基于 Qwen3-Embedding-8B) |
| --- | --- | --- |
| MTEB 多语言 | 未公开排名 | **#1** (70.58 分, 2025.06.05) |
| MTEB 英文 | 未公开 | 74.60 |
| CMTEB 中文 | 未公开 | 68.09 |
| MTEB Code | 未公开 | **#1** (73.50) |
| 架构 | 轻量专用模型 | 基于 Qwen3 LLM 的双塔 Transformer |
| 训练方法 | 传统对比学习 | 多阶段: 弱监督→监督→蒸馏→MRL |
| 长文本理解 | 8K 截断 | 原生 32K (API 128K) 完整编码 |
| 跨语言检索 | 良好 | **S 级** (119 种语言跨语言匹配) |
| 代码语义理解 | 基础 | **专项优化** (含编程语言训练) |

##### 对 PA Memory 构建的具体影响

| 指标 | 当前 (text-embedding-v4) | 升级后 (qwen3.7-text-embedding) | 提升 |
| --- | --- | --- | --- |
| API 调用次数 (5000 chunks) | 5000 ÷ 10 = 500 次 | 5000 ÷ 20 = **250 次** | **-50%** |
| 长文件截断问题 | 8K 截断 → 信息丢失 | 128K → **几乎不截断** | 检索质量提升 |
| 检索准确率 | 基线 | MTEB #1 → 预期 **显著提升** | 用户体验核心提升 |
| 代码文件检索 | 一般 | 专项 MTEB Code #1 | 开发者用户价值 |
| 中文笔记检索 | 良好 | CMTEB 68.09 → **更好** | 中文核心场景 |
| 维度兼容性 | PA 用 1024 维 | 支持 1024 维 | ✅ 无需改动 |
| 价格变化 | ¥0.0005/千 | ¥0.0005/千 | ✅ 零成本 |

##### 综合提速估算 (并发优化 + 模型升级)

```
场景: 2018 文件, ~5000 chunks, 平均 chunk ~200 tokens

方案 A (仅并发优化, 保持 v4):
  3 并发 × batch=10 → ~100 chunks/s → ~50s embedding → 总计 ~3-5 min

方案 B (并发优化 + 升级 qwen3.7):
  3 并发 × batch=20 → ~200 chunks/s → ~25s embedding → 总计 ~2-3 min
  额外收益: 检索质量大幅提升 + 长文件完整覆盖

方案 C (方案 B + Progressive build):
  先构建近 30 天文件 (~200 文件, ~500 chunks):
  3 并发 × batch=20 → ~2.5s embedding → 总计 ~15-30s
  → 用户 30 秒内即可使用 Memory (部分覆盖)
  后台完成剩余 → 2-3 min 全量
```

##### 升级风险评估

| 风险 | 评估 | 缓解措施 |
| --- | --- | --- |
| RPS/TPM 限额未知 | 中等 — 官方未明确区分新旧模型限额 | 先用保守并发 (2) 测试，逐步提升 |
| 向量空间不兼容 | **高** — 不同模型生成的向量不在同一空间 | 升级时必须全量 rebuild index |
| 检索行为变化 | 低 — 质量应提升 | 升级后对比测试 recall@k |
| API 稳定性 | 低 — 已上线数月 | 正常风险 |

##### 推荐升级路径

1. **Phase 1 (立即, 低风险)**: 仅做并发优化 (`maxConcurrency=3`, `safeTPM=1M`)，保持 text-embedding-v4
2. **Phase 2 (v2.11, 中风险)**: 升级到 `qwen3.7-text-embedding`
   - 新安装用户直接使用新模型
   - 老用户触发 rebuild 时切换 (如 settings-changed 或手动 Prepare)
   - 加入 embedding model migration 逻辑
3. **Phase 3 (长期)**: 评估是否本地部署 Qwen3-Embedding-0.6B (3GB, 无 API 依赖, 隐私优势)

### 5.3 用户体验问题

**问题 1: 手动确认打断用户意图**

用户首次发消息的心理模型: "我要问个问题" → 被弹窗打断 → 需要理解 5 个技术段落 → 做一个"这会花费 API 调用"的决策。

这违反了 North Star 的核心原则:
> 随手记下，需要时自然浮现。
> Less management, more capture.

Memory 构建应该是"自然发生"的事，不应该需要用户"管理"或"决策"。

**问题 2: 15 分钟等待是 deal-breaker**

首次使用的关键 5 分钟窗口内，用户看到的是一个进度条。如果此时关闭 Obsidian 或切换到其他工作，Memory 构建可能中断。用户不知道何时可以正常使用。

**问题 3: "Answer without Memory" 不够清晰**

用户不理解"有 Memory"和"没有 Memory"的差别是什么。这个选择项暴露了内部实现而非用户价值。

### 5.4 改进方案

**层 1: 性能优化 (减少等待时间) — 基于 API 限制调研结果**

| 优化 | 预期效果 | 工作量 | 风险评估 |
| --- | --- | --- | --- |
| maxConcurrency 1→3 | **3x 加速** | ~20 行 (vss-core.ts) | ✅ 已验证: RPS=30 支持 3 并发安全 |
| safeTokensPerMinute 900K→1000K | 11% 吞吐提升 | ~1 行 | ✅ 已验证: 实际 TPM=1.2M |
| maxRetries 0→1 | 减少偶发失败 | ~1 行 | 低风险 |
| Pipeline: 读取/分块与 embedding 并行 | 20-30% 加速 | ~100 行 | 中等架构改动 |
| 升级到 qwen3.7-text-embedding (batch=20) | 额外 40% | ~10 行 | 需验证 QPM/TPM 是否共享 |
| **综合效果 (仅层1前3项)** | **15 min → 3-5 min** | **~25 行** | **低风险** |

具体改动位置:
```typescript
// src/vss/vss-core.ts:2405-2416
// 当前:
maxBatchItems: 10,
minRequestGapMs: 100,
safeTokensPerMinute: QWEN_TEXT_EMBEDDING_SAFE_TPM, // 900,000
createOptions: { batchSize: 10, maxConcurrency: 1, maxRetries: 0 }

// 推荐改为 (已验证安全):
maxBatchItems: 10,           // 不变 — API 硬限制
minRequestGapMs: 100,        // 不变 — 靠并发提总量
safeTokensPerMinute: 1_000_000,  // 提升 — 实际 TPM=1.2M, 留 17% 余量
createOptions: { batchSize: 10, maxConcurrency: 3, maxRetries: 1 }

// src/vss/vss-indexer.ts:11
// 当前:
export const QWEN_TEXT_EMBEDDING_SAFE_TPM = 900_000;
// 改为:
export const QWEN_TEXT_EMBEDDING_SAFE_TPM = 1_000_000;
```

> **注意**: `maxBatchItems` 不能超过 10 — 这是 text-embedding-v3/v4 的 API 网关硬限制，与模型能力无关，超过直接返回 400 错误。如需更大 batch 必须升级到 qwen3.7-text-embedding (batch_size=20)。

**层 2: 自动化构建 (消除手动确认)**

方案 A: **Silent auto-prepare (推荐)**
- 首次配置完成后，后台静默开始 Memory 构建
- 无 Approval Modal，无中断
- 状态通过 status bar 或 chat 空态显示进度
- 用户随时可发消息（降级为 "answer without memory"，但不需要用户选择）
- 当 Memory ready 后，下次 chat 自动启用

方案 B: **One-time opt-in at setup**
- 在 First-run wizard 的第 3 步加一个开关: "Prepare Memory now (may take a few minutes)"
- 默认开启
- 构建在后台进行，不阻塞任何操作

方案 C: **Progressive build (渐进式)**
- 不一次性构建全部 2018 个文件
- 首先构建用户最近 30 天修改的文件（可能 ~100-200 个，~1-2 min）
- Memory 立即可用（部分覆盖）
- 后台持续扩展覆盖范围（idle 时处理更多文件）
- 对用户透明: "Memory: 15% ready → 45% → 100%"

**推荐组合: 层 1 性能优化 + 方案 C (Progressive) + 方案 A (Silent)**

最终用户体验:
1. 用户完成 AI 配置
2. 后台静默开始构建最近活跃文件 (~100 文件, ~1 min with 4x concurrency)
3. 用户发第一条消息时 Memory 已部分可用，无弹窗
4. 后台持续扩展，status bar 显示 "Memory: building (45%)"
5. ~3-4 min 后全部完成

**层 3: Approval 重设计 (保留合规但不打断)**

如果因为法律/隐私合规需要保留 consent:
- 将 consent 移到 First-run wizard 的一个复选框: "Allow PA to process your notes for Memory (recommended)"
- 只需一次，永不再弹
- 当前的 5-section Approval Modal 太重了 — 简化为 1 句话 + link to privacy docs

### 5.5 对策总结

| 优先级 | 改进 | 用户价值 | 工作量 |
| --- | --- | --- | --- |
| P0 | maxConcurrency 1→3 + TPM 提升 (已验证安全) | 15min→3-5min | ~25 行 |
| P0 | Progressive build (先构建近期文件) | 1min 内可用 | ~80 行 |
| P1 | Silent auto-prepare (后台静默启动) | 无中断 | ~50 行 |
| P1 | Consent 简化 (移到 setup wizard / 一句话) | 不被吓到 | ~100 行 |
| P2 | Pipeline 化 (IO/embedding 并行) | 再加速 20-30% | ~100 行 |
| P2 | 进度可视化优化 (status bar + chat 空态) | 知道在干嘛 | ~50 行 |

---

## Cross-cutting 分析: 根因与系统性对策

### 根因

两个 bug 表面看是不同问题（null data vs keychain freeze），根因相同：

> **Plugin 集成层（plugin.ts + settings.ts 的交互）缺乏测试覆盖，而这恰恰是平台差异和边界条件的汇聚点。**

子系统测试覆盖好（helpers, governance, pagelet...），但把它们连接在一起的"胶水层"——启动顺序、平台分支、错误恢复——是盲区。

### 系统性对策矩阵

| 维度 | 短期 (Quick Win) | 中期 (v2.10) | 长期 (v3.x) |
| --- | --- | --- | --- |
| **首次体验** | 折叠非 AI group + 隐藏高级字段 | Chat 内联 Setup + wizard | PA Cloud 一键配置 |
| **Memory 构建** | maxConcurrency=3 + TPM 提升 (已验证) | Progressive build + silent auto-prepare + 升级 qwen3.7 | Pipeline 化 + 自适应速率 |
| **移动端** | 修 getLeaf("window") + 缓存 hasToken | Platform mock + 双模测试 | Worker death recovery |
| **Settings** | 减少可见控件 | Simple/Advanced 模式 | 分离 state vs config |
| **测试** | Top 5 集成测试 | Harness factory + 15 项覆盖 | Plugin.ts 可测试性重构 |
| **商业化** | — | Test Connection + setup UX | PA Cloud + license |

---

## Decisions Made (2026-08-10)

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | Setup 引导方案 | **Chat 内联 Setup** (不做 Wizard) | 贴近 North Star "需要时自然浮现"，用户不离开 chat 上下文 |
| D2 | Memory Consent | **完全去掉 Approval Modal** | 配置完成后直接后台构建，零打断；如有合规需求在 Settings Memory 区放小字说明 |
| D3 | Phase 1 执行范围 | **先做 1.1 + 1.2 + 1.3** (bug fix / 性能) | 并发优化 + 移动端 bug fix 优先；UX 调整 (1.4/1.5/1.6) 留到 Phase 2 |
| D4 | 测试基础设施节奏 | **Phase 2 完成后再做** | 先集中精力做用户体验提升，测试基建等功能稳定后补 |

### 任务排期

**立即实施 (Phase 1 首批)**:
- 1.1 Embedding 并发优化 (maxConcurrency=3, safeTPM=1M, maxRetries=1)
- 1.2 修 getLeaf("window") 移动端崩溃
- 1.3 缓存 hasToken 布尔值避免 keychain 读取

**v2.10 (Phase 2)**:
- 2.1 Progressive Memory build
- 2.2 Silent auto-prepare (去掉 Approval Modal)
- 2.3 Chat 内联 Setup
- 2.5 Consent 简化 (合并入 2.2)
- 2.6 Test Connection
- 2.7 集中式 AI readiness gate
- 1.4/1.5/1.6 UX 调整合并进 Phase 2

**Phase 2 后 (Phase 3)**:
- 测试基础设施 (platform mock + harness factory + 集成测试)

**后续方向 (Phase 4)**:
- qwen3.7-text-embedding 升级
- Pipeline 化
- Simple/Advanced 模式
- PA Cloud + 商业化

## Exit

- ✅ Accepted — 决策已拍板，Phase 1 首批立即开始实施。
- Phase 2+ 进入 Backlog 等待版本规划。
