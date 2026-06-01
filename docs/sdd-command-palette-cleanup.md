# SDD: 命令面板清理（Memory 收敛 + Featured Images 限定）

**Status:** [D] Drafting
**Phase:** v2.2（批 2，独立 PR）

---

## 1. Context

v2.1.2 review 发现命令面板存在两类用户视角的混乱：

1. **Memory 命令过多** —— 命令面板搜索 "Memory" 出现 4 个命令（如 `prepare` / `refresh` / `check` / `show`，具体名称需 grep `addCommand` 确认），普通用户分不清"我该用哪个"。其中只有 1-2 个是日常需要的，剩下 2-3 个是诊断/进阶用途
2. **Featured Images 命令在非 DashScope provider 下显示但无法工作** —— 命令面板里看得到、点了报错或静默失败，对用户是负面体验

review 拍板：Memory 进阶命令藏到 advanced toggle 后；Featured Images 命令仅在 `aiProvider === 'qwen'`（DashScope）时显示。

### 现状速览（需 grep 验证）

- `src/plugin.ts` 中 `this.addCommand({ ... })` 注册 4 个 Memory 命令，全部无 `checkCallback`，命令面板始终可见
- Featured Images 命令注册位置同样无 provider 判定 `checkCallback`
- Settings 中已存在 / 待新增 `showAdvancedMemoryControls` toggle（需 grep 确认 —— 如果没有则本 SDD 新增）

---

## 2. Goals

1. **Memory 命令收敛** —— 4 个命令分类为：
   - User-facing（永远可见）: 1-2 个（如 "Refresh memory" / "Check memory status"，最终命名以 grep 后真实命令为准）
   - Advanced（toggle 控制）: 2-3 个，仅在 `settings.showAdvancedMemoryControls === true` 时通过 `checkCallback` 暴露
2. **Featured Images 限定 DashScope** —— 用 `checkCallback` 检查 `aiProvider === 'qwen'`，非 DashScope 时返回 false（命令面板不显示）

## Non-goals

- 不删任何 Memory / Featured Images 命令的实际逻辑 —— 仅控制显隐
- 不重构 Featured Images 整体能力（独立 SDD）
- 不动其他 plugin 命令（chat / control modal / 等）
- 不引入 Settings UI 改造（toggle 如已存在直接复用，新增也只是简单 boolean toggle）

---

## 3. 现有命令清单（需 grep 验证）

实施前必须先 grep `addCommand` 全仓得到准确清单。本节框架基于 review 报告假设，行号需要在 commit 中校正。

### 3.1 Memory 命令（4 个）

| 命令 ID（假设） | User-facing 还是 Advanced | 决策 |
|---|---|---|
| `pa-memory-prepare` | Advanced | 隐藏到 toggle |
| `pa-memory-refresh` | User-facing | 永远显示 |
| `pa-memory-check-status` | User-facing | 永远显示 |
| `pa-memory-show-graph`（或 `show-debug`） | Advanced | 隐藏到 toggle |

**真实命令 ID 与名称需 grep `addCommand` 后修正本表。** 分类原则：

- User-facing = 用户在使用过程中可能主动触发的（refresh = 同步最新 / status = 知道当前状态）
- Advanced = 故障排查 / 内部状态调试（prepare / show / debug）

### 3.2 Featured Images 命令

需 grep 确认命令名（如 `pa-featured-image-generate` / `pa-featured-image-batch`）。

**判定逻辑:** `this.settings.aiProvider === 'qwen'`（值常量需 grep `aiProvider` 类型定义验证 —— 可能是 `'dashscope'` / `'qwen'` / 其他枚举字符串）。

---

## 4. Spec design

### 4.1 Memory advanced toggle（如已存在则复用）

**Settings 字段（如不存在则新增）:**

```typescript
// src/settings.ts（或对应文件）
showAdvancedMemoryControls: boolean;  // default false
```

**Settings UI tab 中新增 toggle（如不存在）:**

```typescript
new Setting(containerEl)
    .setName('Show advanced memory commands')
    .setDesc('在命令面板中显示 Memory 进阶/诊断命令（一般用户无需开启）')
    .addToggle((toggle) =>
        toggle
            .setValue(this.plugin.settings.showAdvancedMemoryControls)
            .onChange(async (value) => {
                this.plugin.settings.showAdvancedMemoryControls = value;
                await this.plugin.saveSettings();
            }),
    );
```

### 4.2 Memory 命令注册 —— `checkCallback` 改造

**Before（当前）:**

```typescript
this.addCommand({
    id: 'pa-memory-prepare',
    name: 'Prepare memory index',
    callback: async () => { /* ... */ },
});
```

**After（advanced 命令）:**

```typescript
this.addCommand({
    id: 'pa-memory-prepare',
    name: 'Prepare memory index',
    checkCallback: (checking) => {
        if (!this.settings.showAdvancedMemoryControls) return false;
        if (checking) return true;
        void (async () => { /* ... */ })();
        return true;
    },
});
```

**User-facing 命令保持 `callback`（无变化）** —— 不要硬塞 `checkCallback`，否则增加心智负担。

### 4.3 Featured Images 命令注册 —— `checkCallback` 改造

**After:**

```typescript
this.addCommand({
    id: 'pa-featured-image-generate',
    name: 'Generate featured image',
    checkCallback: (checking) => {
        if (this.settings.aiProvider !== 'qwen') return false;
        if (checking) return true;
        void (async () => { /* ... */ })();
        return true;
    },
});
```

**`aiProvider` 字面值确认:** 在改动前 grep `aiProvider` 类型定义 —— 如果是 union type `'qwen' | 'openai' | ...`，直接用字符串比较；如果是 enum，import 后比较 enum 值。

### 4.4 `checkCallback` 重计算成本

`checkCallback` 在用户每次输入命令面板搜索词时被调用一次，要求轻量。

- `this.settings.showAdvancedMemoryControls` —— 字段读取，O(1)
- `this.settings.aiProvider !== 'qwen'` —— 字段读取 + 字符串比较，O(1)

两者都是便宜操作，不需要缓存。**禁止在 `checkCallback` 中调用** `hasConfiguredAPIToken()` 等可能读取 keychain / 触发 IO 的函数。

---

## 5. Acceptance Criteria

### 默认安装

- 命令面板搜索 "Memory" → 仅出现 1-2 个 user-facing 命令（如 "Refresh memory" / "Check memory status"）
- 命令面板搜索 "Featured Image" 在 `aiProvider !== 'qwen'` 下 → 0 命中

### 切换 advanced toggle

- 打开 Settings → 启用 "Show advanced memory commands" → 立即返回命令面板搜索 "Memory" → 出现全部 4 个命令
- 关闭 toggle → 命令面板再搜索 → 仅 1-2 个 user-facing

### 切换 aiProvider

- Settings 中切到 `aiProvider: 'qwen'` → 命令面板搜索 "Featured Image" → 显示 Featured Images 命令
- 切回非 qwen provider → 命令面板搜索 "Featured Image" → 0 命中

### 行为不退化

- User-facing Memory 命令的实际逻辑保持原样
- Advanced 命令在 toggle 开启后调用结果与改造前一致
- Featured Images 命令在 qwen provider 下调用结果与改造前一致

---

## 6. Spec implementation steps

1. **Grep 命令清单** —— `grep -nE "addCommand\(\s*\{" src/plugin.ts` 列出全部 `addCommand` 调用位置，标注 4 个 Memory 命令和 Featured Images 命令的真实 id / name / 当前 callback 形态
2. **决定 user-facing vs advanced 分类** —— 根据真实命令名 + 文档（Manual.md / README）中现有描述决定哪些保留为 user-facing
3. **新增（或验证已有）Settings toggle** `showAdvancedMemoryControls`
4. **改造 advanced Memory 命令** —— 把 `callback` 改为 `checkCallback`（按 §4.2 模板）
5. **改造 Featured Images 命令** —— 加 `checkCallback`（按 §4.3 模板）
6. **更新 Manual.md** —— 在 Memory / Featured Images 章节简短说明哪些命令何时可见
7. **真机验证** —— Settings toggle / aiProvider 切换两类场景

---

## 7. Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| `checkCallback` 内做重计算（如 `hasConfiguredAPIToken`）拖慢命令面板 | 中 | §4.4 明确只允许 O(1) 字段读取；review 时严查 |
| Settings 切换 aiProvider 后 Obsidian 不立即刷新命令面板缓存 | 低 | Obsidian 行为：下次打开命令面板时 `checkCallback` 重新跑；如确认有缓存问题可文档说明"切换 provider 后请重新打开命令面板"；无需重启插件 |
| User-facing / advanced 分类误判 | 中 | 实施前 grep 真实命令 + 命令实际 callback 实现，必要时与"命令应该是普通用户日常用还是排错用"对照；分类如有疑虑保守归 advanced（默认隐藏更安全） |
| 命令 ID 改名破坏 hotkey | 中 | **保留所有命令 ID 不变**，只改 callback → checkCallback；hotkey 绑定基于 ID，不受影响 |
| `aiProvider` 字面值与代码常量不匹配 | 中 | 实施前 grep `aiProvider` 类型定义 / enum；用类型常量而非裸字符串比较 |
| toggle 已存在但语义不同 | 低 | 实施前 grep `showAdvancedMemoryControls` 全仓；如冲突改名 `showAdvancedMemoryCommands` |
| Manual.md 描述与代码不同步 | 低 | 同 PR 内更新文档；commit 顺序：代码改动 → 真机验证 → 更新文档 |

---

## 8. Verification

### 自动化

- `npm test` —— 现有命令注册相关测试通过（如有）
- `tsc -noEmit -skipLibCheck`
- 新增单测（如 plugin 测试基础设施允许）：mock settings → 调用 `checkCallback(true)` → 断言返回值

### 真机

1. 默认安装 → 命令面板搜 "Memory" → 期望 1-2 命中
2. 启用 advanced toggle → 命令面板搜 "Memory" → 期望 4 命中
3. 切到 qwen provider → 命令面板搜 "Featured Image" → 期望命令出现
4. 切到非 qwen provider → 命令面板搜 "Featured Image" → 期望 0 命中
5. 验证已绑定 hotkey 的 advanced Memory 命令在 toggle 关闭时是否仍能通过 hotkey 触发 —— Obsidian 行为：`checkCallback` 返回 false 时 hotkey 也不触发；如果用户依赖 hotkey 执行 advanced 命令，则 release notes 显式提示"启用 toggle 才能使用"
6. 验证用户即使在 toggle 关闭状态下，命令实际逻辑没有被破坏（toggle 打开后立即可用）

---

## 9. Critical Files

**修改（待 grep 后确认）:**

- `src/plugin.ts` —— Memory 命令 4 处 `addCommand` 注册位置（advanced 改 `checkCallback`） + Featured Images 命令注册位置
- `src/settings.ts`（或同等文件）—— 新增 `showAdvancedMemoryControls` 字段与 default
- Settings tab UI 文件（如 `src/settings-tab.ts`）—— 新增 toggle UI（如 toggle 不存在）
- `Manual.md` —— Memory / Featured Images 章节附注命令显隐说明

**阅读参考（无改动）:**

- 现有 `addCommand` `checkCallback` 用法（如插件内已有先例）
- Obsidian API doc 中 `checkCallback` 语义

---

## 10. Workflow

1. 设计记录定稿。
2. Grep 全仓拿到真实命令清单 + 真实 settings shape，按需修正本 SDD §3 / §4 行号 + 命名。
3. 单 commit 实施（命令注册 + toggle UI + Manual 更新），独立 PR。
4. TypeScript / Jest / lint / build 通过 + 真机 smoke（§8 第 1-6 步）后合入。
