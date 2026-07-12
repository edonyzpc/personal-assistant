# Settings UI Review — Product & Frontend Delivery Checklist (v2)

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

> Reviewer: Claude | Date: 2026-05-29 | Base: master @ `676e38b` (含 SecretStorage 迁移)
> Scope: `src/settings.ts` (1013 lines), `src/plugin.ts` (migration), `__tests__/settings.test.ts`

---

## Executive Summary

Settings 界面承载了 9 大功能模块的约 48 个控件（含动态列表），是插件交付质量的关键触点。最新 master 已将 API Token 迁移至 OS Keychain（SecretStorage），修复了旧版 double-encryption 问题。但迁移后仍遗留安全细节未闭环，同时信息架构、输入处理、渲染模式等方面存在系统性问题。

| 严重度 | 数量 | 涵盖类型 |
|--------|------|----------|
| P0 — 必须修复 | 5 | 数据损坏、迁移遗留、bug |
| P1 — 强烈建议 | 13 | IA、UX 阻断、文案、产品默认值、测试覆盖 |
| P2 — 建议改进 | 12 | 体验打磨、一致性、可维护性 |

---

## 2026-05-30 Code-Led Status Addendum

This review is historical. The current branch has addressed the highest-risk Settings/Keychain items and part of the IA/layout work. Status below is based on the current code, not the original line numbers.

| Original finding | Current status | Evidence / remaining work |
| --- | --- | --- |
| P0-1 `parseInt` writes `NaN` | Fixed | `safeParseInt()` is used for numeric settings, with bounds for preview limit, local graph depth/dimensions, and featured image count. |
| P0-2 Keychain migration leaves token in `data.json` | Fixed | `migrateSettings()` deletes `settings.apiToken` on successful migration, failed decrypt, placeholder/default value, and empty legacy field. |
| P0-3 Metadata add form uninitialized values | Fixed | Add form initializes `key`, `value`, and `t`, validates non-empty key, and resets visible fields after save. |
| P0-4 Persisted `isEnabledMetadataUpdating` | Fixed | Runtime flag is removed from persisted settings and stripped during migration. |
| P0-5 Shallow settings merge | Fixed | `mergeLoadedSettings()` deep-merges `localGraph.resizeStyle` and normalizes array/dynamic-list fields. |
| P1-6 IA grouping | Partially fixed | AI Provider/API Token/Base URL/models are grouped near the top; Debug/Advanced and the rest of the long settings surface still need a broader IA pass. |
| P1-7 Full `display()` rerender | Partially fixed | Provider, Qwen options, Memory, Metadata, and Featured Image sections now have scoped rebuild paths. A full settings componentization pass remains future work. |
| P1-8 Token cannot be cleared | Fixed | Clearing the API token requires confirmation, clears scoped and legacy secret ids, and clears the in-memory token cache. |
| P1-9 Provider switch silently overwrites custom values | Fixed | Provider changes show a confirmation and explain preset replacement/API token behavior. |
| P1-10 OpenAI default model stale | Fixed | OpenAI preset and chat model placeholder use `gpt-4o-mini`. |
| P1-11 Memory approval copy mismatch | Fixed | The setting is now `Ask before using AI credits` with matching description. |
| P1-12 Memory child settings visible while off | Fixed | Memory sub-settings render only when `memoryEnabled` is true. |
| P1-13 Private default paths | Fixed | `featuredImagePath` defaults to empty string; `vssCacheExcludePath` defaults to `.obsidian`; Featured Image placeholder no longer uses the original developer's `9.src` path. |
| P1-14 Statistics hidden settings | Still open | `displaySectionCounts` and `countComments` remain non-UI fields. |
| P1-15 Text input save churn | Partially fixed | Several text inputs now use debounced saves, but not every setting path has been audited end-to-end. |
| P1-16 Metadata form UX | Partially fixed | Data safety and dropdown labels are improved; full narrow-screen UX redesign remains open. |
| P1-17 First-run provider choice | Fixed | Fresh installs clear `aiProvider` after loading defaults so users must choose a provider. |
| P1-18 Settings tests | Partially fixed | New tests cover parse safety, merge defaults, provider confirmation, API token clear/migration, and layout CSS. Broader interaction coverage remains useful. |
| P2-19 Settings copy typos | Partially fixed | The default Local Graph notice and Featured Image settings copy have been cleaned up; a broader copy pass is still useful. |
| P2-29 Legacy `modelName` field | Fixed | `modelName` has been removed from default settings and is deleted during migration after preserving a non-default legacy value in `chatModelName`. |

API Token now uses a dedicated Add secret-style editor for edits from Settings. Native SecretComponent picker CSS is still scoped as a mitigation for long secret rows, but generic keychain-picker reveal behavior on real iPhone should remain a manual smoke item if that picker is used outside the API Token editor.

---

## P0 — Must Fix

### 1. `parseInt` 无校验导致 NaN 写入（5 处）

**位置:** `settings.ts:282, 307, 381, 390, 994`

```typescript
plugin.settings.previewLimits = parseInt(value);   // 282
plugin.settings.localGraph.depth = parseInt(value); // 307
```

用户清空输入或键入字母时，`parseInt` 返回 `NaN`，直接持久化到 `data.json`（JSON 序列化为 `null`）。下游代码无 NaN 防御，导致：
- Local Graph 视图崩溃（NaN 尺寸）
- 预览功能 / Featured Image 生成异常
- 5 处均未传 radix 参数（虽然实际等效 base-10，但属编码规范问题）

**修复:** 统一 helper + 控件升级：
```typescript
function safeParseInt(value: string, fallback: number, min = 0): number {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= min ? n : fallback;
}
```
同时对 `previewLimits` / `depth` / `numFeaturedImages` 使用 `addSlider`，对 `height` / `width` 使用 `inputEl.type = "number"` with min/max。

---

### 2. Keychain 迁移失败后加密 token 残留 `data.json`

**位置:** `plugin.ts:1075-1087`

```typescript
const decrypted = await this.cryptoHelper.decryptFromBase64(rawApiToken, personalAssitant);
if (decrypted) {
    // 迁移成功 → 清空
    this.settings.apiToken = "";
} else {
    new Notice("API token migration failed...");
    // ⚠️ 未清空 this.settings.apiToken → 密文永久残留 data.json
}
```

如果解密失败（密钥变化、数据损坏），加密后的 base64 blob 永久留在 `data.json`。每次启动都会重新尝试解密并弹 Notice，形成无限循环。更严重的是：如果该值恰好是用户手动粘贴的明文 token，它将永久以明文形式留在磁盘。

**修复:** 解密失败后也应清空：
```typescript
} else {
    new Notice("API token migration failed. Please re-enter your token in Settings.", 8000);
    this.settings.apiToken = ""; // 清空残留
    changed = true;
}
```

---

### 3. Metadata 新增表单 `t` 变量未初始化

**位置:** `settings.ts:554-588`

```typescript
let key: string;
let value: any;
let t: string;  // ← 未赋初始值
// Dropdown 默认选中 "1 Regular String"，但 onChange 未触发 → t 为 undefined
this.plugin.settings.metadatas.push({ key: key, value: value, t: t });
```

用户点击 "Add" 但未手动改变 dropdown 时，`t` 为 `undefined`。`key` 和 `value` 同理可为 `undefined`。持久化后，依赖 `t` 做 `"moment"` / `"string"` 判断的 frontmatter 格式化逻辑会拿到 `undefined`。

**修复:** 初始化默认值 + 空值校验：
```typescript
let key = "";
let value = "";
let t = "string";
// Add 按钮 onClick 中添加: if (!key.trim()) { new Notice("Key is required"); return; }
```

---

### 4. `enableMetadataUpdating` vs `isEnabledMetadataUpdating` 双字段歧义

**位置:** `settings.ts:44, 47` | `plugin.ts:263-286`

```typescript
enableMetadataUpdating: boolean;      // Settings UI 控制的"功能开关"
isEnabledMetadataUpdating: boolean;   // Command palette 运行时状态
```

两者都被持久化到 `data.json`，但 `isEnabledMetadataUpdating` 是运行时状态（命令是否激活）。用户在 Settings 中关闭 `enableMetadataUpdating` 后，`isEnabledMetadataUpdating` 仍为 `true` 残留在磁盘。重启后 runtime 不会重新 arm，但持久化值与实际状态不一致，后续逻辑可能读错字段。

**修复:** 将 `isEnabledMetadataUpdating` 改为 `PluginManager` 实例的私有字段，不纳入 `PluginManagerSettings`。

---

### 5. `loadSettings()` 浅合并丢失嵌套对象默认值

**位置:** `plugin.ts:452`

```typescript
this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
```

`Object.assign` 是浅合并。如果用户 `data.json` 中只有 `localGraph: { depth: 3 }`（缺少 `showTags`, `resizeStyle` 等），整个 `localGraph` 对象被覆盖，丢失所有其他子字段的默认值。同理影响 `colorGroups`、`metadatas` 等嵌套结构。

**修复:** 对嵌套对象做深合并，至少在 `migrateSettings` 中补：
```typescript
this.settings.localGraph = { ...DEFAULT_SETTINGS.localGraph, ...this.settings.localGraph };
this.settings.localGraph.resizeStyle = { ...DEFAULT_SETTINGS.localGraph.resizeStyle, ...this.settings.localGraph.resizeStyle };
```

---

## P1 — Strong Recommendations

### 6. 信息架构（IA）混乱：48 项控件平铺无层级

**现状渲染顺序 vs 用户优先级:**

```
当前顺序                              建议顺序
──────────────────────────            ──────────────────────────
1. Header + Debug ← 开发者项          1. AI Assistant (Provider+Token+URL+Models)
2. Record (3项)                       2. Qwen Response Options
3. Hover Local Graph (8项+resize)     3. Skills
4. Graph Colors (动态列表)             4. Memory
5. Metadata Management (动态列表)      5. Vault Statistics
6. Vault Statistics (3项)             6. Record
7. AI Assistant (Provider+URL+Models) 7. Local Graph + Graph Colors (合并)
8. Qwen Options (条件 2项)            8. Metadata Management
9. Telemetry (孤立 1项)               9. Featured Image
10. Skill Guides (1+7项)             10. Advanced/Debug (折叠)
11. API Token (1项) ← 与Provider分离
12. Memory (3+条件7项)
13. Featured Image (条件2项，无标题)
```

**核心问题:**
- AI Chat 是插件主打功能（README 首屏），但 API Token 排在第 30+ 个控件位置
- Token 与 Provider/URL/Model 被 12 个 Skill toggle 隔开
- Debug 占据页面第一个位置
- "Share anonymous capability usage" 是孤立 toggle，无 section 归属
- 无折叠 / 导航 / 搜索机制

---

### 7. `this.display()` 全量重渲染（12 处触发）

**位置:** `settings.ts:404, 452, 469, 479, 489, 510, 544, 586, 683, 794, 851, 877`

每次触发 `containerEl.empty()` → 重建全部 DOM：
- **滚动位置丢失** — 在页面底部开启 "Advanced memory controls" 后弹回顶部
- **输入焦点丢失** — 正在编辑的文本框被销毁
- **Picker 泄漏** — `vanilla-picker` 在 `colorGroups.forEach` 循环内每次 render 创建 N 个实例（line 438），**从未调用 `destroy()`**，`containerEl.empty()` 删除子 DOM 但 Picker 内部事件监听和 popup 引用可能泄漏
- 最常见的用户操作（改颜色、加 metadata、切 provider）全部触发全量重渲染

**修复:** 对条件区块使用子容器，toggle 时只 empty/rebuild 子容器。保存并恢复 `containerEl.scrollTop`。

---

### 8. Token 无法通过 UI 清除/移除

**位置:** `settings.ts:820-836`

```typescript
secret.onChange((value: string) => {
    if (value) {  // ← 只处理非空
        this.app.secretStorage.setSecret(KEYCHAIN_API_TOKEN_ID, value);
    }
});
```

用户无法通过 Settings UI 清空已保存的 token。清空输入框不触发 `setSecret`，旧 token 永久留在 Keychain。缺少 "Remove API Token" 操作。

**修复:** 处理空值情况：
```typescript
if (value) {
    this.app.secretStorage.setSecret(KEYCHAIN_API_TOKEN_ID, value);
} else {
    this.app.secretStorage.removeSecret(KEYCHAIN_API_TOKEN_ID);
}
this.plugin.clearTokenCache();
```

---

### 9. Provider 切换静默覆盖用户自定义配置

**位置:** `settings.ts:669-684`

从 Qwen 切到 OpenAI 再切回 Qwen，用户手动设置的 `chatModelName: "qwen-max"` 被强制重置为 `qwen-plus`，无任何提示。`baseURL`、`embeddingModelName` 同理。

**修复:** 只在目标字段等于"另一个 provider 的默认值"或为空时覆盖；否则弹 `confirmUserAction` 询问。

---

### 10. OpenAI 默认 model `gpt-3.5-turbo` 已过时

**位置:** `settings.ts:679`, placeholder `settings.ts:706`

OpenAI 已推荐 `gpt-4o-mini` 替代 `gpt-3.5-turbo`。对面向开发者的工具，使用停更模型降低专业感。

**修复:** 默认值和 placeholder 改为 `gpt-4o-mini`。

---

### 11. "Check memory before chat" 名称与描述不匹配

**位置:** `settings.ts:855-861`

名称说"检查 memory"，描述说"花费 AI credits 前询问"——两个不同概念。用户无法判断实际行为。

**修复:** 统一语义，如：
- Name: "Ask before using AI credits"
- Desc: "The assistant will ask for your approval before preparing or updating Memory, which uses API calls."

---

### 12. Memory 子设置在 Memory 关闭时仍显示

**位置:** `settings.ts:855-973`

`memoryEnabled` 关闭后 `this.display()` 重渲染，但 "Check memory before chat"、"Advanced memory controls" 及其子设置**始终渲染**。已有先例：`enableGraphColors` 和 `enableMetadataUpdating` 关闭后隐藏子设置——Memory 应一致。

**修复:** 将 `settings.ts:855-973` 包裹在 `if (plugin.settings.memoryEnabled) { ... }` 中。

---

### 13. `vssCacheExcludePath` 默认值包含开发者私人路径

**位置:** `settings.ts:153`

```typescript
vssCacheExcludePath: [".obsidian", "8.template", "9.src", "a.subjects", "b.notion"]
```

`8.template`、`9.src`、`a.subjects`、`b.notion` 是开发者个人 vault 的文件夹命名规则，对其他用户毫无意义。同理 `featuredImagePath: "9.src"`（line 151）。

**修复:** 默认 `[".obsidian"]`。`featuredImagePath` 默认 `"attachments"` 或空串。

---

### 14. `displaySectionCounts` 和 `countComments` 无 UI 但在代码中使用

**位置:** `settings.ts:54-55`（interface）| `stats/editor-plugin.ts:129,139,170`

这两个布尔设置在 `editor-plugin.ts` 中被读取控制 section 级字数统计和注释计数，但 Settings UI 中没有对应 toggle。用户只能手动编辑 `data.json`。

**修复:** 在 "Vault Statistics" section 添加两个 toggle。

---

### 15. 17 个 text input 逐字符触发 `saveSettings()`，无 debounce

**位置:** 所有 `addText` 的 `onChange` handler

每次击键都执行 `saveData()` → 写 `data.json`。对 Base URL 这样的长输入，打 50 个字符 = 50 次磁盘写入。中间状态（如 `https://dashscop`）被持久化，崩溃后留下损坏配置。

**修复:** 对 text 输入 debounce（300-500ms），或改为 blur 时保存。Toggle 和 Dropdown 无需 debounce。

---

### 16. Metadata 新增表单 UX 粗糙

**位置:** `settings.ts:552-598`

- `// TODO: design better UX` 注释仍在（line 552）
- 三个输入 + Add 按钮堆在一行，窄屏挤压严重
- Dropdown 选项 `"1 Regular String"` / `"2 Timestamp"` 带序号前缀，不符合 Obsidian 设计语言
- key 为空时可以 Add
- 描述 typo: `"upport"` → `"support"`（line 559）

---

### 17. `aiProvider: "qwen"` 对国际用户不友好

**位置:** `settings.ts:132-134`

插件发布在 Obsidian 社区插件市场（国际化），README 以英文为主。默认 Qwen + DashScope URL + 中文品牌名，非中国用户会感到困惑。

**建议:** 首次安装时不预设 provider，强制用户选择后再展示后续设置；或基于 locale 判断。

---

### 18. 测试覆盖关键空白

| 缺失场景 | 影响 |
|----------|------|
| `parseInt` NaN 行为 | P0 数据损坏场景零覆盖 |
| `loadSettings()` 浅合并 + 部分 `localGraph` | P0 嵌套默认值丢失零覆盖 |
| `migrateSettings()` 端到端 | `keychain-migration.test.ts` 测的是简化副本，非真实方法 |
| `onChange` handler 实际修改 settings | Mock 捕获 callback 但从未调用 |
| `statisticsSyncEnabled` toggle 回滚路径 | try/catch 逻辑零覆盖 |
| Token 迁移失败路径 | 残留密文是否清空零覆盖 |

---

## P2 — Nice to Have

### 19. Typos 和文案不一致

| 位置 | 问题 |
|------|------|
| `settings.ts:89` | `"show current note grah view"` → `"graph"` |
| `settings.ts:559` | `"only upport formatted"` → `"only support"` |
| `settings.ts:979` | `"AI feautured image"` → `"AI featured image"` |
| `settings.ts:246` | `"// settiong options"` → `"setting options"` |
| `settings.ts:657` | `"AI Helper"` vs section header `"AI Assistant"` — 名称不一致 |
| `settings.ts:770` | `"PA Agent"` 出现在用户面向文案中，违反 AGENTS.md 产品规则 |
| `settings.ts:898` | `"Memory model"` 名称误导 — 实际控制的是 embedding model |

---

### 20. `saveSettings()` 未 `await` (2 处)

**位置:** `settings.ts:242`（Debug toggle）, `settings.ts:650`（Animation toggle）

其他 ~40 处均 `await`，仅此二处 fire-and-forget。不一致且有极端情况丢失风险。

---

### 21. 死代码：`top` / `left` DocumentFragment

**位置:** `settings.ts:366-375`

创建了 `t`（"top"）和 `l`（"left"）两个 DocumentFragment，从未使用。残留自已移除的 resize 定位功能。同行还有两处注释掉的 `.remove()` 调用（line 461, 537）。

---

### 22. `this.plugin.settings` vs `plugin.settings` 混用

Line 223 创建别名 `const plugin = this.plugin`，但后续两种引用方式随机交替，甚至在同一个 `Setting` 链中混用（如 line 428 读 `plugin.settings`，line 433 存 `this.plugin.saveSettings()`）。`saveSettings()` 也存在 `plugin.saveSettings()` vs `this.plugin.saveSettings()` 不一致。

---

### 23. Color Picker `hexToRGB` 在循环内重复定义

**位置:** `settings.ts:414-419`

每个 colorGroup 迭代都重新定义 `hexToRGB` 函数。应提取到模块级。

---

### 24. Exclude Path 逗号分隔不直观

**位置:** `settings.ts:589-598, 959-968`

两处 exclude path 使用单行 text input + 逗号分隔。路径较多时难以编辑。metadata exclude path 不 trim（line 595），memory exclude path 有 trim（line 969），行为不一致。

**修复:** 统一 `.map(p => p.trim()).filter(Boolean)`；长期改用动态列表。

---

### 25. 内联 style 不一致（11 处）

字号在 `14px` / `15px` 之间随机交替（lines 248, 355, 658, 730, 783, 841），无 CSS class。应统一为 `.pa-settings-section-desc`。

---

### 26. 770 行单一 `display()` 方法

47 个 `new Setting()` 调用 + 12 次 `this.display()` 触发全部在一个方法内。仅 2 个 trivial helper（`findGraphColor`, `findMetadata`）。无法独立测试或维护任何单一 section。

**修复:** 拆为 `displayRecordSection()`, `displayGraphSection()`, `displayAISection()`, `displayMemorySection()` 等私有方法。

---

### 27. Featured Image 缺 section header

**位置:** `settings.ts:976-998`

Qwen-only 的 Featured Image 设置无 `<h2>` 或 `<h3>` 标题，视觉上与上方 Memory 区块混在一起。

---

### 28. `CryptoHelper` 仍在 `plugin.ts` 启动时实例化

**位置:** `plugin.ts:104`

`private cryptoHelper: CryptoHelper = new CryptoHelper()` 每次启动都创建，但仅用于一次性迁移。迁移完成后成为死代码。应延迟到 `migrateSettings` 内按需创建。

---

### 29. `modelName` legacy 字段无迁移无 UI

**位置:** `settings.ts:76, 150`

`modelName` 标注"兼容旧版本"但无代码将其值迁移到 `chatModelName`。如果旧用户自定义过 `modelName`，升级后会被默认值覆盖。字段在 `data.json` 中永久残留。

---

### 30. 缺少"恢复默认设置"全局操作

仅 Graph Colors 有单项 reset。用户无一键回退路径。

---

## Summary Matrix

| # | 严重度 | 类别 | 标题 | 行号 |
|---|--------|------|------|------|
| 1 | **P0** | Data | `parseInt` 无校验写入 NaN | 282,307,381,390,994 |
| 2 | **P0** | Security | Keychain 迁移失败后密文残留 data.json | plugin.ts:1084-1086 |
| 3 | **P0** | Bug | Metadata `t` 变量未初始化 | 554-588 |
| 4 | **P0** | Data | `enableMetadataUpdating` 双字段歧义 | 44,47 |
| 5 | **P0** | Data | `loadSettings()` 浅合并丢嵌套默认值 | plugin.ts:452 |
| 6 | **P1** | IA | 48 项控件平铺无层级，核心项埋底 | 全文件 |
| 7 | **P1** | UX | 12 处 `display()` 全量重渲染 + Picker 泄漏 | 404,452... |
| 8 | **P1** | Security | Token 无法通过 UI 清除 | 829-833 |
| 9 | **P1** | UX | Provider 切换覆盖自定义配置 | 669-684 |
| 10 | **P1** | Product | OpenAI 默认 model 过时 | 679 |
| 11 | **P1** | Copy | "Check memory before chat" 语义不匹配 | 855-861 |
| 12 | **P1** | UX | Memory 子设置在 Memory 关闭时仍显示 | 855-973 |
| 13 | **P1** | Product | `vssCacheExcludePath` 含开发者私人路径 | 153 |
| 14 | **P1** | Product | `displaySectionCounts`/`countComments` 无 UI | 54-55 |
| 15 | **P1** | UX | 17 个 text input 逐字符保存无 debounce | 全部 addText |
| 16 | **P1** | UX | Metadata 表单粗糙 + typo | 552-598 |
| 17 | **P1** | Product | `aiProvider: "qwen"` 国际化问题 | 132 |
| 18 | **P1** | Test | 测试覆盖关键空白 | test files |
| 19 | P2 | Copy | Typos（6 处）+ 命名不一致 | 89,559,657,770,898,979 |
| 20 | P2 | Code | `saveSettings` 未 await（2 处） | 242,650 |
| 21 | P2 | Code | 死代码 top/left fragments + 注释 | 366-375,461,537 |
| 22 | P2 | Code | `this.plugin` vs `plugin` 混用 | 全文件 |
| 23 | P2 | Code | `hexToRGB` 循环内重复定义 | 414 |
| 24 | P2 | UX | Exclude Path 逗号分隔 + trim 不一致 | 589,959 |
| 25 | P2 | UI | 内联 style 字号 14/15px 不一致 | 248,355,658... |
| 26 | P2 | Arch | 770 行单一 `display()` | 222-999 |
| 27 | P2 | UI | Featured Image 缺 section header | 976-998 |
| 28 | P2 | Code | `CryptoHelper` 启动时无条件实例化 | plugin.ts:104 |
| 29 | P2 | Data | `modelName` legacy 字段无迁移无 UI | 76,150 |
| 30 | P2 | UX | 缺全局 "恢复默认" | — |

---

## 修复优先级路线图建议

**Phase 1 — P0 止血（1-2 天）**
- `parseIntSafe` helper + 5 处替换
- 迁移失败清空 `apiToken`
- `t` 初始化 + 空值校验
- `isEnabledMetadataUpdating` 改运行时字段
- `loadSettings` 嵌套对象深合并

**Phase 2 — P1 体验升级（3-5 天）**
- IA 重排 + Token 归位到 Provider 旁
- 条件区块改子容器渲染（解决滚动/焦点/泄漏）
- Memory 子设置条件隐藏
- text input debounce
- 默认值更新（gpt-4o-mini / vssCacheExcludePath）
- 补关键测试

**Phase 3 — P2 打磨（按节奏迭代）**
- Typo / 文案统一
- 死代码清理
- display() 拆分
- Exclude Path 动态列表
- 全局 Reset
