# SDD Rollout Plan · Write Action Framework v1 + Pagelet v1

> 单文档规划：Write Action Framework v1（PA-level 写路径基础设施）+ Pagelet（Review Assistant）v1 的合并开发执行规划。
>
> 模式：**单人串切 · 双 worktree 物理隔离 · Step 0 锚点接口先行 · OQ002 spike 并行**

---

## 0 · Status

| 项 | 值 |
|----|----|
| 日期 | 2026-06-02 |
| 触发 | [[D025]] + [[D030]]；[[OQ001]] 升级为 Pagelet beta Hard Blocker |
| 依据 SDD | `docs/write-action-framework-sdd.md`（986 行）+ `docs/review-assistant-sdd.md`（819 行） |
| 执行模式 | 单人串切，双 worktree（`framework-impl` + `pagelet-non-write`），Step 0 锚点先行 |
| 估算总时长 | **~17-18 工作日**（与纯串行接近；worktree 主收益是心智隔离 + CR 拆分 + 测试隔离，不是时间节省） |
| 关键里程碑 | Pagelet beta `v2.(x+1).0-beta.1`（参 [[D013]]） |
| 主作者 | PA core |

> **本规划的范围**：how to execute（worktree 划分、子任务顺序、类型同步、风险缓解、验收）。
> **本规划不重复的内容**：each gate 的契约（→ framework SDD §2-§3）、PolicyEngine 改造 diff（→ framework SDD §4）、Pagelet 章节具体设计（→ pagelet SDD §2-§13）。本规划仅引用，不展开。

---

## 1 · 依赖分析与轨道划分

### 1.1 整体依赖图

```
        ┌────────────────────────────────────────────────────────────┐
        │   Step 0 (master, 0.5d 串行)                                │
        │   Framework 类型骨架 commit                                  │
        │   ──────────────────────────                                │
        │   并行：OQ002 spike (0.5-1d，可在 step 0 之后再做)            │
        └──────────────────────────┬─────────────────────────────────┘
                                   │ merge into master
              ┌────────────────────┴────────────────────┐
              ↓                                          ↓
   Track A · Framework 实现                    Track B · Pagelet 非写路径
   worktree: framework-impl                    worktree: pagelet-non-write
   ~6.5d                                        ~9d
   ┌────────────────────────────┐               ┌────────────────────────────┐
   │ Phase 2 PolicyEngine 参数化 │               │ B1 Structured Output       │
   │ Phase 3 4 模块实现          │               │ B2 UI Mascot+Card          │
   │ Phase 4 Runtime 集成        │               │ B3 Settings+i18n           │
   └────────────────────────────┘               │ B4 Cost Ceiling            │
                                                 │ B5 a11y+兼容性 R1/R2/R4    │
                                                 │ B6 文件结构+frontmatter    │
                                                 └────────────────────────────┘
              └────────────────────┬────────────────────┘
                                   │ both merged to master
                                   ↓
              Track C · 收敛与发布（master，~3d）
              C1 Pagelet 解 stub + 接 framework（1d）
              C2 E2E + bug fix（1d）
              C3 beta v2.(x+1).0-beta.1 发布（1d）
```

### 1.2 单人串切的真实收益

单人不能真正并行，"双 worktree" 不能像双人那样把总时长砍半。真实收益：

| 价值 | 说明 |
|------|------|
| **心智隔离** | framework 和 pagelet 改动不混合，写代码时不被无关 diff 分散注意力 |
| **CR/PR 友好** | 两个独立 PR，可分开 review、独立合并、独立 revert |
| **测试隔离** | A worktree 跑 framework 单测，B 跑 pagelet 单测，CI 配置可独立 |
| **回滚精度** | framework 出问题不污染 pagelet 分支，反之亦然 |
| **轻微时间节省** | 在 A 等 build/test/CI 时切到 B 写一段；Track C 解 stub 更快（~5-10%） |

### 1.3 Pagelet SDD 章节归 Track

| 类别 | Pagelet SDD 章节 | Track |
|------|----------------|-------|
| **强依赖 Framework**（C 阶段解 stub） | §2.4 `PageletToolProvider`、§3 PolicyEngine Changes、§5.2 写入路径、§6.1 R3、§14.1 OQ001 | C |
| **完全独立**（B 阶段并行） | §1 架构、§2.1-2.3、§4 Structured Output、§5.1/5.3/5.4、§6.1 R1/R2/R4、§6.2-6.3、§7 Cost、§8 i18n、§9 a11y、§10 UI、§11 Telemetry、§12 测试、§13 Rollout | B |

### 1.4 Framework SDD §9 Rollout 落地映射

| Framework SDD Phase | 本规划落地 |
|---------------------|----------|
| §9 Phase 1: 类型与最小契约 | **Step 0**（master 串行） |
| §9 Phase 2: PolicyEngine 参数化 | **Track A · A1** |
| §9 Phase 3: 4 模块实现 | **Track A · A2** |
| §9 Phase 4: Runtime 集成 + Pagelet 接入 | **Track A · A3**（Runtime 部分）+ **Track C · C1**（Pagelet 接入部分） |
| §9 Phase 5: Pagelet beta 发布 | **Track C · C3** |

---

## 2 · Step 0 · 锚点接口先行（master，0.5d）

### 2.1 内容

**单次 commit，落 master，不开 worktree。** 包含：

```ts
// src/ai-services/write-action-framework/types.ts (NEW)
export type ActionFamily = "create-file"; // v1 仅一种
export interface WriteActionCapability extends AgentCapability {
    kind: "action";
    requiresConfirmation: true;
    actionFamily: ActionFamily;
    targetCategory: string;          // debug emit 分类
    buildPreview(input: AgentCapabilityInput): Promise<PreviewSpec>;
    executeWrite(
        input: AgentCapabilityInput,
        ctx: AgentCapabilityContext,
        hooks: WriteActionExecuteHooks
    ): Promise<AgentCapabilityResult>;
    rollback?(input: AgentCapabilityInput, ctx: AgentCapabilityContext): Promise<void>;
}
export interface PreviewSpec {
    target: { path: string; category: string };
    contentMarkdown: string;
    impact: string;
    risk: string;
    action: string;
}
export type ConfirmationOutcome = "confirmed" | "cancelled" | "closed" | "aborted";
export interface WriteActionExecuteHooks {
    markSelfWrite(path: string): void;
}
export type DebugEventType =
    | "gate.target-confinement.ok" | "gate.target-confinement.reject"
    | "gate.preview.shown"          | "gate.confirmation.received"
    | "gate.stale-reread.ok"        | "gate.stale-reread.drift"
    | "execute.ok"                  | "execute.fail"
    | "rollback.ok"                 | "rollback.fail";
export interface DebugEvent {
    type: DebugEventType;
    capabilityId: string;
    runId: string;
    turnId: string;
    durationMs?: number;
    errorCategory?: "rejected_at_confinement" | "fs_error" | "policy_violation" | "unknown";
    extra?: Record<string, unknown>;
}
export interface DebugObserver { emit(event: DebugEvent): void; }

// src/ai-services/capability-types.ts:23
export type AgentPermissionFuture =
    | /* existing literals */
    | "local-filesystem-write";

// src/ai-services/policy-engine.ts (struct only, behavior 留 Track A · A1)
export interface PolicyEngineOptions {
    runKind?: "chat" | "review";
    allowWrite?: boolean;
    allowedActionPermissions?: AgentPermissionFuture[];
    debugObserver?: DebugObserver;
}
```

**Placeholder commit 策略：** `policy-engine.ts` 内的 `kind="action"` 拒绝逻辑暂保留原状（chat backward-compat），仅扩 `PolicyEngineOptions` 字段。`pa-agent-runtime.ts:478` 构造点不动。Track A · A1 来实现行为。

### 2.2 OQ002 Spike（并行 0.5-1d）

可与 Step 0 同期推进（不互相阻塞，因为 spike 改动局限于一个独立验证脚本，不动 framework 类型）：

| 内容 | 说明 |
|------|------|
| 目标 | 验证 D026 的 LangChain `withStructuredOutput` 在 Qwen/DashScope / Bailian / OpenAI-compatible 三 provider 的真实兼容性 |
| 产出 | 一份 `tmp/oq002-spike-report.md`，含每 provider 10 样本的 schema 命中率 + 失败模式 |
| 失败回路 | 若任一 provider 命中率 < 70%，Track B · B1 推迟，重开 D026 review |
| Done 标志 | 报告 commit 到 master 或 worktree；Pagelet decisions.md OQ002 状态从 Open → Resolved |

### 2.3 Step 0 验收

- [ ] `git checkout master && yarn tsc --noEmit` 编译通过
- [ ] 两 worktree（在 §3.1 / §4.1 创建后）`import { WriteActionCapability } from "src/ai-services/write-action-framework/types"` 编译通过
- [ ] OQ002 spike 报告产出，结论"可继续 B1" 或"重开 D026"

---

## 3 · Track A · Framework 实现（worktree, ~6.5d）

### 3.1 Worktree 设置

```bash
git worktree add .claude/worktrees/framework-impl -b feat/write-action-framework-v1 master
cd .claude/worktrees/framework-impl
```

| 项 | 值 |
|----|----|
| 路径 | `.claude/worktrees/framework-impl` |
| 分支 | `feat/write-action-framework-v1` |
| 基线 | master @ Step 0 commit |
| 文件域（可写） | `src/ai-services/write-action-framework/**`、`src/ai-services/policy-engine.ts`、`src/ai-services/pa-agent-runtime.ts` |
| 文件域（禁碰） | `src/pagelet/**`、`src/ui/pagelet/**`、`src/locales/pagelet/**`、`src/settings/pagelet/**` |

### 3.2 子阶段

#### A1 · PolicyEngine 参数化（~1d）

- 实现 framework SDD §4.1 完整 diff
- 单测：framework SDD §4.4 决策矩阵 9 行
- Smoke：chat runtime（无 `runKind` / `allowWrite` 参数时）行为 0 回归

#### A2 · 4 模块实现（~2.5d）

按 framework SDD §2 顺序：
1. `target-confinement.ts` + unit（path normalize / allowlist / traversal / 控制字符 / 扩展名 / 长度 / collision）
2. `preview-modal.ts`（generalize `memory-manager.ts:612-679` MemoryApprovalModal）+ unit（5 区块渲染 / 4 outcome / mutex 串行）
3. `stale-reread.ts`（mode A only：target snapshot + re-check）+ unit
4. `debug-observer.ts`（Noop + Console 实现）+ unit（10 event type emit 正确）

外加 `runtime-integration.ts`：
- `recentlySelfWrittenPaths` Set + `markSelfWrite` / `isRecentSelfWrite`（5s TTL）
- ActionExecutor 串联 4 gates（含每 gate 转换点 debug emit）

#### A3 · Runtime 集成（~1d）

- Modify `pa-agent-runtime.ts:478`：PolicyEngine 构造点传入 `runKind` + `allowWrite` + `debugObserver`（dev=Console, prod=Noop）
- Modify `pa-agent-runtime.ts:572-589`：toolExecutor wrap，对 `WriteActionCapability` 路由到 ActionExecutor
- 集成测试：framework-only happy path（不依赖 Pagelet 真实 caller，用 mock capability 验证 4-gate 流转）

### 3.3 验收（Track A Done）

- [ ] `yarn test src/ai-services/write-action-framework` 全绿
- [ ] `yarn test src/ai-services/policy-engine.spec.ts` 全绿（含新加 9 行决策矩阵）
- [ ] chat runtime smoke：现有 PA agent loop 不受影响
- [ ] `gh pr create` 开 PR，CI 通过
- [ ] PR 标题：`feat(ai-services): write action framework v1`

---

## 4 · Track B · Pagelet 非写路径（worktree, ~9d）

### 4.1 Worktree 设置

```bash
git worktree add .claude/worktrees/pagelet-non-write -b feat/pagelet-non-write master
cd .claude/worktrees/pagelet-non-write
```

| 项 | 值 |
|----|----|
| 路径 | `.claude/worktrees/pagelet-non-write` |
| 分支 | `feat/pagelet-non-write` |
| 基线 | master @ Step 0 commit |
| 文件域（可写） | `src/pagelet/**`、`src/ui/pagelet/**`、`src/locales/pagelet/**`、`src/settings/pagelet/**` |
| 文件域（禁碰） | `src/ai-services/**`、`src/pa-agent-runtime.ts`（Track A 单方持有） |

### 4.2 子任务串行顺序（单人）

```
B1 Structured Output (2.5d)
   ↓
B2 UI Mascot+Card (2d)         [可与 B3 互换：依赖 B3 i18n key 才能渲染最终文案]
   ↓
B3 Settings+i18n (1.5d)        [B4/B5 配置项依赖 B3 注册 i18n key]
   ↓
B4 Cost Ceiling (1.5d)
   ↓
B5 a11y + 兼容性 R1/R2/R4 (1.5d)
   ↓
B6 文件结构+frontmatter (0.5d)
```

**顺序理由：**
- B1 先做，因 B2 渲染的 SuggestionCard 内容依赖 B1 的 structured output schema
- B3 在 B4/B5 之前，因 cost / a11y 提示文案需要 i18n key 注册
- B6 收尾，因文件 IO 不依赖其他子任务但被 Track C 接入用

**可调整空间：** B2 ↔ B3 可互换（先 B3 注册 key，B2 直接渲染最终文案）。其他顺序建议保持。

### 4.3 各子任务详细

| 子任务 | Pagelet SDD 依据 | 关键文件 | 验收 |
|--------|----------------|---------|------|
| **B1 Structured Output** | §2.2 + §4 全部 | `src/pagelet/pa-review-model.ts`、`src/pagelet/pa-review-schemas.ts` | zod schemas 编译；3 provider 模拟测试通过；失败矩阵 8 行 fallback 触发正确 |
| **B2 UI Mascot+Card** | §10.1 + §10.2 | `src/ui/pagelet/mascot/*`、`src/ui/pagelet/suggestion-card/*` | Mascot 4 状态渲染（idle/thinking/done/error）对照 `pagelet-visual-spec.html`；SuggestionCard 5 区块渲染 |
| **B3 Settings+i18n** | §10.3 + §8 全部 | `src/settings/pagelet/*`、`src/locales/pagelet/{en,zh}.json` | Settings 页面 7 配置项（advanced 含 reviews folder）；EN/ZH 全数 i18n key 覆盖；语言检测 regex 单测 |
| **B4 Cost Ceiling** | §7 全部（D018-D023） | `src/pagelet/pa-review-cost.ts`、`src/pagelet/pa-review-rate-limit.ts` | token 限额（8K/2K → 36K hard cap）、call 计数（hr/day cap）、触达上限、review note 费用 metadata；Pagelet panel session total |
| **B5 a11y + 兼容性** | §6.1 R1/R2/R4 + §6.2 + §9 | `src/pagelet/compat/*`、`src/ui/pagelet/mascot/*` | R1 view-type gating；R2 debounce + idempotent；R4 ribbon hidden/default；prefers-reduced-motion；aria-live；Cmd+/ 焦点跳入 |
| **B6 文件结构+frontmatter** | §5.1 + §5.3 + §5.4 | `src/pagelet/pa-review-file-io.ts` | `.pagelet/` 路径创建；`{原笔记名}-pagelet-review-{YYYY-MM-DD}.md` 命名；frontmatter `pagelet: true`；自定义路径 settings 联动 |
| **Workbench convergence** | 产品 V1 scope/workbench | `src/pagelet/scope.ts`、`src/pagelet/view.ts`、`src/plugin.ts` | Current/yesterday/last3/last7 scope；included/skipped 手动调整；multi-note source_id map；source jump；related-note open；editable draft restore；Research → Chat prefill |

### 4.4 Stub 策略（B 阶段写路径处）

B6 文件 IO 涉及"创建 review note"，这是 Track C 解 stub 的关键点。B 阶段做法：

```ts
// src/pagelet/pa-review-tool-provider.ts (B 阶段)
import type { WriteActionCapability, PreviewSpec } from "src/ai-services/write-action-framework/types"; // ✅ Step 0 已稳定

export class PaReviewToolProvider implements CapabilityProvider {
    // ... 其他 read-only capability 正常实现

    // STUB: write_review_output 暂不注册，Track C C1 启用
    // TODO(framework-merge): 在 C1 阶段启用此 capability 注册
    private writeReviewOutputCapability: WriteActionCapability = {
        // ... 真实声明（编译通过），但不 register 进 CapabilityProvider
    };
}
```

**B6 子任务的 file IO 函数（buildPreview / executeWrite）可以实现完整逻辑**，因为 framework 类型在 Step 0 已稳定；只是不挂到 `CapabilityProvider.list()` 返回里，等 C1 接入。

### 4.5 验收（Track B Done）

- [ ] `yarn test src/pagelet` + `yarn test src/ui/pagelet` 全绿
- [ ] B2 storybook 渲染对照 `pagelet-visual-spec.html` 通过 visual review
- [ ] B3 i18n EN/ZH 全数 key 覆盖（`yarn check-i18n` 通过）
- [ ] `gh pr create` 开 PR，CI 通过
- [ ] PR 标题：`feat(pagelet): non-write path (UI / i18n / cost / a11y / file-io)`
- [ ] PR 描述明确：write capability 注册留 Track C C1 解 stub

---

## 5 · Track C · 收敛与发布（master，~3d）

### 5.1 C1 · Framework merge → Pagelet 解 stub（~1d）

**前置：** Track A PR + Track B PR 都已 CI 通过且 review 通过

**操作顺序：**

```bash
# 1. 先 merge Framework PR
gh pr merge <framework-pr-id> --squash

# 2. Pagelet worktree rebase 到最新 master
cd .claude/worktrees/pagelet-non-write
git fetch origin master
git rebase origin/master  # 应无冲突，文件域已隔离

# 3. 解 stub：启用 writeReviewOutputCapability 注册
#    去掉 TODO(framework-merge) 标记
#    在 PaReviewToolProvider.list() 返回里加上 writeReviewOutputCapability

# 4. 更新 Pagelet 的 modify listener 用 framework.isRecentSelfWrite
#    （SDD §5.2 + §6.1 R3 落地）

# 5. push + 等 CI + merge
git push -u origin feat/pagelet-non-write
gh pr merge <pagelet-pr-id> --squash
```

**关键检查：**
- [ ] `pa-agent-runtime.ts` 在 Pagelet rebase 时无冲突（因 Track B 不动该文件）
- [ ] `policy-engine.ts` 在 Pagelet rebase 时无冲突（同上）
- [ ] `capability-types.ts` 的 `AgentPermissionFuture` 已含 `"local-filesystem-write"`（Step 0 落定）

### 5.2 C2 · E2E + bug fix（~1d）

直接在 master 上跑 E2E（不再开 worktree）：

| 测试 | 内容 |
|------|------|
| `e2e-pagelet-write.spec.ts` | LLM → 5 区块 preview modal → 用户 confirm → `.pagelet/` 出文件 → cost metadata |
| Self-write 不循环 smoke | framework write → Pagelet modify listener 跳过 → 不再次召唤 |
| Cancel / abort 路径 | preview modal 关闭 / ESC / cancel → 无文件、无 debug emit `execute.*` |
| Prompt-injection fixture | 5 个 fixture（framework SDD §8.3）全部被 Gate 1 拒绝 |
| Obsidian 真实 vault | desktop 跑当前 beta 完整流；mobile 作为 post-beta/full-panel follow-up |

发现的 bug 在 master 直接修，commit message 标 `fix(pagelet|framework): ...`

### 5.3 C3 · Beta 发布（~1d）

1. 版本号：`v2.(x+1).0-beta.1`（参 [[D013]]，x 取当前 minor）
2. CHANGELOG 加：
   ```markdown
   ## v2.(x+1).0-beta.1
   ### Beta Features
   - Pagelet (Beta) - your note's quiet reviewer
   - Write Action Framework v1 (PA-level infrastructure)
   ```
3. 更新文档：
   - `docs/review-assistant-decisions.md`：OQ001 状态 `Hard Blocker` → `Resolved`，新增 D031（framework 实现完成）
   - `docs/review-assistant-sdd.md`：§0 status + §14.1 解阻塞标记
   - `docs/write-action-framework-sdd.md`：§0 status 加"已实现" 标
4. Release SOP：沿用 PA `docs/release-process.md`
5. 公告渠道：GitHub Release notes + Obsidian Community Plugins description 更新（D011 已定）

### 5.4 验收（Track C Done / 项目交付）

- [ ] `v2.(x+1).0-beta.1` 已 publish 到 Obsidian Community Plugins
- [ ] OQ001 状态 Resolved
- [ ] CHANGELOG 含 Pagelet beta 章节
- [ ] beta 反馈渠道（D012）就绪（GitHub Issues + 表单）

---

## 6 · Worktree 操作 SOP

### 6.1 创建（Step 0 完成后执行）

```bash
# 在主 working tree（PA 仓库根）执行
git worktree add .claude/worktrees/framework-impl -b feat/write-action-framework-v1 master
git worktree add .claude/worktrees/pagelet-non-write -b feat/pagelet-non-write master
```

### 6.2 切换

直接 `cd` 即可。每个 worktree 是独立的 working directory，编辑器（VS Code / Cursor）建议各开一个窗口。

```bash
cd .claude/worktrees/framework-impl    # Track A
cd .claude/worktrees/pagelet-non-write # Track B
```

### 6.3 同步 master（如 Step 0 后又 commit 了修复）

```bash
cd <worktree>
git fetch origin master
git rebase origin/master   # 应无冲突，因文件域隔离
```

### 6.4 心智切换节奏建议

| 反模式 | 推荐 |
|--------|------|
| 写 30 分钟 A，切到 B 写 30 分钟，再切回 A | 单次切换至少完成一个**完整子任务**（B1 / B2 / ... 或 A1 / A2 / A3） |
| 每天切来切去 | 一天一个 worktree 为单位 |
| 在 A worktree 改了 framework，又跑去 B worktree 改 pagelet 引用 | 不允许跨 worktree 改同一类文件；类型如需扩展，先回 master commit 扩展 |

### 6.5 清理（C3 完成后）

```bash
git worktree remove .claude/worktrees/framework-impl
git worktree remove .claude/worktrees/pagelet-non-write
git branch -d feat/write-action-framework-v1 feat/pagelet-non-write
```

（**当前 worktree `review-pagelet-design` 不在清理范围**，它是 SDD 设计专用，保留到所有设计文档定稿）

---

## 7 · 类型同步策略详解

### 7.1 Step 0 锚点的作用

Step 0 commit 把 framework 的**所有公开 API 类型**冻结到 master。两 worktree 都引用这份冻结类型，不会出现 drift。

### 7.2 接口变更流程（如 Track A 实现时发现 Step 0 不够）

```
[Track A 发现接口需扩展]
        ↓
[暂停 Track A 当前 task]
        ↓
[切回 master 主 working tree]
        ↓
[扩展 types.ts，commit + push]
        ↓
[Track A 和 Track B 都 git fetch + rebase]
        ↓
[继续各自工作]
```

**禁止：** 在 Track A worktree 内直接改类型而不同步给 Track B。

### 7.3 Placeholder commit 策略（防 merge 冲突）

`pa-agent-runtime.ts` 是 Track A 的核心改动文件，Track B 完全不碰。但为了让 Track B rebase 顺利，**Step 0 commit 不要动这个文件**——Track A 在 A3 阶段才动，那时 Track B 也快完成，rebase 时 Track A 的改动还没 merge 进 master，Track B 的 PR 不会冲突。

时序保证：
- Step 0：仅动 `types.ts`（新文件）+ `capability-types.ts:23`（追加 1 行）+ `policy-engine.ts`（追加字段）
- Track A 全程动 `policy-engine.ts` 行为 + `pa-agent-runtime.ts` 集成点
- Track B 全程**不碰** `src/ai-services/**`
- Track A merge 后 Track B rebase：仅有可能冲 `capability-types.ts`（若 Track A 又加了字面量），其他 0 风险

---

## 8 · 风险登记与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Framework 类型在 Step 0 后需 breaking 改动 | 中 | Track B 已写代码需返工 | Step 0 前在对话 review 一次 types.ts 完整快照；锁定后再 commit |
| OQ002 spike 三 provider 中 ≥ 1 个不兼容 | 中 | B1 需重写 / D026 重拍 | spike 与 Step 0 并行，最坏情况推迟 B1 到 Track C，其他 B 子任务继续 |
| `policy-engine.ts` Track A vs Step 0 merge 冲突 | 低 | 修复 ~30min | Step 0 仅扩字段不改逻辑；Track A 改逻辑时基于 Step 0 commit |
| Pagelet UI 视觉偏差 | 低 | 返工 ~1d | B2 早期对照 `pagelet-visual-spec.html` 做 storybook visual review |
| Track A 比 Track B 早完成、空等 | 中 | 时间浪费 | Track A 提前进入 C2 E2E 准备（写 fixture / mock）；不阻塞但不能 merge |
| Track B 比 Track A 早完成、空等 | 中 | 时间浪费 | Track B 提前进入 Track C 准备文档（CHANGELOG draft / release notes draft） |
| 单人切换上下文 thrash | 中 | 效率 ↓ 20% | 按 §6.4 节奏，单次切换至少完成一个完整子任务 |
| `pa-agent-runtime.ts` 在 C1 rebase 冲突 | 低 | 修复 ~30min | Track B 全程不动该文件；Track A merge 后 Track B rebase 仅类型 import 调整 |
| Beta 上线后 P0/P1 bug | 低 | 紧急 hotfix | sentry/issue 上报机制；按 D013 graduate 标准要求"连续 2 个 -beta.N 无 P0/P1" |

---

## 9 · 时间线 / 估算汇总

| 阶段 | 估时 | 累计 | 备注 |
|------|------|------|------|
| Step 0（含 OQ002 spike 并行） | 1d | 1d | master 串行 |
| Track A · A1 PolicyEngine | 1d | 2d | worktree-framework-impl |
| Track A · A2 4 模块 | 2.5d | 4.5d | worktree-framework-impl |
| Track A · A3 Runtime 集成 | 1d | 5.5d | worktree-framework-impl |
| **Track A 完成（PR 待 review）** | — | **5.5d** | — |
| Track B · B1 Structured Output | 2.5d | 8d | 单人切到 worktree-pagelet |
| Track B · B2 UI Mascot+Card | 2d | 10d | |
| Track B · B3 Settings+i18n | 1.5d | 11.5d | |
| Track B · B4 Cost Ceiling | 1.5d | 13d | |
| Track B · B5 a11y+兼容性 | 1.5d | 14.5d | |
| Track B · B6 文件结构 | 0.5d | 15d | |
| **Track B 完成（PR 待 review）** | — | **15d** | — |
| Track C · C1 解 stub | 1d | 16d | master |
| Track C · C2 E2E + bug fix | 1d | 17d | master |
| Track C · C3 Beta 发布 | 1d | 18d | master |
| **项目交付（v2.(x+1).0-beta.1 上线）** | — | **18d** | — |

**理想化压缩（A/B 部分时段交错切换）：** ~16-17d
**保守缓冲（含 review 等待 / bug 修）：** ~20-22d

---

## 10 · 决策追溯

| 决策 / 文档 | 本规划对应章节 |
|-------------|--------------|
| [[D025]] Pagelet B-full 写路径策略 | §1.3 章节归类 / Track C |
| [[D030]] 二层命名 + 框架先行 + Pagelet beta 硬阻塞 | §0、§1 整体、§5.3 |
| [[OQ001]] Write Action Framework v1 SDD Hard Blocker | §0、§5.3（解阻塞） |
| [[OQ002]] F5 Provider 兼容性 spike | §2.2 |
| [[D013]] Release Channel 策略 | §5.3 |
| [[D026]] Structured Output 实现 | Track B · B1 |
| [[D029]] F29 兼容性 R1-R4 | Track B · B5（R1/R2/R4）+ Track C · C1（R3 通过 framework self-write Set） |
| `docs/write-action-framework-sdd.md` §9 Rollout | §1.4 phase 映射 |
| `docs/review-assistant-sdd.md` §13 Rollout | §5.3 沿用 SemVer / CHANGELOG / 反馈渠道 |

---

> 文档结束。落地后需同步更新：
> - `docs/review-assistant-decisions.md`：OQ001 → Resolved，新增 D031（framework 实现完成）
> - `docs/review-assistant-sdd.md`：§0 / §2.4 / §3 / §7 / §14.1 去 stub
> - `docs/write-action-framework-sdd.md`：§0 status 加"已实现"标
> - 本文件 §9 timeline 加"实际耗时"对照列，便于未来项目估算校准
