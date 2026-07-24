# Agent Operations 能力层定义

Document status: Draft (讨论中)
Updated: 2026-07-23
Work item: B-101 (扩展)

> 定义 Agent（含 Chat Agent 和 Pagelet Agent）在 Obsidian 中的完整操作能力集。
> 核心思路：不预定义有限的 tool 集合，而是基于 Obsidian API 给 Agent 生成型的操作能力。
> 本文档取代原 Operations Agent 的"最小化渐进扩展"路径，转为"完整能力层 + 安全约束"路径。

---

## 1 · 设计理念

### 1.1 从"枚举型"到"生成型"

| 方案 | 能力边界 | 扩展方式 |
|------|---------|---------|
| 原方案：预定义工具集 | 定义了几个工具就能做几件事 | 每增加一个操作写一个 tool |
| 新方案：Obsidian API 能力层 | Agent 能做 API 允许的任何事 | 不需要新增工具，Agent 组合 API |

### 1.2 核心优势

- 不需要预想所有可能的操作
- Agent 能组合多步操作（读 → 判断 → 改 → 验证）
- Obsidian 新版 API、新插件 API 自动可用
- 极大减少工具定义的维护成本
- Chat Agent 和 Pagelet Agent 共享同一能力层

---

## 2 · 能力全集

基于 `obsidian.d.ts`（7517 行，官方完整 TypeScript 类型定义）筛选出 Agent 需要的 API。

### 2.1 Tier 1：核心操作

几乎所有写操作场景都需要的 API：

| API | 签名 | 用途 | Agent 场景 |
|-----|------|------|-----------|
| `vault.process` | `(file: TFile, fn: (data: string) => string) => Promise<string>` | 原子读-改-写 | 安全的局部内容修改（最实用） |
| `vault.append` | `(file: TFile, data: string) => Promise<void>` | 追加内容 | 在笔记末尾添加 |
| `vault.create` | `(path: string, data: string) => Promise<TFile>` | 创建笔记 | 生成 MOC、汇总笔记、新建关联笔记 |
| `fileManager.processFrontMatter` | `(file: TFile, fn: (fm: any) => void) => Promise<void>` | 原子修改 frontmatter | 加 tag、加属性、改 status |
| `fileManager.renameFile` | `(file: TAbstractFile, newPath: string) => Promise<void>` | 重命名/移动 + 自动更新 backlinks | 整理 vault 结构 |
| `fileManager.generateMarkdownLink` | `(file: TFile, sourcePath: string, subpath?: string, alias?: string) => string` | 生成正确格式的链接 | 插入 wikilink 时确保格式正确 |

### 2.2 Tier 2：辅助操作

特定场景有用的 API：

| API | 签名 | 用途 | Agent 场景 |
|-----|------|------|-----------|
| `vault.createFolder` | `(path: string) => Promise<TFolder>` | 创建文件夹 | 整理结构 |
| `vault.trash` | `(file: TAbstractFile, system: boolean) => Promise<void>` | 移到回收站 | 安全删除（不是硬删） |
| `vault.copy` | `(file: TAbstractFile, newPath: string) => Promise<T>` | 复制文件 | 拆分笔记时保留原件 |
| `metadataCache.getFileCache` | `(file: TFile) => CachedMetadata \| null` | 读缓存的元数据 | 快速获取 links/tags/headings |
| `metadataCache.resolvedLinks` | `Record<string, Record<string, number>>` | 全局链接图 | 判断笔记间已有链接 |
| `metadataCache.unresolvedLinks` | `Record<string, Record<string, number>>` | 断链集合 | 发现修复机会 |
| `workspace.openLinkText` | `(linktext: string, sourcePath: string, newLeaf?: PaneType) => Promise<void>` | 打开/跳转笔记 | 引导用户查看来源 |

### 2.3 Tier 3：命令执行

| API | 签名 | 用途 | 说明 |
|-----|------|------|------|
| `app.commands.executeCommandById` | `(id: string) => boolean` | 执行任意已注册 Obsidian 命令 | 覆盖 toggle checkbox、apply template、export 等所有命令 |
| `app.commands.listCommands` | `() => Command[]` | 列出所有可用命令 | Agent 用来发现可执行的命令（id + name） |

命令执行的能力边界等于 Obsidian 生态所有插件注册的命令集合，无需逐个预定义。

---

## 3 · 不暴露给 Agent 的 API

| API 类别 | 排除原因 |
|---------|---------|
| Workspace layout（split/leaf/popout/floating） | UI 编排不是 Agent 职责 |
| Editor 类（光标、选区、transaction） | 太底层，和 Agent 交互模式不匹配 |
| Component 生命周期 | 插件内部框架 |
| Keymap / Scope | 快捷键注册，非 Agent 职责 |
| DataAdapter（filesystem 直接操作） | 绕过 Vault 抽象层，不安全 |
| SecretStorage | 敏感数据，不应暴露 |
| DOM / View 渲染 | UI 层面，Agent 无需直接操作 |

---

## 4 · API 知识供给

Agent 需要知道 API 怎么用。7500 行完整 d.ts 太大无法全量注入。

### 4.1 方案：分层供给

| 层 | 内容 | 注入方式 |
|---|------|---------|
| 常驻 | Tier 1 的 6 个核心 API 签名 + 用法示例 | 写入 system prompt |
| 按需 | Tier 2/3 的 API 参考 | 类似 `load_skill`，Agent 需要时加载 |
| 查询 | 可用命令列表（`listCommands()` 结果） | 作为工具调用获取实时列表 |

### 4.2 Tier 1 常驻参考（精简版，~800 tokens）

```typescript
// 原子修改笔记内容（最安全的写法）
await vault.process(file, (data) => data.replace('old', 'new'));

// 追加内容
await vault.append(file, '\n## New Section\ncontent');

// 创建新笔记
const newFile = await vault.create('path/note.md', 'content');

// 修改 frontmatter
await fileManager.processFrontMatter(file, (fm) => {
  fm.tags = [...(fm.tags || []), 'new-tag'];
  fm.status = 'reviewed';
});

// 重命名（自动更新所有 backlinks）
await fileManager.renameFile(file, 'new/path/note.md');

// 生成正确格式的链接
const link = fileManager.generateMarkdownLink(targetFile, sourcePath);
```

---

## 5 · 实现形态：代码执行工具

### 5.1 核心设计

Agent 不通过预定义 tool 操作笔记，而是通过一个**通用代码执行工具**生成并运行 JavaScript 代码：

```typescript
// Agent 的工具定义
interface ExecuteObsidianAPI {
  name: 'execute_obsidian_api';
  description: 'Execute JavaScript code using Obsidian API in the plugin context';
  parameters: {
    code: string;        // 要执行的代码
    description: string; // 代码意图描述（用于确认和审计）
  };
}
```

### 5.2 执行上下文

代码在插件上下文中运行，有权访问：
- `app` — Obsidian App 实例
- `app.vault` — Vault 操作
- `app.fileManager` — 文件管理（含 frontmatter、rename）
- `app.metadataCache` — 元数据缓存
- `app.workspace` — 工作区（有限：openLinkText）
- `app.commands` — 命令执行

### 5.3 安全边界

代码执行前的约束：
- 不允许 `require()`、`import()`、`eval()` 等动态加载
- 不允许访问 `DataAdapter`（绕过 Vault 抽象）
- 不允许访问 `process`、`fs`、`child_process` 等 Node API
- 不允许修改 DOM
- 不允许访问 `SecretStorage`
- 执行超时限制

---

## 6 · 与原 Operations Agent 方案的关系

| 维度 | 原方案（B-101） | 新方案 |
|------|---------------|--------|
| 能力模型 | 预定义 action families + 4-gate 确认 | Obsidian API 代码执行 + 安全边界 |
| 首个 action | append-to-current-note（单一操作） | 完整 API 能力层（通用） |
| 扩展方式 | 每个 action family 需要单独设计+审批 | Agent 组合 API，不需要逐个设计 |
| 确认机制 | 4-gate（target confinement → preview → stale-reread → execute） | TBD（见待讨论项） |
| Write Action Framework | 作为基础设施层 | 可能简化或替换 |

---

## 7 · 安全与确认机制

### 7.1 设计原则

原 4-gate（逐操作确认）在新能力模型下摩擦过高——Agent 做一个多步任务需要用户确认 N 次，能力形同虚设。

新方案：**意图级确认 + 审计回滚**（C+D 组合）。

### 7.2 执行流程

```
Agent 分析 → 形成操作意图
  → 向用户展示意图描述（一句话概括 + 涉及文件列表）
  → 用户确认（一次）
  → Agent 自主执行所有 API 调用（不逐步打断）
  → 执行完成 → 展示变更摘要（文件 diff）
  → 提供撤销入口（单步或全部回滚）
```

### 7.3 审计与回滚

所有写操作自动记录 before-snapshot：

```typescript
interface OperationAuditEntry {
  timestamp: number;
  intentDescription: string;     // Agent 的意图描述
  operations: Array<{
    api: string;                  // 调用的 API
    target: string;              // 目标文件路径
    beforeContent?: string;      // 修改前内容（用于回滚）
    afterContent?: string;       // 修改后内容（用于审计）
    result: 'success' | 'error';
    error?: string;
  }>;
}
```

- Markdown 文件天然适合 snapshot/diff
- 支持单步回滚（撤销某一个操作）或全部回滚（撤销整个意图）
- 审计日志持久化，用户随时可查

### 7.4 高风险操作额外提示

对于以下操作，在意图确认中明确标注高风险：
- `vault.trash` / 删除操作
- `fileManager.renameFile`（影响所有 backlinks）
- `app.commands.executeCommandById`（副作用不可控）
- 批量操作（涉及 5+ 文件的修改）

仍然是意图级确认（不退化到操作级），但 UI 上给出明确的风险提示。

### 7.5 与原 4-gate 的关系

| 原 4-gate | 新方案中的对应 |
|-----------|--------------|
| Target confinement | 安全边界（§5.3）—— 代码层面禁止越界 |
| Preview confirmation | 意图级确认 —— 一次确认覆盖整个操作序列 |
| Stale re-read | `vault.process` 原子操作天然保证 —— 不需要额外 gate |
| Execute | Agent 自主执行 + 审计日志 |

4-gate 框架不再作为运行时流程，其安全意图被分散到代码约束、意图确认、审计回滚三个层面中。

---

## 8 · 实现形态：结构化 Tool Call

### 8.1 设计决策

不采用通用代码执行（eval），而是将 Obsidian API 包装为结构化 tool call。

理由：
- 模型调 tool 比生成代码可靠（schema 约束）
- 结构化参数天然支持预览和审计
- 不需要 sandbox/eval，无代码注入风险
- Agent loop 本身支持多步调用，不需要在一段代码里组合操作

### 8.2 Tool 定义

```typescript
// Tier 1 核心
vault_read:           { path } → { content }
vault_process:        { path, operation, params } → { success, filesChanged }
vault_append:         { path, content } → { success }
vault_create:         { path, content } → { success, file: { path, name } }
frontmatter_update:   { path, set?, delete? } → { success }
file_rename:          { path, newPath } → { success }
generate_link:        { targetPath, sourcePath, alias? } → { linkText }

// Tier 2 辅助
vault_create_folder:  { path } → { success }
vault_trash:          { path } → { success }
vault_copy:           { path, newPath } → { success }
metadata_get_cache:   { path } → { cachedMetadata }
metadata_get_links:   { path } → { resolved, unresolved }
workspace_open:       { linktext, sourcePath } → { success }

// Tier 3 命令
command_list:         {} → { commands: Array<{ id, name }> }
command_execute:      { id } → { success }
```

### 8.3 vault_process 的 operation 设计

支持常见内容修改模式，行为确定性、可预览：

| operation | params | 效果 |
|-----------|--------|------|
| `replace` | `{ search, replace }` | 替换文本 |
| `insert_after_heading` | `{ heading, content }` | 在指定 heading 后插入 |
| `insert_at_position` | `{ line, content }` | 在指定行插入 |
| `delete_section` | `{ heading }` | 删除指定 section |
| `wrap_selection` | `{ search, before, after }` | 给匹配文本加前后缀 |

### 8.4 执行结果反馈

每个 tool call 返回结构化结果：

```typescript
interface ToolResult {
  success: boolean;
  returnValue?: any;         // 精简的返回值（TFile → { path, name }）
  error?: { name: string; message: string };
  filesChanged: string[];    // 通过 vault 事件 hook 自动收集
}
```

Agent 据此决定下一步：成功则继续、失败则重试或告知用户。

---

## 9 · Pagelet Agent 联动

### 9.1 路径选择：展示 + 一键动作（路径 B）

Pagelet Agent 不自动执行操作。流程：

```
Pagelet Agent 发现 insight
  → Insight Card 展示发现 + action 按钮
  → 用户点击 action 按钮
  → 触发 operations 执行（走意图确认流程）
```

### 9.2 设计理由

- "安静"——不在后台偷偷改笔记
- "可信"——用户先理解"为什么"，再决定是否行动
- "低摩擦"——insight card 上一个按钮，不需要去 Chat 打字

### 9.3 Action 按钮映射

| Insight 类型 | Action 文案 | 对应 tool 序列 |
|-------------|------------|---------------|
| 矛盾 | "查看冲突" | `workspace_open` |
| 遗忘 | "重新链接" | `vault_process`（插入链接） |
| 聚合 | "创建索引笔记" | `vault_create` + 多次 `frontmatter_update` |
| 过时 | "标记过时" | `frontmatter_update`（status: outdated） |
| 缺口 | "补充引用" | `vault_process`（插入链接） |

### 9.4 未来演进

路径 B 验证后可 opt-in 自动执行：
- 用户在 Settings 中开启"低风险操作自动执行"
- 低风险 = 仅 frontmatter 修改 / 仅追加 / 仅当前笔记
- 自动执行后仍通知 + 提供撤销

---

## 10 · 命令执行策略

### 10.1 不设静态 allowlist/blocklist

理由：
- 不同用户安装的插件不同，硬编码列表不可维护
- 意图级确认已覆盖
- 命令自身有 `checkCallback`，不可用时 Obsidian 会拒绝

### 10.2 启发式风险标注

Agent 执行命令前，基于命令 id 关键词自动标注风险等级：

- 包含 `git`、`sync`、`push`、`publish`、`export`、`send`、`upload` → 意图确认中标注"⚠️ 此操作可能有外部副作用"
- 其余 → 正常意图确认

启发式标注，不硬性阻断。用户仍可确认执行。

### 10.3 前置校验

Agent 执行命令前必须通过 `command_list` 确认：
- 命令 id 存在
- 命令当前可用（非 disabled）
- 不盲目执行不存在的命令

---

## 11 · 移动端兼容性

### 11.1 结论

所有选定 API 移动端均可用，不需要额外平台适配逻辑。

### 11.2 差异处理

| 差异 | 处理方式 |
|------|---------|
| 部分命令移动端不注册 | Agent 通过 `command_list` 实时获取，自动适配 |
| 性能较慢 | runtime 层放宽超时（桌面 5s → 移动 15s） |
| 批量操作更慢 | 涉及 5+ 文件时意图确认提示"执行可能较慢" |
| UI 确认交互 | 移动端用底部 sheet 替代 modal |

Agent 的 tool 定义和调用方式桌面/移动完全一致，差异由 runtime 透明处理。

---

## 12 · 审计日志

### 12.1 存储位置

`.obsidian/plugins/personal-assistant/audit/`

- 跟随 vault，多设备同步可见
- 不污染用户笔记空间
- 符合 Obsidian 惯例

### 12.2 文件结构

```
audit/
├── 2026-07-24T10-32-15_add-links-to-moc.json
├── 2026-07-24T11-05-42_update-frontmatter.json
└── ...
```

单个文件内容：

```json
{
  "id": "op_20260724_103215",
  "timestamp": 1753350735000,
  "intent": "给笔记 A、B、C 添加到 MOC/topic-x 的双向链接",
  "agent": "chat | pagelet",
  "status": "completed | rolled-back",
  "operations": [
    {
      "tool": "vault_create",
      "params": { "path": "MOC/topic-x.md", "content": "..." },
      "before": null,
      "after": "# Topic X\n...",
      "result": "success"
    },
    {
      "tool": "vault_process",
      "params": { "path": "notes/a.md", "operation": "insert_after_heading", "..." : "..." },
      "before": "...原始全文...",
      "after": "...修改后全文...",
      "result": "success"
    }
  ]
}
```

### 12.3 清理策略

| 条件 | 处理 |
|------|------|
| 30 天未回滚 | 删除 before/after 内容（保留操作摘要） |
| 90 天 | 删除整个审计文件 |
| 已回滚的记录 | 标记 `rolled-back`，30 天后清理 |
| 用户手动确认"已审查" | 可立即清理 |

时间阈值可在 Settings 中配置。峰值存储约 3MB（日均 5 次操作），成本可忽略。

### 12.4 多设备同步安全性

审计日志在多设备通过 git/同步工具协作时不会产生 conflict：

- 每次操作生成**独立文件**（非追加到同一文件），文件名含时间戳，不同设备不会重名
- 审计文件**写入后不再修改**（只读或删除），不存在多设备同时编辑同一文件的情况
- 清理操作是**删除文件**而非修改索引，两设备同时删除同一文件 git 不报 conflict

设计要点：不使用单一追加式 `audit.json`（多设备必冲突），而是一次操作一个独立文件。

### 12.5 回滚机制

- 用户在 UI 中（Settings 或 Panel）查看操作历史
- 可选"回滚全部"或"回滚单步"
- 回滚 = 把 before-snapshot 写回文件
- 回滚本身生成一条审计记录

---

## 13 · Tool 注入策略

### 13.1 按需加载

- 读工具（7 个 + webSearch）：**常驻**，约 1.5K tokens
- 写工具（~10 个）：**按需加载**
- 触发条件：
  - Chat Agent：识别到用户意图包含写操作时加载
  - Pagelet Agent：用户点击 action 按钮后，在独立 operations session 中加载
- 加载后在同一对话/session 内持续可用

### 13.2 好处

- 纯问答对话不付额外 token 成本
- Pagelet 发现循环不被写工具干扰（不会幻觉出写操作）
- 写工具按需加载，不增加常驻 system prompt 体积

---

## 14 · vault_process 精简设计

### 14.1 三种 operation

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
  | { section: string }           // 按 heading 删除
  | { from: number; to: number }  // 按行范围删除
```

### 14.2 原则

- 保持最少原子操作，复杂场景靠 Agent 多步组合
- 不增加过多 tool 复杂度

---

## 15 · 确认与回滚 UI

### 15.1 确认交互：内联，非弹窗

不使用独立 modal，确认内联在交互流程中：

**Chat Agent**：确认信息作为对话的一部分
```
Agent：好的，我会在 notes/a.md 末尾添加 [[note-b]] 的链接。
       [执行] [算了]
```

**Pagelet Agent**：action 按钮点击后在卡片内确认
```
Insight Card → 用户点击 action → 卡片切换为确认态 → 确认/取消 → 结果态
```

设计要点：
- 感受是对话/卡片的延续，不是系统警告
- 不打断用户心流
- 高风险操作在描述文案中自然标注，不额外弹层

### 15.2 回滚 UI

**即时撤销**：操作完成后，结果内联展示 [撤销] 按钮

**历史回滚**：Tab 中加"操作历史" section，按时间倒序列出，每条可展开查看变更 + 一键回滚

---

## 16 · WAF 迁移策略

### 16.1 渐进过渡（方案 B）

1. 新方案独立实现（新文件、新模块）
2. WAF 代码保留不动（runtime flag 继续关闭）
3. 新方案 dogfooding 验证通过
4. 评估 WAF 代码：有复用价值的提取（如 target confinement 逻辑），其余清理

### 16.2 理由

- WAF 不影响运行时（flag 关闭）
- 新方案仍在提案阶段，实现时可能调整
- 避免"重构还没完就又重构"

---

## 17 · Agent 调度

### 17.1 优先级规则

用户主动触发永远优先于系统后台触发：

| 场景 | 处理 |
|------|------|
| 用户在聊天 → Pagelet 想跑 | Pagelet 等待，Chat 结束后再跑 |
| Pagelet 在后台跑 → 用户开始聊天 | Pagelet 当前 turn 完成后暂停，让出给 Chat |
| 用户不活跃 → Pagelet 后台跑 | 正常运行 |
| 用户点 Pagelet action → 触发 Operations | 等同用户主动触发，优先级同 Chat |

### 17.2 实现

简单信号量：Chat 请求进行中 → Pagelet 排队。不需要复杂调度器。

### 17.3 共享上下文

两个 Agent 通过共享 insight cache 协作，不实时通信：
- Pagelet Agent 产出 → 写入 insight cache
- Chat Agent 启动时 → 读 insight cache 作为上下文
- 自然引用："Pagelet 之前发现了..."

### 17.4 成本控制

- Pagelet Agent 每日调用上限（可配置，默认 20 次/天）
- 超过上限当天不再触发
- Settings 中展示消耗量（透明）

---

## 18 · 实施路径

### 18.1 Phase 依赖关系

```
Phase 1: Operations 能力层（基础）
    ↓
Phase 2: Pagelet Agent 化（依赖 Operations 执行 action）
    ↓
Phase 3: Agent 协作（两个 Agent 都就位后）
    ↓
Phase 4: 陪伴能力（建立在所有之上）
```

### 18.2 各 Phase 内容

| Phase | 核心交付 | 验证方式 |
|-------|---------|---------|
| 1 | 结构化 tool call + 意图确认 + 审计回滚 + Chat Agent 接入 | dogfooding：日常让 Agent 帮忙改笔记 |
| 2 | Lead-driven 发现循环 + 场景合并 + UI 收敛 + insight cache | dogfooding：观察 insight 精确性和新颖性 |
| 3 | 调度（Chat 优先）+ 共享 insight cache + 每日上限 | dogfooding：聊天时自然引用 Pagelet 发现 |
| 4 | 长期记忆 + 人格一致性 + 注意力连续性 + 检索增强 | 长期使用观察"越用越懂你" |

### 18.3 产品愿景

所有 Phase 服务于同一个目标：

> PA 像一个安静的伙伴，默默观察 vault 变化，记住用户的思维轨迹。需要时和它聊天，它了解上下文，自然引用用户自己写过的东西。偶尔轻轻提醒遗忘或忽略的关联。时间越久，越懂你。

自定义 Skill（B-103）暂不考虑，待基础能力验证后再评估。

---

## 19 · 设计决策记录

| # | 决策 | 理由 |
|---|------|------|
| D1 | 基于 Obsidian API 的生成型能力，而非预定义工具集 | 灵活性高、维护成本低、自动获得新 API 能力 |
| D2 | 分三层（Tier 1/2/3）定义 API 范围 | 区分核心/辅助/扩展，便于安全分级和 prompt 管理 |
| D3 | 排除 DataAdapter、Node API、DOM 操作 | 安全边界——Agent 只能通过 Vault 抽象层操作 |
| D4 | 命令执行纳入能力集 | 覆盖所有 Obsidian 生态插件能力，不需要逐个集成 |
| D5 | API 知识分层供给（常驻 + 按需 + 查询） | 平衡 token 成本和 Agent 可用性 |
| D6 | Chat Agent 和 Pagelet Agent 共享同一能力层 | Operations 是基础能力，不绑定特定 Agent |
| D7 | 意图级确认 + 审计回滚，取代逐操作 4-gate | 降低摩擦、保持多步执行能力，同时通过 snapshot 保证可恢复 |
| D8 | 高风险操作在意图确认中明确标注，但不退化到操作级确认 | 平衡感知与效率 |
| D9 | 结构化 tool call 而非通用代码执行 | 类型安全、可预览、无 eval 风险、模型调用更可靠 |
| D10 | Pagelet Agent 走路径 B（展示 + 一键动作） | "安静且可信"——不自动改笔记，用户主动触发 |
| D11 | 命令执行不设 allowlist，用启发式风险标注 | 不同用户插件不同，硬编码不可维护，意图确认已覆盖 |
| D12 | 移动端无需额外适配，差异由 runtime 透明处理 | 所有选定 API 移动端可用 |
| D13 | 审计日志存储在 .obsidian/plugins/.../audit/ | 跟随 vault、不污染笔记空间、符合 Obsidian 惯例 |
| D14 | 30/90 天清理策略 + 可配置 | 峰值 ~3MB，成本可忽略 |
| D15 | 写工具按需加载，读工具常驻 | 避免无写操作时的 token 浪费和幻觉 |
| D16 | vault_process 精简为 3 种 operation（replace/insert/delete） | 最少原子操作，复杂场景靠多步组合 |
| D17 | 确认 UI 内联在对话/卡片中，非独立 modal | 不打断心流、不吓到用户 |
| D18 | 回滚分即时撤销（内联按钮）和历史回滚（Tab section） | 零导航成本 + 随时可追溯 |
| D19 | WAF 渐进过渡——新方案独立实现，验证后再清理旧代码 | 避免重构循环，降低风险 |
| D20 | Chat Agent 优先、Pagelet Agent 排队的调度规则 | 用户主动触发永远优先于后台 |
| D21 | 两 Agent 通过共享 insight cache 协作，不实时通信 | 简单可靠，松耦合 |
| D22 | 自定义 Skill（B-103）暂不考虑 | 先建好基础能力再评估 |
| D23 | 实施顺序：Operations → Pagelet Agent → Agent 协作 → 陪伴 | 依赖关系决定 |
| D24 | "陪伴"作为产品愿景层，所有技术组件为其服务 | 统一方向，不是独立 feature |
