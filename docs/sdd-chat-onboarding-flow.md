# SDD: AI Chat 首次接触体验改善

**Status:** [x] Done
**Phase:** v2.2（批 1，同 PR 串行 commit）

---

## 1. Context

v2.1.2 review 发现新用户安装插件后存在两层落差：

1. 找不到 AI Chat 入口 —— 当前 ribbon icon 唤起的是 `PluginControlModal`（`src/plugin.ts:162-165`，需 grep 验证具体行号），而不是直达 chat view，新用户不知道 chat 在哪里
2. 即使打开 chat view，空状态没有"该配置什么"的提示 —— `chat-view.ts` 的 `renderEmptyState`（约 829-861 行，需 grep 验证）只是把视图清空，没有告诉用户需要去 Settings 配置 AI Provider 和 API Token
3. README 顶部缺少快速上手章节，Manual.md 也没有 Chat 主题，新用户找不到学习路径

三个 P0 review 项构成同一组用户体验链路（从 ribbon 入口 → 空状态引导 → 文档支撑），适合在同一个 PR 内串行 commit 完成。

### 现状速览

- **Ribbon**: 唯一 1 个 ribbon icon → `PluginControlModal`（聚合多种命令）
- **Chat 空状态**: 仅渲染 placeholder，无配置态检测
- **README**: 顶部是项目描述 + feature 列表，没有"60 秒上手"
- **Manual.md**: 包含 Memory / Featured Images 等章节，缺 Chat 完整章节

---

## 2. Goals

1. **Ribbon 直达 chat** —— 新增 ribbon icon（或改造现有），点击直达 chat view（不开 control modal）
2. **空状态配置检查** —— `renderEmptyState` 检查 `hasConfiguredAPIToken()` + `aiProvider` 设置；未配置时显示 banner "请先在 Settings 配置 AI Provider 和 API Token"，带跳转 Settings 的 link button
3. **文档补齐** —— README 顶部加 "AI Chat in 60s" 章节（含 ribbon 截图 + 空状态截图 + 配置流程截图）；Manual.md 增加完整 Chat 章节（含模型选择、引用、网络搜索、Memory）

## Non-goals

- 不重新设计 Settings 页面布局（另一个独立 SDD 跟踪）
- 不改 `PluginControlModal` 现有功能 —— 保持原 ribbon 入口可用，避免破坏老用户肌肉记忆
- 不引入 onboarding 弹窗 —— 侵入感太强，banner / inline 提示已经足够

---

## 3. 三项依赖关系（同 PR 内串行 commit）

| Commit 顺序 | 任务 | 依赖前一项产出 |
|---|---|---|
| Commit 1 | #1 Ribbon icon 实现 | 锁定 icon + 文案 + 行为，截图供后续使用 |
| Commit 2 | #2 空状态 banner | 基于 #1 决定文案是否提及 ribbon（"再次打开 chat" 等措辞） |
| Commit 3 | #4 README + Manual 文档 | 基于 #1 + #2 的最终 UI 截图编写 |

按此顺序，每个 commit 都是独立可 review 的，且后续 commit 总能基于前一个的成品。

---

## 4. Spec design

### 4.1 Ribbon icon（Commit 1）

**当前调用形态（需 grep `addRibbonIcon` 确认行号）:**

```typescript
this.addRibbonIcon('icon-name', 'tooltip', () => new PluginControlModal(...).open());
```

**改动 —— 方案 A（推荐）: 单 icon，左键直达 chat，右键弹 modal**

```typescript
const ribbonEl = this.addRibbonIcon('message-circle', 'Open AI Chat', async () => {
    await this.activateView(VIEW_TYPE_CHAT);
});
ribbonEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    new PluginControlModal(this).open();
});
```

**方案 B: 两个 ribbon icon，简单直接**

```typescript
this.addRibbonIcon('message-circle', 'Open AI Chat', () => this.activateView(VIEW_TYPE_CHAT));
this.addRibbonIcon('settings-2', 'Personal Assistant Controls', () => new PluginControlModal(this).open());
```

**选型决策:** 默认走方案 A，因为 ribbon 拥挤是真实风险（参见 §6 Risks）；右键唤起 modal 是 Obsidian 用户熟知的交互。如果方案 A 在真机测试时被发现交互不符直觉，回退方案 B。

**`activateView` 助手:** 如果当前 `plugin.ts` 中没有现成的 `activateView(type: string)` 方法，需要新增（参考 Obsidian sample plugin 的 [`activateView`](https://github.com/obsidianmd/obsidian-sample-plugin) 模式 —— 检查已有 leaf → 没有则在 right/main split 创建 leaf → reveal）。

### 4.2 空状态配置检查（Commit 2）

**当前位置:** `src/chat/chat-view.ts:renderEmptyState`（约 829-861 行，需 grep 验证）

**新增逻辑:**

```typescript
private renderEmptyState(container: HTMLElement): void {
    container.empty();
    if (!this.plugin.hasConfiguredAPIToken() || !this.plugin.settings.aiProvider) {
        this.renderConfigBanner(container);
        return;
    }
    // 现有空状态渲染（welcome message / 示例 prompt 等）
    this.renderDefaultEmptyState(container);
}

private renderConfigBanner(container: HTMLElement): void {
    const banner = container.createDiv({ cls: 'pa-chat-config-banner' });
    banner.createEl('h3', { text: '欢迎使用 AI Chat' });
    banner.createEl('p', {
        text: '请先在 Settings 中配置 AI Provider 和 API Token，才能开始对话。',
    });
    const link = banner.createEl('button', {
        text: '打开 Settings',
        cls: 'mod-cta',
    });
    link.addEventListener('click', () => {
        // Obsidian 内置 setting tab 跳转 API
        (this.app as any).setting.open();
        (this.app as any).setting.openTabById(this.plugin.manifest.id);
    });
}
```

**判定函数 `hasConfiguredAPIToken`:** 需 grep 确认插件内是否已有同名/类似函数；如果没有，最简实现：

```typescript
hasConfiguredAPIToken(): boolean {
    const provider = this.settings.aiProvider;
    if (!provider) return false;
    const tokenField = `${provider}APIToken`;  // 或按现有 settings shape 调整
    return Boolean(this.settings[tokenField]?.trim());
}
```

**CSS 样式:** 新增 `pa-chat-config-banner` class，参考 Obsidian Notice 风格（中性背景 + 略 padding + 居中），避免红色错误态过激。

### 4.3 README + Manual（Commit 3）

**README 顶部插入位置:** 项目标题 + badges 之后，feature 列表之前。

**章节框架:**

```markdown
## AI Chat in 60s

新用户三步上手：

1. 安装插件后点击左侧 ribbon 的 ![chat-icon](docs/onboarding-ribbon.png) "Open AI Chat" 图标
2. 在空白聊天界面点击 "打开 Settings" 跳转配置（截图）
3. 选择 AI Provider（Qwen / OpenAI / 等）→ 填入 API Token → 回到 chat 开始对话

完整说明见 [Manual / Chat 章节](Manual.md#chat)
```

**Manual.md Chat 章节框架:**

- 入口（ribbon / 命令面板 / hotkey）
- 模型选择（aiProvider + 模型下拉）
- 对话基本操作（发送 / 中断 / 复制）
- 引用 note（@ 符号 / drag-drop / 选区）
- 网络搜索开关
- Memory 集成（与 Memory 章节交叉引用）
- 常见问题

**截图要求:** 三张截图分别对应 ribbon icon / 空状态 banner / Settings 配置页，用同一 vault 录制保持一致风格。

---

## 5. Acceptance Criteria

### 全新 vault 体验

1. 安装插件 → ribbon 出现 chat icon → 点击直达 chat view
2. 进入 chat 空状态 → 看到 "请先配置 AI Provider" banner + "打开 Settings" 按钮
3. 点击按钮 → Obsidian Settings 打开并跳到本插件 tab
4. 配置 provider + token 后回到 chat → banner 消失，渲染默认空状态（welcome / 示例 prompt）
5. 发送第一条消息 → 正常进入对话流程

### 现有用户兼容

- ribbon 行为兼容（方案 A 右键 = 旧 ribbon 行为；方案 B 第二个 icon = 旧 ribbon）
- 命令面板 "Open Personal Assistant Controls" 命令保留（如果有）
- 已配置过 API token 的 vault 进入 chat 不再看到 banner

### 文档一致性

- README 三张截图与 v2.2 实际 UI 一致（ribbon icon 形状 / banner 文案 / Settings 布局）
- Manual.md 链接锚点（`#chat`）有效
- README "AI Chat in 60s" 内引用的 Settings 路径与 Manual 描述一致

---

## 6. Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| Ribbon 拥挤（方案 B 加第二 icon） | 中 | 默认走方案 A 单 icon + 右键 modal；如方案 A 测试不通过再回退 |
| 空状态 banner 风格过侵入 | 中 | 参考 Obsidian Notice / inline empty state，避免红色错误态；单元测试加 snapshot 防回归 |
| `app.setting.openTabById` 是 Obsidian 内部 API | 低 | API 在 Obsidian 1.x 稳定多版本；fallback 写 try/catch + 提示用户手动打开 |
| 截图过期（v2.2 → v2.3 UI 变化） | 低 | 截图文件命名带版本号 `onboarding-ribbon-v2.2.png`，Manual 重写时同步更新 |
| 现有 vault 老用户感觉 ribbon 行为变了 | 中 | 方案 A 兼容（右键 = 旧行为）；release notes 显式说明 |
| `hasConfiguredAPIToken` 已存在但语义不同 | 低 | 实施前 grep 全仓确认；如有冲突改名 `isAIChatReady` |
| 三个 commit 串行依赖产出截图 | 低 | 同 PR 内顺序提交，commit 1 完成立刻截图，commit 2 / 3 复用 |

---

## 7. Verification

### 自动化

- `npm test`（chat-view 相关现有测试不退化）
- 新增空状态 banner 渲染单测（mock `hasConfiguredAPIToken` 返回 false / true 各一例）
- `tsc -noEmit -skipLibCheck`

### 真机 smoke

1. 删除测试 vault 的 `.obsidian/plugins/personal-assistant/data.json` + keychain（如适用）
2. 重启 Obsidian → 装载插件 → 走 ribbon → chat view → banner → Settings 跳转 → 配置 → 回到 chat 完整流程
3. 录制一段 60 秒视频作为 README 上手演示的备用素材（视频不进 repo，只用于宣传）
4. 验证现有 vault 不破坏：方案 A 右键 ribbon 弹 modal / 方案 B 第二 icon 出现

### 文档

- 三张截图清晰可读（≥ 1x retina）
- README + Manual 链接相互可达
- README "AI Chat in 60s" 字数控制在一屏内（≤ 200 字）

---

## 8. Critical Files

**修改:**

- `src/plugin.ts` — ribbon icon 注册（addRibbonIcon 调用，需 grep 确认行号）
- `src/chat/chat-view.ts` — `renderEmptyState` + 新增 `renderConfigBanner` 方法（需 grep 确认行号）
- `README.md` — 顶部新增 "AI Chat in 60s" 章节
- `Manual.md` — 新增 Chat 章节
- `styles.css`（或对应样式文件）— 新增 `.pa-chat-config-banner` class

**新增:**

- `docs/onboarding-ribbon.png` / `docs/onboarding-empty-state.png` / `docs/onboarding-settings.png`

**阅读参考（无改动）:**

- `src/main.ts` 或 `src/plugin.ts` 中的 `activateView` 实现（若不存在则新增）
- Obsidian sample plugin 的 ribbon + view activation 模式
