# SDD: Settings UI Refactor

> Version: 1.0 | Date: 2026-05-29 | Status: Partially implemented; historical design record
> Upstream: [settings-ui-review.md](./settings-ui-review.md) — 30 issues (5 P0 + 13 P1 + 12 P2)

---

## Implementation Status (2026-05-30)

The high-risk Settings/Keychain and partial layout work from this SDD has been implemented, including API token migration cleanup, API Token edit/clear UX, provider confirmation, safer numeric parsing, metadata defaults/validation, fresh-install provider choice, Memory child-setting visibility, and scoped input alignment CSS.

The full Settings IA simplification and complete componentization are not done. Keep this file as a historical target design; use `docs/settings-ui-review.md` and `docs/v2-fix-plan.md` for current fixed/partial/open status.

---

## 1. Overview

### 1.1 Problem

设计时 Settings UI (`src/settings.ts`, 1013 行) 存在数据损坏路径、信息架构不合理、770 行单体 `display()` 方法、12 处全量重渲染等系统性问题。详见 [settings-ui-review.md](./settings-ui-review.md)。当前代码已经修复高风险数据和部分 UX 问题，但完整 IA/组件化简化仍未完成。

### 1.2 Scope

修复全部 30 项，分 6 个 Phase 实施，每个 Phase 独立可 revert。

### 1.3 Strategy

**先拆后修** — Phase 1 完成结构拆分和子容器架构，后续 Phase 在新结构上修复问题。

### 1.4 Non-Goals

- 不重写为 React-based Settings UI
- 不增加 `ai-utils.ts` 的 provider 抽象层（runtime `switch` on `'qwen' | 'openai'` 足够）
- 不增加 Settings 内搜索/过滤功能

---

## 2. Architecture

### 2.1 Current: Monolithic `display()`

```
display() {
    containerEl.empty();           // 销毁全部 DOM
    // ... 770 行内联 Setting 构建 ...
    // 12 处调用 this.display() 触发全量重渲染
}
```

问题：滚动丢失、焦点丢失、Picker 泄漏、每次 toggle 重建 ~47 个 Setting 实例。

### 2.2 Target: Section Methods + Sub-Containers

每个 section 抽为私有方法；需要条件渲染的 section 拥有独立 `HTMLDivElement` 子容器。Toggle 仅 `empty()` + 重建受影响的子容器。

```typescript
display() {
    containerEl.empty();
    this.renderAISection(containerEl);           // Provider + Token + URL + Models
    this.renderQwenOptionsSection(containerEl);  // 子容器：conditional on provider=qwen
    this.renderSkillsSection(containerEl);       // 子容器：master toggle 控制子 toggles
    this.renderMemorySection(containerEl);       // 子容器：memoryEnabled 控制子设置
    this.renderStatisticsSection(containerEl);
    this.renderRecordSection(containerEl);
    this.renderGraphSection(containerEl);        // 子容器：enableGraphColors 控制颜色列表
    this.renderMetadataSection(containerEl);     // 子容器：enableMetadataUpdating 控制
    this.renderFeaturedImageSection(containerEl);// 子容器：conditional on provider=qwen
    this.renderAdvancedSection(containerEl);     // Debug, Telemetry, Reset
}
```

### 2.3 Sub-Container Pattern

```typescript
// 实例字段
private qwenOptionsContainer: HTMLDivElement | null = null;

// 创建容器
private renderQwenOptionsSection(parentEl: HTMLElement): void {
    this.qwenOptionsContainer = parentEl.createDiv();
    this.rebuildQwenOptions();
}

// Toggle 时只重建子容器
private rebuildQwenOptions(): void {
    if (!this.qwenOptionsContainer) return;
    this.qwenOptionsContainer.empty();
    if (this.plugin.settings.aiProvider !== 'qwen') return;
    // ... 构建 Qwen-specific settings ...
}
```

### 2.4 Sub-Container Inventory

| 实例字段 | 重建触发条件 | 管控内容 |
|---------|------------|---------|
| `providerConfigContainer` | Provider dropdown 变更 | Base URL, model names, placeholders |
| `qwenOptionsContainer` | Provider 变更, Base URL 变更 | Thinking toggle, WebSearch toggle |
| `skillTogglesContainer` | "Use skill guides" master toggle | 7 个 skill toggles |
| `memorySubContainer` | "Use memory" toggle, "Advanced" toggle | 全部 Memory 子设置 |
| `graphColorsContainer` | "Enable Graph Colors" toggle, 颜色增删改 | Color group 列表 |
| `metadataContainer` | "Enable Metadata" toggle, metadata 增删 | Metadata 列表 + Add 表单 |
| `featuredImageContainer` | Provider 变更 | Featured image path + count |

### 2.5 Picker 生命周期管理

```typescript
private activePickers: Picker[] = [];

private rebuildGraphColors(): void {
    for (const picker of this.activePickers) picker.destroy();
    this.activePickers = [];
    this.graphColorsContainer?.empty();
    // ... 构建新 Picker, push to this.activePickers ...
}
```

### 2.6 Debounced Save

利用 Obsidian 已有 `debounce`（已在 `plugin.ts`, `preview.ts`, `stats-manager.ts` 中使用）：

```typescript
private debouncedSave = debounce(
    async () => { await this.plugin.saveSettings(); },
    400,
    true,
);

// SettingTab.hide() 时 flush
hide(): void {
    this.debouncedSave.cancel();
    this.plugin.saveSettings();
}
```

所有 `addText` 的 `onChange` 改用 `this.debouncedSave()`。Toggle / Dropdown 保持即时保存。

---

## 3. Phase 详细设计

### Phase 1: Structural Refactor

> 修复 #26 (display 拆分), #7 (全量重渲染), #22 (混用引用)
> 文件: `src/settings.ts`

**变更内容:**

1. 添加 7 个 `HTMLDivElement | null` 实例字段（见 2.4 Inventory）
2. 添加 1 个 `Picker[]` 字段管理生命周期
3. 拆 `display()` 为 ~10 个 `render*()` + ~7 个 `rebuild*()` 私有方法
4. 替换全部 12 处 `this.display()` 为对应的 `rebuild*()` 调用
5. 统一每个方法内使用 `const plugin = this.plugin;` 别名，消除混用

**方法签名:**

```typescript
private renderHeader(parentEl: HTMLElement): void
private renderAISection(parentEl: HTMLElement): void
private rebuildProviderConfig(): void
private renderQwenOptionsSection(parentEl: HTMLElement): void
private rebuildQwenOptions(): void
private renderSkillsSection(parentEl: HTMLElement): void
private rebuildSkillToggles(): void
private renderMemorySection(parentEl: HTMLElement): void
private rebuildMemorySubSettings(): void
private renderStatisticsSection(parentEl: HTMLElement): void
private renderRecordSection(parentEl: HTMLElement): void
private renderGraphSection(parentEl: HTMLElement): void
private rebuildGraphColors(): void
private renderMetadataSection(parentEl: HTMLElement): void
private rebuildMetadataList(): void
private renderFeaturedImageSection(parentEl: HTMLElement): void
private rebuildFeaturedImage(): void
private renderAdvancedSection(parentEl: HTMLElement): void
```

**不变的:** `PluginManagerSettings` interface, `data.json` 格式, `display()` public 签名。

**Exit Gate:** 现有 `settings.test.ts` 全部通过 + Obsidian 手动冒烟测试各 section 渲染正常。

---

### Phase 2: P0 Data Integrity

> 修复 #1, #2, #3, #4, #5
> 文件: `src/settings.ts`, `src/plugin.ts`, `src/utils.ts`

#### 2a. `safeParseInt` helper (#1)

新增到 `src/utils.ts`：

```typescript
export function safeParseInt(
    value: string,
    fallback: number,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
): number {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}
```

5 个调用点替换：

| 原行号 | 字段 | fallback | min | max |
|--------|------|----------|-----|-----|
| 282 | `previewLimits` | `DEFAULT_SETTINGS.previewLimits` (5) | 1 | — |
| 307 | `localGraph.depth` | `DEFAULT_SETTINGS.localGraph.depth` (2) | 1 | 10 |
| 381 | `resizeStyle.height` | default (500) | 100 | — |
| 390 | `resizeStyle.width` | default (550) | 100 | — |
| 994 | `numFeaturedImages` | default (2) | 1 | 10 |

对 `height` / `width` 输入追加 `inputEl.type = "number"` with `min` / `max` 属性。

#### 2b. Keychain 迁移失败清空 (#2)

`src/plugin.ts` `migrateSettings()` 解密失败分支：

```typescript
} else {
    new Notice("API token migration failed. Please re-enter your token in Settings.", 8000);
    this.settings.apiToken = "";  // 清空残留密文
    changed = true;
}
```

#### 2c. Metadata `t` 初始化 + 校验 (#3)

```typescript
let key = "";
let value = "";
let t = "string";  // 对应 dropdown 默认选项

// Dropdown 选项文案清理
dropDown.addOption('string', 'Regular string');
dropDown.addOption('moment', 'Formatted timestamp');

// Add 按钮增加校验
btn.onClick(async () => {
    if (!key.trim()) {
        new Notice("Metadata key is required.");
        return;
    }
    plugin.settings.metadatas.push({ key: key.trim(), value, t });
    await plugin.saveSettings();
    this.rebuildMetadataList();
});
```

#### 2d. `isEnabledMetadataUpdating` 提取为运行时字段 (#4)

1. 从 `PluginManagerSettings` interface 和 `DEFAULT_SETTINGS` 中删除 `isEnabledMetadataUpdating`
2. `PluginManager` 添加: `private _isMetadataUpdateActive = false;`
3. `plugin.ts` 的 `update-metadata` command 改读写 `this._isMetadataUpdateActive`
4. `migrateSettings()` 添加清理:
   ```typescript
   if ("isEnabledMetadataUpdating" in (this.settings as any)) {
       delete (this.settings as any).isEnabledMetadataUpdating;
       changed = true;
   }
   ```

#### 2e. `loadSettings()` 深合并 (#5)

替换 `plugin.ts` 的 `loadSettings()`：

```typescript
async loadSettings() {
    const loaded = (await this.loadData()) ?? {};
    this.settings = {
        ...DEFAULT_SETTINGS,
        ...loaded,
        localGraph: {
            ...DEFAULT_SETTINGS.localGraph,
            ...(loaded.localGraph ?? {}),
            resizeStyle: {
                ...DEFAULT_SETTINGS.localGraph.resizeStyle,
                ...(loaded.localGraph?.resizeStyle ?? {}),
            },
        },
    };
    // 数组字段防御：如果 loaded 中是非数组则回退默认
    for (const key of ['colorGroups', 'metadatas', 'metadataExcludePath',
                        'previewTags', 'vssCacheExcludePath', 'enabledSkillIds'] as const) {
        if (!Array.isArray(this.settings[key])) {
            (this.settings as any)[key] = [...(DEFAULT_SETTINGS as any)[key]];
        }
    }
}
```

设计考量：不用通用递归深合并，因为 `colorGroups` / `metadatas` 等数组是用户数据，应整体替换而非逐元素合并。只有 `localGraph` 及其 `resizeStyle` 是配置对象需要字段级合并。

---

### Phase 3: IA Reorder + Provider UX

> 修复 #6, #17, #10, #9, #8
> 文件: `src/settings.ts`, `src/plugin.ts`, `src/custom.css`, `src/ai-services/ai-utils.ts`(导入常量)

#### 3a. Section 重排 (#6)

调整 `display()` 中 `render*()` 调用顺序：

```
当前                              目标
─────────────────                ─────────────────
1. Header + Debug                1. Header (无 Debug)
2. Record                        2. AI Assistant (Provider+Token+URL+Models)
3. Local Graph                   3. Qwen Response Options (conditional)
4. Graph Colors                  4. Skills
5. Metadata                      5. Memory (+ conditional 子设置)
6. Statistics                    6. Statistics (+ 新增 2 toggles)
7. AI Assistant                  7. Record
8. Qwen Options                  8. Local Graph + Graph Colors (合并一节)
9. Telemetry (孤立)              9. Metadata
10. Skills                       10. Featured Image (conditional, 有标题)
11. API Token (分离)             11. Advanced (Debug + Telemetry + Reset)
12. Memory
13. Featured Image (无标题)
```

#### 3b. Provider 选择 UX 重设计 (#17, #10)

**Provider Presets 常量:**

```typescript
interface ProviderPreset {
    label: string;
    baseURL: string;
    chatModelName: string;
    embeddingModelName: string;
    description: string;
    runtimeProvider: "qwen" | "openai";
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
    qwen: {
        label: "Qwen (Alibaba Cloud DashScope)",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        chatModelName: "qwen-plus",
        embeddingModelName: "text-embedding-v4",
        description: "Qwen models via Alibaba Cloud. Also hosts DeepSeek, Kimi, GLM, and other models.",
        runtimeProvider: "qwen",
    },
    "qwen-intl": {
        label: "Qwen (DashScope International)",
        baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        chatModelName: "qwen-plus",
        embeddingModelName: "text-embedding-v4",
        description: "Qwen models via DashScope International endpoint.",
        runtimeProvider: "qwen",
    },
    openai: {
        label: "OpenAI",
        baseURL: "https://api.openai.com/v1",
        chatModelName: "gpt-4o-mini",
        embeddingModelName: "text-embedding-3-small",
        description: "OpenAI models via the official API.",
        runtimeProvider: "openai",
    },
    custom: {
        label: "Custom (OpenAI-compatible)",
        baseURL: "",
        chatModelName: "",
        embeddingModelName: "",
        description: "Any OpenAI-compatible API endpoint.",
        runtimeProvider: "qwen",
    },
};
```

**Runtime 映射:** `aiProvider` 持久化值仍为 `"qwen"` 或 `"openai"`，Provider UI 用 `baseURL` 推导当前显示的 preset：

```typescript
function deriveDisplayPreset(settings: PluginManagerSettings): string {
    if (settings.aiProvider === 'openai'
        && settings.baseURL === PROVIDER_PRESETS.openai.baseURL) return 'openai';
    if (settings.aiProvider === 'qwen') {
        if (settings.baseURL === PROVIDER_PRESETS.qwen.baseURL) return 'qwen';
        if (settings.baseURL === PROVIDER_PRESETS['qwen-intl'].baseURL) return 'qwen-intl';
    }
    return 'custom';
}
```

这样不需要新增 `data.json` 字段，不影响 `ai-utils.ts` 的 runtime switch。

**首次安装体验:**

- `DEFAULT_SETTINGS.aiProvider` 改为 `""`（空串）
- 空 provider 状态下：显示引导提示 + Provider dropdown（含 placeholder option "-- Choose your AI provider --"）
- Provider 未选择时，Token / URL / Model 字段隐藏，只显示 Provider 选择
- 已有 `data.json` 的老用户：`migrateSettings()` 中 `if (!this.settings.aiProvider)` 分支已会迁移到 `"qwen"`，不受影响

**新用户 vs 老用户区分:**

```typescript
async loadSettings() {
    const loaded = (await this.loadData()) ?? {};
    const isFreshInstall = Object.keys(loaded).length === 0;
    this.settings = { ...DEFAULT_SETTINGS, ...loaded, /* deep merge */ };
    if (isFreshInstall) {
        this.settings.aiProvider = "";  // 新安装强制选择
    }
}
```

**Provider Prompt CSS:**

```css
.pa-settings-provider-prompt {
    padding: 12px 16px;
    margin: 8px 0;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-secondary);
}
```

#### 3c. Provider 切换保护 (#9)

切换 Provider 时检查用户是否自定义了 Base URL / Model：

```typescript
dropDown.onChange(async (uiPreset) => {
    const preset = PROVIDER_PRESETS[uiPreset];
    const prev = PROVIDER_PRESETS[deriveDisplayPreset(plugin.settings)];

    const hasCustomURL = prev && plugin.settings.baseURL !== prev.baseURL;
    const hasCustomModel = prev && plugin.settings.chatModelName !== prev.chatModelName;

    if (hasCustomURL || hasCustomModel) {
        const confirmed = await confirmUserAction(this.app, {
            title: "Switch AI provider?",
            message: "Your custom Base URL and model name will be replaced with the new provider defaults.",
            confirmText: "Switch",
        });
        if (!confirmed) {
            dropDown.setValue(deriveDisplayPreset(plugin.settings));
            return;
        }
    }

    plugin.settings.aiProvider = preset.runtimeProvider;
    plugin.settings.baseURL = preset.baseURL;
    plugin.settings.chatModelName = preset.chatModelName;
    plugin.settings.embeddingModelName = preset.embeddingModelName;
    await plugin.saveSettings();
    this.rebuildProviderConfig();
    this.rebuildQwenOptions();
    this.rebuildFeaturedImage();
});
```

已有 `confirmUserAction` 可复用（`src/confirm.ts`）。

#### 3d. Token 清除支持 (#8)

```typescript
secret.onChange((value: string) => {
    if (value) {
        this.app.secretStorage.setSecret(KEYCHAIN_API_TOKEN_ID, value);
    } else {
        // Obsidian SecretStorage 无 removeSecret API → 设为空串等效清除
        this.app.secretStorage.setSecret(KEYCHAIN_API_TOKEN_ID, "");
    }
    this.plugin.clearTokenCache();
});
```

注：Obsidian mock 中 `secretStorage` 无 `removeSecret` 方法，用 `setSecret("", "")` 作为等效方案。`getAPIToken()` 已对空串返回空值处理。

---

### Phase 4: P1 UX Improvements

> 修复 #15, #12, #11, #14, #16, #13
> 文件: `src/settings.ts`

#### 4a. Text Input Debounce (#15)

```typescript
// SettingTab class 新增
private debouncedSave = debounce(
    async () => { await this.plugin.saveSettings(); },
    400,
    true,
);

hide(): void {
    this.debouncedSave.cancel();
    this.plugin.saveSettings();  // flush pending
}
```

所有 17 个 `addText` 的 `onChange` 中 `await this.plugin.saveSettings()` 替换为 `this.debouncedSave()`。

**不受影响的:** Toggle（`.onChange` 立即保存）, Dropdown（立即保存 + 可能触发 rebuild）。

#### 4b. Memory 子设置条件隐藏 (#12)

```typescript
private rebuildMemorySubSettings(): void {
    if (!this.memorySubContainer) return;
    this.memorySubContainer.empty();
    if (!this.plugin.settings.memoryEnabled) return;
    // ... 渲染 "Check memory before chat", "Advanced controls" 及其子设置
}
```

与 `enableGraphColors` / `enableMetadataUpdating` 行为一致。

#### 4c. "Check memory before chat" 文案修正 (#11)

```
Before: Name="Check memory before chat"
        Desc="The assistant will ask before preparing anything that may use AI credits."

After:  Name="Ask before using AI credits"
        Desc="The assistant will ask for your approval before preparing or updating Memory, which uses API calls."
```

#### 4d. Statistics 新增 2 个 toggle (#14)

在 `renderStatisticsSection()` 中 Animation toggle 之后添加：

```typescript
new Setting(container)
    .setName("Show section word counts")
    .setDesc("Display word counts for each section heading in the editor.")
    .addToggle(toggle => {
        toggle.setValue(plugin.settings.displaySectionCounts)
            .onChange(async value => {
                plugin.settings.displaySectionCounts = value;
                await plugin.saveSettings();
            });
    });

new Setting(container)
    .setName("Count comments in statistics")
    .setDesc("Include comments in word and character counts.")
    .addToggle(toggle => {
        toggle.setValue(plugin.settings.countComments)
            .onChange(async value => {
                plugin.settings.countComments = value;
                await plugin.saveSettings();
            });
    });
```

#### 4e. Metadata 表单优化 (#16)

- 修复 typo: `"only upport"` → `"only support"`
- Dropdown 选项去序号: `"Regular string"` / `"Formatted timestamp"`
- 空 key 校验（见 Phase 2c）
- 成功 Add 后清空表单输入

#### 4f. `vssCacheExcludePath` 默认值清理 (#13)

```typescript
// DEFAULT_SETTINGS
vssCacheExcludePath: [".obsidian"],   // 原: [".obsidian", "8.template", "9.src", ...]
featuredImagePath: "",                 // 原: "9.src"
```

只影响新安装。已有用户 `data.json` 保持不变（深合并保留用户值）。

---

### Phase 5: P2 Polish

> 修复 #19-#30
> 文件: `src/settings.ts`, `src/plugin.ts`, `src/utils.ts`, `src/custom.css`

#### 5a. Typos + 文案一致性 (#19)

| 位置 | Before | After |
|------|--------|-------|
| `DEFAULT_SETTINGS.localGraph.notice` | `"grah"` | `"graph"` |
| Metadata desc | `"only upport"` | `"only support"` (Phase 4e) |
| Featured Image desc | `"feautured"` | `"featured"` |
| Comment L246 | `"settiong"` | `"setting"` |
| AI section desc | `"AI Helper"` | `"AI Assistant"` |
| Telemetry desc | `"PA Agent"` | `"assistant"` |
| Advanced Memory | `"Memory model"` | `"Embedding model"` |

#### 5b. `saveSettings` 补 `await` (#20)

Debug toggle (L242) 和 Animation toggle (L650) 添加 `await`，callback 改为 `async`。

#### 5c. 删除死代码 (#21)

- 删除未使用的 `t` ("top") 和 `l` ("left") DocumentFragment（L366-375）
- 删除注释掉的 `.remove()` 调用（L461, L537）
- 删除 `// TODO: design better UX` 注释（Phase 4e 已解决）

#### 5d. `hexToRGB` 提取到模块级 (#23)

```typescript
function hexToRGB(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${r}, ${g}, ${b})`;
}
```

#### 5e. Exclude Path trim 统一 (#24)

Metadata exclude path (L595) 对齐 Memory exclude path 的处理：
```typescript
plugin.settings.metadataExcludePath = value.split(",").map(p => p.trim()).filter(Boolean);
```

#### 5f. 内联 style → CSS class (#25)

新增 `src/custom.css`：
```css
.pa-settings-section-desc {
    font-size: 14px;
    color: var(--text-muted);
    margin: 0;
}
```

替换所有 `setAttr("style", "font-size:14px")` / `"font-size:15px"` 为 `cls: "pa-settings-section-desc"`。

#### 5g. Featured Image 加 section header (#27)

```typescript
private renderFeaturedImageSection(parentEl: HTMLElement): void {
    this.featuredImageContainer = parentEl.createDiv();
    this.rebuildFeaturedImage();
}

private rebuildFeaturedImage(): void {
    this.featuredImageContainer?.empty();
    if (this.plugin.settings.aiProvider !== 'qwen') return;
    this.featuredImageContainer!.createEl('h3', { text: 'Featured Image' });
    // ... settings
}
```

#### 5h. `CryptoHelper` 延迟实例化 (#28)

```typescript
// Before (plugin.ts:104):
private cryptoHelper: CryptoHelper = new CryptoHelper();

// After: 在 migrateSettings() 内按需创建
private async migrateSettings(): Promise<void> {
    // ...
    const rawApiToken = this.settings.apiToken;
    if (rawApiToken && rawApiToken !== "sk-xxx") {
        const cryptoHelper = new CryptoHelper();
        const decrypted = await cryptoHelper.decryptFromBase64(rawApiToken, personalAssitant);
        // ...
    }
}
```

删除类级别的 `cryptoHelper` 字段。

#### 5i. `modelName` legacy 迁移 + 清理 (#29)

`migrateSettings()` 添加：
```typescript
const rawSettings = this.settings as any;
if (rawSettings.modelName && rawSettings.modelName !== "qwen-plus") {
    if (this.settings.chatModelName === "qwen-plus") {
        this.settings.chatModelName = rawSettings.modelName;
    }
    changed = true;
}
if ("modelName" in rawSettings) {
    delete rawSettings.modelName;
    changed = true;
}
```

从 `PluginManagerSettings` interface 和 `DEFAULT_SETTINGS` 中删除 `modelName`。

#### 5j. 全局 Reset (#30)

在 `renderAdvancedSection()` 中添加：

```typescript
new Setting(container)
    .setName("Reset all settings to defaults")
    .setDesc("Restore default values. Your API token in the OS keychain is not affected.")
    .addButton(button => {
        button.setButtonText("Reset").onClick(async () => {
            const confirmed = await confirmUserAction(this.app, {
                title: "Reset all settings?",
                message: "All settings will return to defaults. Your API token stored in the OS keychain will not be removed.",
                confirmText: "Reset",
            });
            if (!confirmed) return;
            // 保留 vault-specific 字段
            const { statisticsVaultId, statsPath } = plugin.settings;
            Object.assign(plugin.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
            plugin.settings.statisticsVaultId = statisticsVaultId;
            plugin.settings.statsPath = statsPath;
            await plugin.saveSettings();
            this.display();
        });
    });
```

---

### Phase 6: Test Coverage

> 修复 #18
> 文件: `__tests__/settings.test.ts`, `__tests__/keychain-migration.test.ts`

#### 6a. `safeParseInt` 测试

```typescript
describe('safeParseInt', () => {
    it('returns fallback for empty string');
    it('returns fallback for non-numeric string');
    it('clamps to min');
    it('clamps to max');
    it('parses valid integer with radix 10');
});
```

#### 6b. `loadSettings` 深合并测试

```typescript
describe('loadSettings deep merge', () => {
    it('preserves default localGraph sub-fields when user only sets depth');
    it('preserves resizeStyle defaults when localGraph has no resizeStyle');
    it('falls back to default array when colorGroups is not an array');
});
```

#### 6c. `migrateSettings` 端到端测试

测试真实 `PluginManager.migrateSettings()` 方法，而非 `keychain-migration.test.ts` 中的简化副本。

#### 6d. onChange handler mutation 测试

调用捕获的 `onChange` callback，验证 `plugin.settings` 被正确修改且 `saveSettings` 被调用。

#### 6e. `statisticsSyncEnabled` toggle 回滚测试

Mock `statsManager.setStatisticsSyncEnabled` 抛异常，验证 toggle 值和 setting 被回滚。

#### 6f. Token 迁移失败清空测试

Mock `decryptFromBase64` 返回 `null`，验证 `settings.apiToken` 被清空为 `""`。

---

## 4. Phase Dependencies

```
Phase 1 (结构拆分)
    │
    ├─── Phase 2 (P0 数据完整性)
    │        │
    │        └─── Phase 3 (IA 重排 + Provider UX)
    │                 │
    │                 └─── Phase 4 (P1 UX 改进)
    │                          │
    │                          └─── Phase 5 (P2 打磨)
    │
    └─── Phase 6 (测试覆盖) ←── depends on Phase 2 (safeParseInt)
                                    + Phase 3 (provider behavior)
```

**严格顺序:** 1 → 2 → 3 → 4 → 5, 6 可在 Phase 2 之后随时并行。

---

## 5. Verification Plan

| Phase | 自动化 | 手动冒烟 |
|-------|--------|---------|
| 1 | `npm test`, `npm run build` | 各 section 渲染正常，toggle 不跳顶部，Picker 选色后不全量 reload |
| 2 | 新增 safeParseInt + 深合并测试 | 输入 "abc" 到数字字段 → 回退默认值；data.json 手动删 localGraph 子字段 → 重启后恢复默认 |
| 3 | `npm test` | 全新安装看到 Provider 选择引导；切换 Provider 自定义 model 弹确认框；清空 Token 有效 |
| 4 | `npm test` | Base URL 输入不逐字符保存（检查 data.json mtime）；关闭 Memory 后子设置消失 |
| 5 | `npm run lint`, `npm run build`, `git diff --check` | grep 确认 typo 已修；无内联 font-size |
| 6 | `npm test -- --runInBand` | 6 个新测试全部通过 |

---

## 6. Rollback Strategy

每 Phase 独立 commit，revert 单个 Phase 不影响其他 Phase 的改动（Phase 间有依赖方向但无交叉修改）。

- **Phase 1 revert:** 恢复 monolith display()。
- **Phase 2 revert:** 重新引入 NaN 和浅合并风险。`isEnabledMetadataUpdating` 删除是 forward-compatible。
- **Phase 3 revert:** 恢复 hardcoded qwen default。migration 中 `if (!aiProvider)` 已处理空值。
- **Phase 4/5 revert:** 恢复 typos 和逐字符保存。无功能影响。
- **Phase 6 revert:** 仅删除测试。无 runtime 影响。

---

## 7. Effort Estimate

| Phase | 预估工作量 |
|-------|-----------|
| Phase 1 | 1-2 天 |
| Phase 2 | 0.5-1 天 |
| Phase 3 | 1-2 天 |
| Phase 4 | 0.5-1 天 |
| Phase 5 | 0.5 天 |
| Phase 6 | 0.5 天 |
| **Total** | **4-7 天** |

---

## Appendix: Critical Files

| 文件 | 修改范围 | Phase |
|------|---------|-------|
| `src/settings.ts` | 主重构目标 | 1-5 |
| `src/plugin.ts` | migration, loadSettings, isEnabledMetadataUpdating | 2, 3, 5 |
| `src/utils.ts` | safeParseInt, CryptoHelper 清理 | 2, 5 |
| `src/custom.css` | .pa-settings-section-desc, .pa-settings-provider-prompt | 3, 5 |
| `__tests__/settings.test.ts` | 新增测试 | 6 |
| `__tests__/keychain-migration.test.ts` | 新增测试 | 6 |
| `src/confirm.ts` | 复用 confirmUserAction（不修改） | — |
| `src/ai-services/ai-utils.ts` | 导入常量（不修改 runtime switch） | — |
