# SDD: Memory 搜索管线并行化 (2.4)

**Status:** Draft, awaiting approval (2026-06-01)
**Phase:** v2 review followup batch 4
**Scope:** `searchVss` 中 rewrite 与 embed 改为真并行；附带清理 `pa-agent-runtime.ts:822` 误导性注释

---

## 1. Context

`docs/v2-fix-plan.md` Phase 2 第 2.4 项：`pa-agent-runtime.ts:searchVss` 当前是**顺序**执行 rewrite → embed → searchHybrid，但代码注释（line 822）写着 `// Parallel: rewrite runs alongside embed inside searchHybrid` —— 注释撒谎，行为是串行。这是 review 报告 §2.4 直接点名的问题。

**当前实测路径**（`pa-agent-runtime.ts:817-848`）：

```typescript
private async searchVss(query: string, signal?: AbortSignal): Promise<MemorySearchResult> {
    throwIfAborted(signal);

    const policyModelName = this.plugin.settings.policyModelName.trim();

    // Parallel: rewrite runs alongside embed inside searchHybrid    ← 撒谎
    const rewritePromise = policyModelName
        ? this.rewriteQueryWithTimeout(query, policyModelName, signal)
        : Promise.resolve(null);

    const ftsQueryOverride = await rewritePromise;     // ← 在这里阻塞，rewrite 必须完成才能往下
    const rawResults = await this.plugin.vss.searchHybrid(query, {
        ftsQueryOverride,                              // ← 传给 searchHybrid 的是已 await 的字符串
    }) as RawSearchResult[];

    // ...
}
```

`searchHybrid` 内部（`vss.ts:1438-1441`）：
```typescript
const ftsQuery = options?.ftsQueryOverride != null
    ? buildFtsQuery(options.ftsQueryOverride)
    : buildFtsQuery(prompt);
const queryEmbedding = await embeddings.embedQuery(prompt);   // ← 这一步才开始 embed
```

**真实时序**：
```
T=0    rewrite 开始
T=R    rewrite 完成 (R = rewrite 耗时, 可能 100-500ms)
T=R    embed 开始
T=R+E  embed 完成 (E = embed 耗时, 可能 50-200ms)
T=R+E  searchHybrid 内部 SQL 调用
```

**理想时序**：
```
T=0    rewrite 与 embed 同时开始
T=max(R,E)  两者完成
T=max(R,E)  searchHybrid 内部 SQL 调用
```

收益：`max(R, E)` 而非 `R + E`。R=300ms, E=150ms 时节省 ~33%；用户体感"Memory 搜索响应更快"。

**关键约束**：必须保持当前的错误隔离语义——rewrite 失败 / 超时不能拖垮 embed，必须降级为用 raw prompt。当前 `rewriteQueryWithTimeout` 内部 `try/catch` 已 `return null`，新设计需保留这个特性。

---

## 2. Goals / Non-goals

### Goals

1. **2.4** 让 rewrite 与 embed 真正并行执行，把 Memory 搜索管线总耗时从 `R + E` 降到 `max(R, E)`
2. 修复 `pa-agent-runtime.ts:822` 撒谎注释：要么删除、要么改为准确描述
3. 保持错误隔离：rewrite 失败 / reject / 超时 → 降级为 raw prompt 构建 fts query；embed 失败 → 整个 searchHybrid 返回空（保持现状）
4. 兼容旧 `ftsQueryOverride: string | null` 选项（不破坏其他调用方，如有）

### Non-goals

- 不重写 rewrite / embed 的内部实现
- 不调整 rewrite 超时常量 `REWRITE_TIMEOUT_MS`
- 不引入新的 timeout 给 embed
- 不动 `searchHybrid` 之后的 rerank 串行链路（rerank 必须等 candidates 拿到后才能运行）
- 不动 `plugin.ts` / `vss.ts` 的其他 `searchHybrid` 调用方（如有，且保留旧 API）

---

## 3. Spec

### 3.1 `searchHybrid` 签名扩展

`vss.ts:1418` 当前：

```typescript
async searchHybrid(prompt: string, options?: { ftsQueryOverride?: string | null }) {
```

**目标实现**（兼容旧 API，新增 `ftsQueryOverridePromise`）：

```typescript
async searchHybrid(
    prompt: string,
    options?: {
        ftsQueryOverride?: string | null;
        /**
         * Optional promise yielding an FTS query override that runs concurrently with
         * embedding. If both this and ftsQueryOverride are provided, the promise wins.
         * Reject and `null`-resolve are both treated as "no override" (fall back to prompt).
         */
        ftsQueryOverridePromise?: Promise<string | null>;
    },
) {
    // ... unchanged guards ...

    const profile = this.profile ?? this.createEmbeddingProfile();
    const profileSignature = getEmbeddingProfileSignature(profile);
    const embeddings = await this.aiUtils.createEmbeddings(profile.dimensions);

    // Parallel: kick off both rewrite override and embed; tolerate rewrite failures.
    const safeOverridePromise: Promise<string | null> = options?.ftsQueryOverridePromise
        ? options.ftsQueryOverridePromise.catch(() => null)
        : Promise.resolve(options?.ftsQueryOverride ?? null);
    const [ftsOverride, queryEmbedding] = await Promise.all([
        safeOverridePromise,
        embeddings.embedQuery(prompt),
    ]);
    const ftsQuery = ftsOverride != null
        ? buildFtsQuery(ftsOverride)
        : buildFtsQuery(prompt);

    return this.runExclusive(async () => {
        // ... unchanged ...
    });
}
```

**关键决策**：
- **新增 promise 选项而不是替换字符串选项**：兼容（理论上仅 `pa-agent-runtime.ts` 使用，但保险起见保留双签名）
- **`.catch(() => null)` 保护**：rewrite reject 不会拖死 embed
- **`Promise.all` 而不是 `Promise.allSettled`**：embed 不允许失败（embed reject 应该让整个 searchHybrid reject，与现有行为一致）；rewrite 失败已被 `.catch` 吞掉，不会进入 Promise.all 的 reject 路径
- **优先级**：如果同时传 `ftsQueryOverride` 和 `ftsQueryOverridePromise`，promise 赢（用户显式传 promise 表示想要并行）；这种情况实际不会出现，但行为定义清晰

**等价性证明**：
- 旧 API 用 `ftsQueryOverride: string`：`safeOverridePromise = Promise.resolve(string)`，`Promise.all` 立即 resolve override，等价于"没并行"
- 旧 API 用 `ftsQueryOverride: null` 或不传：`safeOverridePromise = Promise.resolve(null)`，`buildFtsQuery(prompt)` 走 fallback，行为不变
- 新 API 用 `ftsQueryOverridePromise`：rewrite 与 embed 真并行
- rewrite reject：`.catch` → null → fallback to `buildFtsQuery(prompt)`
- rewrite 内部 timeout 后 resolve(null)（`rewriteQueryWithTimeout` 现有行为）：null → fallback

### 3.2 `searchVss` 改造

`pa-agent-runtime.ts:817-848` 当前：

```typescript
private async searchVss(query: string, signal?: AbortSignal): Promise<MemorySearchResult> {
    throwIfAborted(signal);

    const policyModelName = this.plugin.settings.policyModelName.trim();

    // Parallel: rewrite runs alongside embed inside searchHybrid
    const rewritePromise = policyModelName
        ? this.rewriteQueryWithTimeout(query, policyModelName, signal)
        : Promise.resolve(null);

    const ftsQueryOverride = await rewritePromise;
    const rawResults = await this.plugin.vss.searchHybrid(query, {
        ftsQueryOverride,
    }) as RawSearchResult[];

    // ... unchanged rerank pipeline ...
}
```

**目标实现**：

```typescript
private async searchVss(query: string, signal?: AbortSignal): Promise<MemorySearchResult> {
    throwIfAborted(signal);

    const policyModelName = this.plugin.settings.policyModelName.trim();

    // Truly parallel: rewrite (if enabled) runs concurrently with embed inside searchHybrid.
    // If rewrite fails or times out, the override resolves null and searchHybrid falls back
    // to building the FTS query from the raw prompt — preserving prior error-isolation.
    const ftsQueryOverridePromise: Promise<string | null> = policyModelName
        ? this.rewriteQueryWithTimeout(query, policyModelName, signal)
        : Promise.resolve(null);

    const rawResults = await this.plugin.vss.searchHybrid(query, {
        ftsQueryOverridePromise,
    }) as RawSearchResult[];

    throwIfAborted(signal);
    const candidates = normalizeSearchCandidates(rawResults);

    // Serial: rerank requires candidates to be ready first.
    const rankedCandidates = policyModelName
        ? await this.rerankCandidates(query, candidates, policyModelName, signal)
        : candidates;

    const documents = flattenCandidateDocuments(rankedCandidates).slice(0, MAX_MEMORY_DOCUMENTS);
    return {
        usedMemory: documents.length > 0,
        query,
        documents,
        sources: documents.map((entry) => entry.source),
        candidates: rankedCandidates,
    };
}
```

**Diff 关键变化**：
1. 删除撒谎的 `// Parallel:` 注释
2. 不再 `await rewritePromise` ——直接把 promise 传下去
3. `searchHybrid` 选项从 `ftsQueryOverride` 改为 `ftsQueryOverridePromise`
4. 新注释明确"Truly parallel" + 错误隔离语义

### 3.3 错误隔离矩阵

| 场景 | rewrite 行为 | embed 行为 | 结果 |
|---|---|---|---|
| 双成功 | resolve(string) | resolve(vector) | 用 rewritten string 构 fts |
| rewrite 超时 | resolve(null) | resolve(vector) | fallback raw prompt 构 fts |
| rewrite reject | reject(error) | resolve(vector) | `.catch(()=>null)` → fallback |
| rewrite 慢 + embed 快 | 还在跑 | resolve(vector) | Promise.all 等 rewrite，仍并行 |
| rewrite 快 + embed 慢 | resolve(string) | 还在跑 | Promise.all 等 embed |
| embed reject | resolve(null) 或 resolve(string) | reject | searchHybrid throw（与现状一致） |
| signal abort | rewrite 内部 abort → resolve(null) | embed 不受 signal 控制（当前未传 signal）| `throwIfAborted` 在 `searchVss` 入口检 |

**关键观察**：
- `rewriteQueryWithTimeout` 内部已经接 `signal`，且有 `try/catch` 兜底（`return null`）
- `embedQuery` 在 `vss.ts` 中没接 `signal`——这是**现状的不足**，但不在本 SDD 修复范围（影响小：embed 通常 < 200ms，abort 期间多等 200ms 可接受）
- abort 后 `await searchHybrid` 完成，但下一行 `throwIfAborted(signal)` 抛出，整体语义正确

### 3.4 注释清理

`pa-agent-runtime.ts:822` 当前：

```typescript
// Parallel: rewrite runs alongside embed inside searchHybrid
```

替换为新代码块的注释（见 §3.2 目标实现）：

```typescript
// Truly parallel: rewrite (if enabled) runs concurrently with embed inside searchHybrid.
// If rewrite fails or times out, the override resolves null and searchHybrid falls back
// to building the FTS query from the raw prompt — preserving prior error-isolation.
```

---

## 4. Test Plan

### 4.1 新增 `__tests__/vss-search-hybrid-parallel.test.ts`

**目标**：在 `vss.ts` 层验证并行性 + 错误隔离。

**Mock 策略**：
- `embeddings.embedQuery` mock 为 `() => new Promise(r => setTimeout(() => r([0.1, 0.2]), 100))`
- `ftsQueryOverridePromise` mock 为 `new Promise(r => setTimeout(() => r("rewritten"), 100))`
- 用 `performance.now()` 记录 `searchHybrid` 入口与内部 SQL 调用的时间差

**断言**：
1. **并行**：双 mock 各 100ms → 总耗时 ≤ 150ms（而非 ≥ 200ms）
2. **rewrite 成功 + embed 成功**：用 `buildFtsQuery("rewritten")` 而非 `buildFtsQuery(prompt)`
3. **rewrite reject**：`ftsQueryOverridePromise = Promise.reject(new Error("oops"))` → searchHybrid 不抛、用 raw prompt 构 fts
4. **rewrite resolve(null)**：等同 reject 路径，用 raw prompt
5. **rewrite resolve("")**：当前 `buildFtsQuery` 应能处理空字符串；如不能，新代码 `ftsOverride != null && ftsOverride !== ""` 判别（或在 §3.1 实现中加非空检查）
6. **同时传旧 `ftsQueryOverride` 与 `ftsQueryOverridePromise`**：promise 优先

**注**：测试需要在 `vss.ts` 的 SQLite 层 mock，不要真起 SQLite。如果现有 `vss.test.ts` 已有类似 mock harness，复用；否则用 `jest.mock("./vss/sqlite-vector-index", ...)`。

### 4.2 扩展 `__tests__/pa-agent-runtime-memory.test.ts`（如已存在）

或新增 `__tests__/pa-agent-runtime-search-vss.test.ts`：

**目标**：在 `pa-agent-runtime` 层验证 `searchVss` 的契约。

**断言**：
1. policyModelName 为空 → 不调 rewrite，仅传 `ftsQueryOverridePromise: Promise.resolve(null)` 给 `searchHybrid`
2. policyModelName 非空 → 调 rewrite，传 promise（不 await）给 `searchHybrid`
3. signal abort → searchVss throws AbortError；不会等待 rewrite/embed 完成
4. searchHybrid throw → searchVss propagates（保持当前行为）

### 4.3 时序测试细节

**用 `jest.useFakeTimers` 的注意事项**：
- `Promise.all` 在 fake timers 下的解析行为复杂，避免；用真 timers + `setTimeout(... , 50)` mock
- 用 `performance.now()` 而非 `Date.now()`（更高精度，单调）

**断言 buffer**：
- 真 timers 在 CI 上有 jitter；用 ≤ 150ms（而非 ≤ 110ms）的 buffer 容忍
- 串行下界用 ≥ 180ms（而非 ≥ 200ms）的 buffer 容忍假阳性

### 4.4 全量门禁

- `npx tsc -noEmit -skipLibCheck`
- `npm test -- --runInBand`（并行测试用真 timers，必须 runInBand 避免 CI 干扰）
- `npm run lint`
- `git diff --check`
- `npm run build`

### 4.5 手动 smoke

实施后必须在 Obsidian test vault 跑：

1. **延迟对比**：开发者工具 Network/Performance 面板录制 5 次相同 query 的 Memory 搜索；记录 `searchVss` 入口到 `searchHybrid` 返回的耗时；对比改动前后均值
2. **rewrite 失败降级**：临时改 `policyModelName` 为不存在的模型 → 触发 Memory 搜索 → 确认仍能返回结果（fallback 到 raw prompt 构 fts）
3. **rewrite 超时降级**：临时把 `REWRITE_TIMEOUT_MS` 改成 1ms → 触发 Memory 搜索 → 确认 timeout 后仍能返回结果
4. **正常流程**：恢复正常 settings → 搜索一次 → 确认结果质量未下降（相同 query 命中相同 candidates）

---

## 5. Implementation Steps

按依赖顺序：

1. **vss.ts 改造**
   - 在 `searchHybrid` 签名加 `ftsQueryOverridePromise?: Promise<string | null>` 选项
   - 内部用 `Promise.all([safeOverridePromise, embeddings.embedQuery(prompt)])` 并行
   - 保留旧 `ftsQueryOverride` 选项语义（向后兼容）
   - 跑 `npm test` 确认 `vss.test.ts` 现有测试不挂

2. **新增 `__tests__/vss-search-hybrid-parallel.test.ts`**
   - 写 §4.1 的 6 条断言
   - 跑测试确认绿

3. **pa-agent-runtime.ts 改造**
   - 重写 `searchVss` 函数体（§3.2 目标实现）
   - 删除 line 822 撒谎注释，替换为新注释
   - 跑 `npm test` 确认 memory 测试不挂

4. **新增 / 扩展 pa-agent-runtime 层测试**
   - 写 §4.2 的 4 条断言
   - 跑测试确认绿

5. **全量验证**
   - 跑 §4.4 全量门禁
   - 跑 §4.5 手动 smoke

---

## 6. Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| `Promise.all` 中 embed reject 把 rewrite 也算 reject | 低 | rewrite 用 `.catch(()=>null)` 包裹，自身永不 reject；embed reject 让 searchHybrid throw（与现状一致） |
| rewrite 比 embed 慢很多时整体体感无变化 | 极低 | 用户层至少不会变慢；max(R,E) 严格 ≤ R+E |
| 新签名 `ftsQueryOverridePromise` 与旧 `ftsQueryOverride` 同时被传 | 极低 | §3.1 明确优先级（promise 赢）；实测目前仅 `pa-agent-runtime.ts` 一个调用方 |
| signal abort 后 embed 仍在跑 | 低 | embed 当前不接 signal 是现状的旧问题，不在本 SDD 修复；abort 会被外层 `throwIfAborted` 捕获 |
| 时序断言在 CI 上 flaky（Promise.all 调度抖动） | 中 | 测试 buffer 取 50ms 以上；用 `--runInBand` 减少干扰；如仍 flaky 改为 mock fake timer 验证调用顺序而非实际时长 |
| rewriteQueryWithTimeout 行为漂移（如未来改成 throw 而非 resolve null） | 低 | 本 SDD 在 `searchHybrid` 内部又包了一层 `.catch(()=>null)` 防御；双重保险 |
| `embedQuery` 在不同 embedding provider 下耗时差异大（OpenAI 50ms vs 本地 200ms） | 极低 | 改造与 provider 无关；并行设计在所有 provider 都收益 |
| `pa-agent-runtime` 其他调用方误以为 `searchHybrid` 必同步返回 fts | 极低 | 该函数本就是 async；签名扩展不破坏类型 |

---

## 7. Critical Files

**修改:**
- `src/vss.ts:1418-1462` — `searchHybrid` 签名扩展 + 并行实现
- `src/ai-services/pa-agent-runtime.ts:817-848` — `searchVss` 改并行 + 注释修正

**新增:**
- `__tests__/vss-search-hybrid-parallel.test.ts` — vss 层并行 + 错误隔离测试
- `__tests__/pa-agent-runtime-search-vss.test.ts`（如 memory 测试无对应位置）— pa-agent-runtime 层契约测试

**阅读参考（无需改动）:**
- `src/ai-services/query-rewriter.ts` — 确认 `rewriteQuery` / `REWRITE_TIMEOUT_MS` 语义
- `src/ai-services/pa-agent-runtime.ts:850-879` `rewriteQueryWithTimeout` — 确认 `try/catch` 兜底
- `src/vss/fts-query-builder.ts` — 确认 `buildFtsQuery` 对空字符串 / 异常输入的处理

---

## 8. Rollback

单点回滚：

- 还原 `src/vss.ts:1418-1462`：删除 `ftsQueryOverridePromise` 参数及并行逻辑，恢复 `await embeddings.embedQuery(prompt)`
- 还原 `src/ai-services/pa-agent-runtime.ts:817-848`：恢复 `await rewritePromise` + 旧 `ftsQueryOverride` 传参
- 删除新增的两个测试文件

如只发现 `searchHybrid` 签名变化在第三方 / 上层有问题，可以单独保留 `searchVss` 旧实现而仅回滚 `vss.ts`。

---

## 9. Verification Checklist

- [ ] `npx tsc -noEmit -skipLibCheck`
- [ ] `npm test -- --runInBand`
- [ ] `npm run lint`
- [ ] `git diff --check`
- [ ] `npm run build`
- [ ] `vss-search-hybrid-parallel.test.ts` 包含并行时序断言（≤ 150ms） + 错误隔离断言
- [ ] `pa-agent-runtime.ts:822` 误导注释已替换为准确描述
- [ ] Obsidian smoke §4.5 全部 4 项通过
- [ ] DevTools 实测 5 次相同 query 平均耗时下降（写在 PR 描述）

---

## 10. Workflow

1. 本 SDD 通过 review 后合并 docs PR
2. 创建 worktree `feat/search-parallel`，按 §5 步骤实施
3. 通过 §9 验证清单后开 PR
4. PR 描述附 Obsidian DevTools 测得的 5 次平均耗时对比表
5. PR 合并后更新 `docs/v2-fix-plan.md` 的 2.4 状态
