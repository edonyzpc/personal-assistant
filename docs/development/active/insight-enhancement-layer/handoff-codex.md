# B-119 Insight Enhancement Layer — Codex Handoff

Document status: Current
Updated: 2026-07-21
Work item: B-119
Implementation authority: Not granted
Authority: 工程导航与已核对的源码约束；产品行为以 DEC-022、DEC-023、Product Spec 和 Approved SDD 为准。
Decision: [DEC-022](../../../product/decisions/dec-022-bounded-insight-enhancement-layer.md)
Provider trust decision: [DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)
Product spec: [PA Insight Enhancement Layer Product Spec](../../../product/specs/pa-insight-enhancement-layer-product-spec.md)
Plan: [Delivery Plan](./plan.md)
Tracker: [Development Tracker](./tracker.md)

## 0. Stop Point And Direct Instructions

1. 当前只完成产品决定与 plan-only package。没有用户明确的 runtime 实现授权时，
   **不得修改 TypeScript、tests、CSS、locales 或 settings**。
2. 获得实现授权后，先读根 `AGENTS.md`、North Star、DEC-022、DEC-023、Product Spec、Plan、
   Tracker 和本 handoff，并复核工作树；任何文档与源码冲突先记入 Tracker。
3. 先创建并批准 `sdd.md`，完整映射 B-119/REQ-01..03/05..06 与 AC-01..10。没有
   Approved SDD 不开始 runtime coding。
4. 按 Shared foundation → Graph → Pattern → Maintenance → Integration 顺序交付；每个
   slice 完成 focused test/review/fix 后再前进。
5. 本 handoff 不授权 commit、push、tag、publish 或 release。若之后获准 commit，使用
   signed Conventional Commits，按最小模块拆分，不加 `Co-Authored-By`。
6. 不顺手重构 Pagelet、改 Graph taxonomy、改 Memory 等独立高后果流程或扩大
   Maintenance/WAF 权限；跨出 B-119 就停下记录。

## 1. Non-negotiable Contract

| Area | Required | Forbidden |
| --- | --- | --- |
| Result layering | 结构 scan 先完成；AI 只补充，失败 deep-equal fallback | 删除、覆盖或重排结构结果 |
| Evidence | 输出 path 必须来自本次 allowed input；每个 claim 打开原始 source | 用 VSS score 或上游 AI claim 代替证据 |
| Provider trust | Scope Recap/Quiet Recall/Discover 与 B-119 standard bounded paths 共享 first-use non-blocking notice；默认继续 eligible run | capability modal、第二套 authorization/first-use flag、重置 shared notice |
| Broad runs | broad/sensitive/costly/excluded override 先 `run/adjust/cancel` | 未确认 whole-vault 或 hidden expansion |
| High-consequence authority | Memory Prepare/Update、Memory admission、vault write、Markdown 与 external action 继续使用各自合同 | 把 shared provider notice 当作 Memory/write/action 权限 |
| Persistence | ephemeral AI overlay；Keep/Later 走既有合同 | hidden raw output/excerpt/prompt、自动 Queue/Ledger/Memory |
| Maintenance | title/link/folder 先 preview；合法 folder 可显式转现有 move preview | AI 直接改 executable proposal、rename/link/create/apply |
| Coupling | 只共享 dedupe ID、结构类型、source identity | Pattern AI claim → Graph/Maintenance 事实链 |
| UI | 复用现有 Graph/Pattern/Maintenance surface 并更新 clone/render/locales | Writing section 或新顶层入口 |

## 2. Verified Source Map

### 2.1 Plugin integration owns the pipeline

当前 `src/plugin.ts` 已同时拥有来源内容、结构函数和 Pagelet host adapter：

- `runGraphDiscovery()`：收集 active note 同文件夹最多 40 篇，调用
  `discoverLightweightGraphItems()` 后把结果交给 orchestrator。
- `runMaintenanceReview()`：按 current note / same folder / recent 7 days 最多 50 篇
  收集 allowed notes，调用 `scanMaintenanceReview()`。
- `maybeRunPatternDetectionNudge()`：检查 Pagelet、proactive hints、Focus Mode 和 3 天
  cooldown，再调用 Pattern 检测并交给 orchestrator。

因此 enhancer 应是 plugin-private pipeline，并显式接收：

```ts
{
    structuralResult,
    sourceNotes,
    runKind,
    sourceEnvelope,
    abortSignal,
}
```

不要新增 `PageletHost.enhanceGraphDiscovery()`、`enhancePatternDetection()` 或
`enhanceMaintenanceReview()`。`PageletHost` 继续暴露现有用户入口即可。

### 2.2 Rate/cost and provider disclosure

`PageletRateLimiter` 的真实构造是 options object：

```ts
new PageletRateLimiter({
    storage,
    config: { hourlyCap, dailyCap },
    coordinationKey,
});
```

SDD 必须定义独立的 background/manual persisted buckets、reserve 原子性、失败调用计数
和 retry policy。不要直接照搬旧 handoff 的 `constructor(config, storage, options)`。

`PageletCostEntry["feature"]` 当前是封闭 union。实现时必须能区分 Graph、Pattern、
Maintenance 与 run kind；一个笼统的 `insight-enhancement` tag 不足以验证三项开关和
成本归因。若 VSS search 触发 embedding/provider，另记 actual call，不算进“一次
generation call”描述。

provider first-use 复用 `settings.pagelet.pageletProviderFirstUseNotified` 及现有 Pagelet
通知路径。[DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)
已明确 Scope Recap、Quiet Recall、Discover 与 B-119 Graph、Pattern、Maintenance 在各自
standard bounded envelope 内共用这一通知语义。**不得**新增、迁移或重置
`insightEnhancement.firstUseNotified`、Scope Recap 专属 authorization 或 shared notice；
已经在任一 Pagelet capability 看过 shared notice 的用户不会再看到 B-119 专属 notice。

**Current runtime dependency（2026-07-21）**：上述段落是必须达到的产品/SDD 合同，
不是当前实现完成声明。只读复核发现 fresh install 仍被旧 Scope Recap authorization
tuple 置为 preparation off；Quiet Recall 的通知早于“确定会调用 provider”，Discover
也尚未进入同一 actual-call gate。实现 B-119 前必须先关闭/复用 B-118 F-03/F-10，或在
同一 shared foundation slice 中原子协调；不得在 B-119 叠加第二套 flag/helper。

shared notice 只表示 provider 数据/成本透明告知，不授予高后果权限。Memory
Prepare/Update、Memory admission、vault mutation、Markdown 和 external action 继续遵守
各自的明确确认合同；B-119 SDD/实现不得修改、复用或绕过这些独立 gate。

### 2.3 UI state must survive the full route

新数据不能只停留在 domain type。每个 slice 同时检查：

- `src/pagelet/panel/types.ts`
- `src/pagelet/tab/types.ts`
- `src/pagelet/tab/TabView.ts`
- `src/pagelet/tab/sections/MaintenanceReviewSection.ts`
- `src/pagelet/tab/PageletDetailView.ts` 的 deep clone / rehydrate
- `src/pagelet/orchestrator.ts` 的 extra mapping
- `src/locales/pagelet/en.json` 与 `zh.json`
- `__tests__/pagelet-panel-tab-view.test.ts` 与相邻 orchestrator tests

Graph/Pattern 可在现有 result 上添加明确 optional enhancement payload，但要验证旧
fixture/clone。Maintenance 应使用独立 `MaintenanceInsightOverlay`（以 proposal/source
identity 关联），不要给可执行 `MaintenanceProposal` 添加 AI 文本后再尝试绕过
`hasForbiddenPersistedTextFields()`。`@internal` 不提供 runtime 持久化保护。

## 3. Source Envelopes And Output Contracts

| Feature | Local candidate envelope | Provider envelope | Output bound |
| --- | --- | --- | --- |
| Pattern | 复用当前最近 14 天、最多 80 篇、至少 5 篇、3 天 cooldown；仍受 Pagelet/proactive/Focus gate | local narrowing 后最多 12 excerpts；4K input + 1K output；最多一次 generation | 每个结构 pattern 最多一句 semantic insight；新 semantic candidates ≤3，每条 distinct sources ≥2 |
| Graph | 复用 active note 同文件夹最多 40 篇；VSS 最多 3 个 seed 查询并保持 Data Boundary | 最多 12 excerpts；8K input + 2K output；最多一次 generation | 只用四种现有用户类型；AI items ≤5，结构在前；conflict 显示两侧证据 |
| Maintenance | 复用 active/same-folder/recent-7-days 最多 50 篇的本地 scan | 本地候选缩小到最多 12 excerpts；8K input + 2K output；最多一次 generation | title/link/folder overlay；无合法 allowlisted target 就省略；不改变 action payload |

“最多 12 excerpts”是 provider 输入上限，不是把当前 local corpus 截成前 12 篇后再做
结构 scan。source path 必须 normalized、在本次 allowlist、仍满足 Data Boundary；模型
返回未知、excluded、generated 或 stale path 时丢弃整条 claim。

## 4. Suggested Ephemeral Model

具体名字由 SDD 决定，但类型边界至少分成三层：

```ts
type InsightSourceRef = {
    path: string;
    sourceHash: string;
};

type InsightEnhancementArtifact<T> = {
    runId: string;
    runKind: "background" | "foreground";
    generatedAt: string;
    dataBoundarySnapshotId: string;
    sourceRefs: InsightSourceRef[];
    value: T;
};

type MaintenanceInsightOverlay = {
    proposalId?: string;
    sourceRefs: InsightSourceRef[];
    suggestedTitle?: string;
    suggestedFolder?: string;
    relatedNote?: { path: string; reason: string };
};
```

- artifact 默认只在当前 Pagelet result/payload 生命周期存在。
- prompt/raw output/source excerpts 不进入 settings、Review Queue、Graph state 或
  Maintenance action log。
- user `Keep/Later` 时只把经过现有 Saved Insight contract 允许的摘要和 sources 交给
  既有 flow；不复用 raw model payload。
- folder overlay 的 CTA 先重新读取当前文件、normalize/allowlist/boundary/stale check，
  再构造既有 move preview；第二次明确确认才可 apply。title/link 永远没有 apply CTA。

## 5. Slice Checklist

### Shared foundation

- 定义 model invoker，使返回值同时包含 text/structured output、usage、provider/model、
  terminal outcome；`string | null` 不足以支持真实成本归因。
- prompt builder 接受截断后的 allowlisted excerpts；response parser 严格 JSON/schema，
  对路径做 exact allowlist validation。
- 定义 background/manual rate buckets、实际调用计数、AbortSignal、run identity、
  in-flight 去重和 late-result discard。
- 设置包含三个独立 capability opt-out，默认 true；Pattern 仍受父级 gate。
- 复用 shared provider notice；broad cancel 必须是 provider/cost/settings mutation 全 0。

### Graph

- local structure/VSS 先产生 candidates；VSS 未就绪只跳过语义候选，不触发 Memory
  prepare/rebuild。
- 只输出 `related_note`、`theme_chain`、`conflict_pair`、`index_note_candidate`；
  VSS score 只用于候选或同质量 tie-break。
- 结构 items 固定在前；AI item stable ID 来自类型 + normalized source set，并去重。
- index outline 只预览，不创建 MOC、link、edge 或 rerank influence。

### Pattern

- 修改 collection seam 以同时保留 source notes 与 structural result；不要让 result 自身
  携带正文。
- 结构 pattern 可有不覆盖原 summary/type/sourceRefs 的 semantic explanation。
- 结构 patterns 为空但 eligible corpus 足够时，仍允许寻找语义 candidate；不要用
  `no-structural-input` 直接 skip。
- 新候选使用独立 semantic type；不能伪造三种结构 patternType。
- 一轮最多 delivery 一个最高质量 Pattern nudge，不堆卡。

### Maintenance

- scan 先完成；AI 是 supplement，不替换 weak-link/title/inbox structural proposals。
- overlay display-only，不能修改 `actionType`、preview/undo/executable fields。
- suggested folder 只来自 allowed existing folders；related path 只来自 allowed notes。
- 用户选择合法 folder 后才进入既有 move preview/confirm/undo；所有其他 AI suggestion
  的 apply/write/queue/action-log delta 为 0。

### Integration

- cross-feature 只共享 structural type、normalized source set 和 dedupe fingerprint。
- 打开 Detail/View 对现有 artifact 的 provider call delta 为 0。
- scope change、newer run、abort、Focus/setting disable、view close、plugin unload 后，
  迟到结果不得覆盖或重新 nudge。
- ordinary UI 使用“来源”“范围”“暂未发现”等产品语言，不显示 VSS、embedding、
  rate limiter 或 schema。

## 6. Validation Gates

每个 slice 先运行最接近的 focused suites；最终 gate：

```bash
npm test -- --runInBand
npm run lint
npx tsc -noEmit -skipLibCheck
npm run build
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

UI/runtime confidence 使用 `make deploy` 和真实 Obsidian test vault。若 UI 有实质变化，
按 repo skill 执行 desktop 与物理 iPhone smoke；测试、DOM 或 Inspector 不能冒充用户
手指/视觉证据。记录真实 provider smoke 的 note scope、generation/VSS actual calls、
token/cost 和 terminal outcome。

## 7. Stop Conditions During Implementation

遇到以下任一情况停止对应 slice并更新 Tracker，不自行扩大范围：

- 需要 whole-vault 默认扫描、跨 Data Boundary 或隐含 included scope。
- 需要持久化 raw output/excerpts，或让 AI edge/claim 自动影响后续检索。
- 需要 AI rename/link/create/rewrite/batch move 或新的 write action。
- 需要 Writing/Statistics section、周期任务或顶层入口。
- 需要重置 shared provider notice，或为已纳入 DEC-023 的 Scope Recap/Quiet Recall/
  Discover 另建首次状态。Memory 等独立高后果流程仍按各自合同处理；若要改变这些
  独立合同或为新 feature 建例外，先停止并补产品决定。
- 无法在一次 generation call 和 provider envelope 内达到可用质量；先用证据复议预算，
  不静默增加 retry/agent loop。
