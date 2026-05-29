# SDD: calcSnapshot() 增量优化

**Status:** Accepted design record
**Phase:** 3.2

---

## 1. Context

`StatsManager.calcSnapshot()` 在插件启动 3 秒后被调用一次（`scheduleSnapshotRefresh()` → `refreshSnapshotInBackground()`），同步遍历 vault 所有 `.md` 文件，对每个文件执行 `vault.cachedRead()` + `countText()`（6 个正则密集函数）。所有逻辑跑在单个 event loop turn，导致 UI 卡顿。

**已知影响:**
- 桌面 500 笔记 vault：1-3 秒主线程阻塞
- 移动端（尤其 iOS）：3-10 秒卡顿，可能触发 watchdog
- 每次启动都从零计算，没有缓存

**调用方:**
- `refreshSnapshotInBackground()` (line 492) — 启动后 3s 触发
- `recalcTotals()` (line 241) — 用户显式重算
- `updateToday()` (line 176) — 手动更新

---

## 2. Goals

1. **首次启动（冷缓存）** — 仍是全扫描，但批处理 + yield，UI 不卡顿
2. **后续启动（暖缓存）** — 只读取 mtime/size 变化的文件，10ms 量级
3. **运行时增量** — 编辑/创建/删除/重命名时通过 vault 事件标记 dirty，下次快照统一处理
4. **错误恢复** — 缓存损坏自动回退到批处理全扫描
5. **不变式守卫** — 每次启动加载缓存后做轻量 invariant + 5 文件抽样校验，发现偏差立即清空缓存重建

## Non-goals

- 不改 `countText()` 的计数语义（保持兼容现有数据）
- 不引入跨设备同步（缓存设备本地）
- 不做后台周期性 reconciliation（v2 才考虑；v1 仅在启动时抽样）

---

## 3. Spec

### 3.1 数据模型

新增 `FileCountCacheEntry` 持久化到 IndexedDB：

```typescript
interface FileCountCacheEntry {
    path: string;          // primary key, vault-relative
    mtime: number;         // TFile.stat.mtime, unix ms
    size: number;          // TFile.stat.size, bytes
    wordCount: number;
    charCount: number;
    sentenceCount: number;
    pageCount: number;
    footnoteCount: number;
    citationCount: number;
}
```

**关键设计:**
- 主键 `path`（vault 文件标识）；rename 处理为内存 Map 双写（旧 path → 新 path）+ 写盘 delete-old + insert-new
- 同时存 `mtime` + `size` 作为 cache validity（参考 `vss.ts:446,726-727,1005,1050` 模式），防御 cloud sync（iCloud / OneDrive / Obsidian Sync）只更新 mtime 的边界情况
- `pageCount` 直接存预算结果，避免对 `stats-manager.ts:393` 的 `300` 常量产生隐式依赖

### 3.2 IndexedDB 存储扩展

`stats-local-store.ts` 升级 DB 版本 2→3，新增第三个 object store：

```typescript
const STATS_LOCAL_DB_VERSION = 3;
const FILE_COUNT_CACHE_STORE = "fileCountCache";

// 在 onupgradeneeded 中（事务范围）
if (!db.objectStoreNames.contains(FILE_COUNT_CACHE_STORE)) {
    db.createObjectStore(FILE_COUNT_CACHE_STORE, { keyPath: "path" });
}
```

**Schema 升级保护（双层兜底）:**

`onupgradeneeded` 是单事务，`createObjectStore` 失败 → 整个事务 rollback，`open()` reject，DB 维持 v2。问题是 IndexedDB 版本号**只能单向递增**，回退不存在 — 一旦 v3 写入坏数据无法回到 v2。两个机制叠加：

```typescript
// 机制 1: onupgradeneeded 内部 try/catch，标记失败但不直接 throw
let upgradeFailed = false;
request.onupgradeneeded = (event) => {
    const db = (event.target as IDBOpenDBRequest).result;
    try {
        if (event.oldVersion < 2 && !db.objectStoreNames.contains(SNAPSHOT_STORE)) {
            db.createObjectStore(SNAPSHOT_STORE);
        }
        if (event.oldVersion < 3 && !db.objectStoreNames.contains(FILE_COUNT_CACHE_STORE)) {
            db.createObjectStore(FILE_COUNT_CACHE_STORE, { keyPath: "path" });
        }
    } catch (err) {
        upgradeFailed = true;
        console.error("[stats-local-store] schema upgrade failed:", err);
        // 不 abort 事务 —— 让 open success 后由 init-time 兜底处理
    }
};

// 机制 2: init-time 兜底 —— 重新 open 时校验 store 是否存在
async function initialize(): Promise<void> {
    const db = await openDb(STATS_LOCAL_DB_VERSION);
    const requiredStores = [SNAPSHOT_STORE, FILE_COUNT_CACHE_STORE];
    const missing = requiredStores.filter((s) => !db.objectStoreNames.contains(s));
    if (missing.length > 0) {
        console.warn(`[stats-local-store] missing stores after upgrade: ${missing.join(",")}; falling back to UnavailableStatsLocalStore`);
        db.close();
        // 切换到 Unavailable 实现 —— 增量功能禁用，stats 仍可工作（仅 snapshot 路径）
        throw new SchemaIntegrityError(missing);
    }
}
```

调用方 catch `SchemaIntegrityError` → 回退到 `UnavailableStatsLocalStore`（增量禁用），日志一次告警；用户可通过 `recalcTotals()` 触发 `clearFileCountCache()` + 重 open 尝试自愈。

`StatsLocalStore` 接口扩展 4 个方法：
```typescript
getAllFileCountEntries(): Promise<FileCountCacheEntry[]>;
putFileCountEntries(entries: FileCountCacheEntry[]): Promise<void>;
deleteFileCountEntries(paths: string[]): Promise<void>;
clearFileCountCache(): Promise<void>;
```

三个实现（`IndexedDbStatsLocalStore`、`MemoryStatsLocalStore`、`UnavailableStatsLocalStore`）都需补齐。`UnavailableStatsLocalStore` 实现使所有方法 reject，调用方在 fallback 路径检测到则强制走 batched `calcSnapshot()` 全扫描。

### 3.3 启动流程

**冷启动（无缓存）:**
1. `calcSnapshotIncremental()` 加载缓存（空）
2. 所有文件均为 cache miss → 走批处理全扫描（见 3.4）
3. 全部新条目写入 IndexedDB

**暖启动（有缓存）:**
1. 加载缓存到 `Map<path, entry>`
2. **不变式抽样校验（v1 轻量 reconciliation）:**
   - 缓存条目数 vs `vault.getMarkdownFiles().length` 偏差 > 50%（一侧远多于另一侧）→ 怀疑缓存损坏，清空重建
   - 否则随机抽样 5 个 cache hit 文件，`cachedRead` + 重新 `countText`，对比 `wordCount`
   - 任一偏差 > 5% → 清空 `fileCountCache`，走冷启动全扫描
   - 校验耗时上限：移动端 5 文件 × ~10ms ≈ 50ms，可接受
3. 遍历 `vault.getMarkdownFiles()`：
   - mtime + size 匹配 → cache hit，直接累加计数
   - 不匹配或缺失 → 加入 `needsCounting` 队列
   - cache 中存在但 vault 不存在 → 加入 `stalePaths` 删除列表
4. 批处理 `needsCounting`，间隔 yield
5. 批量 put 新条目，批量 delete stale 条目

### 3.4 批处理算法

```typescript
private async calcSnapshotIncremental(
    shouldCancel: CancelCheck = () => false,
): Promise<SnapshotCounts | null> {
    const BATCH_SIZE = Platform.isMobile ? 20 : 50;
    const YIELD_MS = Platform.isMobile ? 16 : 50;

    const cache = await this.fileCountCache.getAll();
    if (shouldCancel()) return null;
    const cacheMap = new Map(cache.map(e => [e.path, e]));

    const totals = emptySnapshotCounts();
    const needsCounting: TFile[] = [];
    const files = this.vault.getMarkdownFiles();

    for (const file of files) {
        const cached = cacheMap.get(file.path);
        if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
            accumulate(totals, cached);
            cacheMap.delete(file.path);
        } else {
            needsCounting.push(file);
            cacheMap.delete(file.path);
        }
    }
    const stalePaths = Array.from(cacheMap.keys());

    let processed = 0;
    const newEntries: FileCountCacheEntry[] = [];
    for (const file of needsCounting) {
        if (shouldCancel()) return null;
        const text = await this.vault.cachedRead(file);
        if (shouldCancel()) return null;
        const counts = this.countText(text);
        accumulateCounts(totals, counts);
        newEntries.push(buildEntry(file, counts));

        processed++;
        if (processed % BATCH_SIZE === 0) {
            await sleep(YIELD_MS);
        }
    }

    await this.fileCountCache.putMany(newEntries);
    if (stalePaths.length > 0) {
        await this.fileCountCache.deleteMany(stalePaths);
    }
    totals.files = this.getTotalFiles();
    totals.totalPages = Number(totals.totalPages.toFixed(1));
    return totals;
}
```

桌面 50/批 + 50ms yield，移动端 20/批 + 16ms yield，给 UI 充足 frame budget。

### 3.5 增量更新（vault 事件）

现有 4 个 vault 事件（`stats-manager.ts:92-124`）扩展：

| 事件 | 现有行为 | 新增行为 |
|------|--------|--------|
| `modify` | 失效 dashboard cache | 加入 `dirtyFileCountPaths` Set，**不立即重读**；`fileCountCacheMap.delete(path)` 让下次快照视为 miss |
| `delete` | 失效 dashboard cache | `fileCountCacheMap.delete(path)` + `dirtyFileCountPaths.delete(path)` + `pendingCacheDeletes.add(path)` |
| `rename` | 失效 dashboard cache | 内存 Map 双写：`fileCountCacheMap.set(newPath, oldEntry)` + `fileCountCacheMap.delete(oldPath)`（mtime 不变，无需重算）；持久化在下次快照统一刷盘 |
| `create` | 失效 dashboard cache | 加入 `dirtyFileCountPaths` |

**rename 的内存双写理由:** 如果只删旧、依赖下次快照重新读新 path，window 期间 in-memory Map 与 vault 不一致，触发抽样校验时可能误判 stale。同步双写后 Map 立即一致；持久化层延迟到下次 putFileCountEntries 批量刷盘，避免每个 rename 都触发 IDB 事务。

**惰性失效原则:** modify 事件高频，立即重算会造成 I/O 风暴。改为标记 dirty，下次 `calcSnapshotIncremental()` 触发时统一处理。

**`applyChange()` 不写缓存（重要）:**

`applyChange(change: PendingTextChange)` 仅取 `change.currentText` 计数，**从不读 `file.stat`**。如果在此处调用 `updateFileCountCache(path, currentCounts, file.stat)`：
- `file.stat.mtime` / `size` 在编辑器写盘前可能仍是旧值（Obsidian 异步刷新）
- 写入后下次启动会出现 "cache mtime == file.stat.mtime 但内容已不同" 的假命中
- 时点错位 → 持久化错误数据

**正确做法:** `applyChange` 末尾仅 `dirtyFileCountPaths.add(file.path)` + `fileCountCacheMap.delete(file.path)`，让 modify 事件 / 下次 `calcSnapshotIncremental()` 走重读路径。

收益是"下次快照只读 dirty 文件"而非"零 I/O"——目标是消除 1-3s 全扫描，单文件 cachedRead 在批处理中可忽略。

### 3.6 错误处理

| 场景 | 行为 |
|------|------|
| IndexedDB 读失败 | 回退到 batched `calcSnapshot()`（fallback 路径，见下方 §3.7） |
| IndexedDB 写失败 | 内存计数仍正确，下次启动 cache miss 重新计算 |
| 计数逻辑变更 | 通过 `metadata` store 中的 `fileCountCacheVersion` 检测，不一致则清空重建 |
| Cloud sync（iCloud/OneDrive）仅 mtime 变化 | `size` 二次校验阻止假阳性 |
| 启动时抽样发现偏差 | 清空 `fileCountCache`，走冷启动全扫描 |
| `recalcTotals()` 触发 | 显式清空缓存，强制全量重建 |
| Schema 升级失败 | `SchemaIntegrityError` → `UnavailableStatsLocalStore` → 增量禁用，stats 仍可工作 |

**周期性 reconciliation（v2 计划）:** 每 6 小时随机抽样校验若干 "clean" 文件，参考 `vss.ts:1043-1060` rolling hash 模式。v1 仅在启动时做一次抽样（见 §3.3 步骤 2）。

### 3.7 Batched fallback `calcSnapshot()`

旧 `calcSnapshot()` 保留作为增量失败兜底，但不再卡 UI：

```typescript
async calcSnapshot(shouldCancel: CancelCheck = () => false): Promise<SnapshotCounts | null> {
    const BATCH_SIZE = Platform.isMobile ? 20 : 50;
    const YIELD_MS = Platform.isMobile ? 16 : 50;
    const totals = emptySnapshotCounts();
    const files = this.vault.getMarkdownFiles();

    for (let i = 0; i < files.length; i++) {
        if (shouldCancel()) return null;
        const text = await this.vault.cachedRead(files[i]);
        if (shouldCancel()) return null;
        accumulateCounts(totals, this.countText(text));
        if ((i + 1) % BATCH_SIZE === 0) {
            await sleep(YIELD_MS);
        }
    }
    totals.files = this.getTotalFiles();
    totals.totalPages = Number(totals.totalPages.toFixed(1));
    return totals;
}
```

调用路径：增量 store 不可用 / 抽样校验失败 / 用户 `recalcTotals()` 后又遇 IDB 错误。

---

## 4. Implementation Steps

### 文件: `src/stats/stats-local-store.ts`
1. `STATS_LOCAL_DB_VERSION` 2 → 3
2. 新增 `FILE_COUNT_CACHE_STORE` 常量
3. 导出 `FileCountCacheEntry` 接口
4. `StatsLocalStore` 接口加 4 个方法
5. `onupgradeneeded` 创建新 store
6. 三个实现类补齐方法

### 文件: `src/stats/stats-manager.ts`
7. 新增 import: `TFile`, `sleep` (obsidian), `FileCountCacheEntry` (./stats-local-store)
8. 新增私有字段：
   ```typescript
   private dirtyFileCountPaths = new Set<string>();
   private pendingCacheDeletes = new Set<string>();
   private fileCountCacheMap: Map<string, FileCountCacheEntry> = new Map();
   private fileCountCacheReady = false;
   ```
9. 4 个 vault 事件 handler 扩展（参见 §3.5）；rename 同步双写 `fileCountCacheMap`
10. `applyChange()` 末尾仅 `dirtyFileCountPaths.add(file.path)` + `fileCountCacheMap.delete(file.path)`（**不写 file.stat**，见 §3.5 时点错位说明）
11. 新增方法 `calcSnapshotIncremental()`
12. 新增方法 `validateCacheIntegritySample()`（5 文件抽样校验）
13. `refreshSnapshotInBackground()` 改调 `calcSnapshotIncremental()`
14. 现有 `calcSnapshot()` 加 batching + yield（参见 §3.7 fallback 实现）
15. `recalcTotals()` 先 `clearFileCountCache()` 再走增量流程

### 文件: `src/stats/stats-repository.ts`（可选）
15. 推荐方案：`StatsManager` 直接持有 `FileCountCacheStore` 实例，**不**走 repository（避免污染抽象）。文件计数缓存与 daily stats 正交。

### 文件: `__tests__/stats-manager.test.ts`
17. `createManager` helper 注入 `MemoryFileCountCacheStore`
18. 新增测试用例（见 §6）

---

## 5. Migration

**Phase 1（本 SDD 范围）:**
- `calcSnapshotIncremental()` 加在 `calcSnapshot()` 旁边
- `refreshSnapshotInBackground()` 切换到增量
- `recalcTotals()`/`updateToday()` 清缓存后用增量
- 旧 `calcSnapshot()` 保留为 fallback，并加 batching

**Phase 2（未来可选）:**
- 启动时显示 "calculating..." 状态条，先用昨天 shard 估算
- 类似 VSS cursor-based 的多轮 reconciliation（`vss.ts:1014-1041`）

---

## 6. Test Plan

**单测（`__tests__/stats-manager.test.ts` 扩展或新建文件）:**

1. **Cache hit path** — 预填缓存，验证 `cachedRead` 不被调用
2. **Cache miss path** — 空缓存，验证全部读取并写缓存
3. **Mixed hit/miss** — 5 个文件预填 3 个，只读 2 个
4. **Stale cleanup** — 缓存中存在的文件已从 vault 删除，验证缓存清理
5. **mtime change** — 缓存命中后修改 mtime，验证重读
6. **modify 事件** — 触发后 path 进 dirty set + Map 移除，下次快照重读
7. **delete 事件** — 缓存条目移除（Map + 持久化 deletes）
8. **rename 事件** — Map 双写：旧 path 立即删除，新 path 立即出现，下次快照刷盘
9. **create 事件** — 新 `.md` 进 dirty set
10. **批处理 yield** — 100 文件验证 setTimeout 按 BATCH_SIZE 调用
11. **取消** — `shouldCancel` 返回 true 后 N 文件，返回 null，部分写入仍有效
12. **缓存损坏 fallback** — IndexedDB read mock 抛错，回退到 batched `calcSnapshot()`
13. **`recalcTotals` 清缓存** — 验证清空 + 全重建
14. **计数准确性** — 增量结果 === 全量结果（同输入）
15. **dispose 中途** — 销毁后无写入调度（参考现有 line 345 测试）
16. **`applyChange` 不写 stat** — 编辑后 dirty 标记 + Map 移除，**断言无 `putFileCountEntries({mtime,size})` 调用**
17. **抽样校验偏差 → 全清** — 预填错误 wordCount，模拟 5 文件抽样命中其中之一，验证 `clearFileCountCache` 触发
18. **抽样校验通过 → 增量** — 预填准确数据，5 文件抽样无偏差，正常走暖启动路径
19. **抽样校验耗时上限** — 模拟 5 文件 × 10ms = 50ms 内完成
20. **Schema 升级失败 → fallback** — mock `createObjectStore` throw，验证 `SchemaIntegrityError` + 切换到 `UnavailableStatsLocalStore`
21. **rename 后立即快照** — rename 事件触发后立即 `calcSnapshotIncremental()`，新 path 命中（不重读）

**手动验证:**
- 真实 vault（500+ 笔记）测启动延迟改善
- 移动端（iOS / Android Obsidian）测无卡顿
- iCloud 同步场景下计数正确

---

## 7. Performance Impact

| 场景 | 当前 | 优化后 |
|------|------|------|
| 冷启动 500 文件 | 1-3s 阻塞 | ~3s 总耗时，0ms 卡顿 |
| 暖启动 5 文件变更 | 1-3s 阻塞 | ~50ms |
| 暖启动 0 变更 | 1-3s 阻塞 | ~10ms |
| iCloud 同步中 500 文件 | 10-30s 冻结 | 渐进，无冻结 |
| 移动端 200 文件暖启动 | 3-10s 冻结 | ~20ms |

---

## 8. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| 增量跟踪错误 → 持久化错误数据 | 高 | 启动时 5 文件抽样 + version 检测 + `recalcTotals()` 显式重建；v2 加周期性 reconciliation |
| `applyChange` 时点错位（file.stat 滞后于 currentText） | 高 | **不在 applyChange 写缓存**，仅 dirty 标记 + Map 移除；模式书面化在 §3.5 |
| rename 后立即快照命中错误 path | 中 | 内存 Map 双写，新旧路径同步切换，无 window |
| IndexedDB 跨设备不可同步 | 低（设计如此） | 缓存为本地优化，不影响 daily shard 同步 |
| Schema 升级单事务失败 | 中 | daily records / metadata stores 仍为必需；`fileCountCache` 是可丢弃优化，缺失或损坏时禁用增量缓存并回退全量快照 |
| IDB 版本号不可逆 | 中 | 升级失败由 `UnavailableStatsLocalStore` 屏蔽，不写 v3 坏数据；用户 `recalcTotals` 可触发自愈尝试 |
| 抽样校验耗时拖累启动 | 低 | 上限 5 文件 × ~10ms = 50ms；启动后台快照延迟触发，vault 事件使用低频桌面延迟和更保守的移动端延迟 |
| Cloud sync 仅更新 mtime | 低 | mtime + size 双校验阻止假阳性 |

---

## 9. Verification Checklist

- [ ] `tsc -noEmit -skipLibCheck`
- [ ] `npm test -- --testPathPattern=stats-manager`
- [ ] `npm test -- --testPathPattern=stats-local-store`
- [ ] `npm run build`
- [ ] `npm run audit:bundle`
- [ ] 真实 500 笔记 vault 实测（冷/暖/iCloud 场景）
- [ ] iOS Obsidian 实测
- [ ] Android Obsidian 实测

---

## 10. Critical Files

- `src/stats/stats-manager.ts` — 主体改动
- `src/stats/stats-local-store.ts` — DB schema + CRUD
- `__tests__/stats-manager.test.ts` — 测试
- `src/stats/stats-repository.ts`（评估是否需要扩展）
- `src/stats/stats-types.ts`（按需放 `FileCountCacheEntry`）
