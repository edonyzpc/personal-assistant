# SDD: `@sqliteai/sqlite-wasm` → `@sqlite.org/sqlite-wasm` + JS brute-force 向量

**Status:** [D] Drafting
**Phase:** v2.3(v2.2 允许机会 spike,但不作为 v2.2 发版条件)

---

## 1. Context

当前依赖 `@sqliteai/sqlite-wasm@3.50.4-sync.0.8.30-vector.0.9.23` —— 商业公司 SQLiteAI 维护的 SQLite WASM fork,迄今已 8 个月未更新。复合版本号(`<sqlite-version>-sync.<sync-version>-vector.<vector-version>`)是该供应商的自有约定,与上游 SQLite 版本管理脱节。

### 1.1 实际私有依赖面只有 3 个 SQL 函数

调研结论(2026-06-01):整个 vss 模块对 `@sqliteai` fork 的实际"私有依赖"仅以下 3 个非标准 SQL 函数,全部位于 `./src/vss/sqlite-worker.ts:339-622`:

- `vector_init`(初始化向量列)
- `vector_as_f32`(序列化/反序列化 Float32 BLOB)
- `vector_full_scan`(全表暴力扫描求 top-k)

其他全部用上游 SQLite 标准 API:

- FTS5 全文检索
- OPFS-SAH 持久化
- prepared statement
- 显式事务

### 1.2 `vector_full_scan` 函数名已暴露其实现就是 brute-force

函数名直接暴露:它就是**全表扫,无 HNSW / IVF / 任何 ANN 加速**。等价于 JS 端拉出全部 embedding Float32 BLOB,做一次 cosine / L2 求 top-k。所以替换方案"JS 端 brute-force"不是性能退化,是性能持平 —— 只是把同样的 brute-force 从 SQL 引擎移到 JS Worker。

### 1.3 风险窗口

- 8 个月停更的供应商可能随时停止维护
- 复合版本号脱节上游,后续 SQLite 安全补丁难以追溯
- 商业公司单点依赖,无社区可接管

迁移到 `@sqlite.org/sqlite-wasm`(SQLite 官方 WASM)消除该单点风险。

---

## 2. Goals

1. `package.json` 替换:`@sqliteai/sqlite-wasm` → `@sqlite.org/sqlite-wasm`(SQLite 官方 WASM)
2. `./src/vss/sqlite-worker.ts` 中 3 处 `vector_*` SQL 调用改写为:
   - `SELECT id, embedding FROM vss_chunks` 一次性拉出 Float32 BLOB
   - JS 端做 cosine / L2 求 top-k
3. Worker 内做热向量 cache:首次查询全表 → 内存 `Float32Array` → 后续查询零 SQL
4. RRF / FTS / 事务 / schema / Worker 协议**零改动**(向量段是唯一受影响子系统)
5. `./__tests__/vss-*.test.ts` 全套回归 + 真机 vault 10k chunk 性能 sanity

## Non-goals

- **不**切换到 hnswlib-wasm / usearch(Plan B,工作量 7-10 天,仅在 `@sqlite.org/sqlite-wasm` 出现阻塞性问题时启动,本 SDD 不写代码)
- **不**切到 wa-sqlite + 自编译 sqlite-vec(次优方案,自编译产物维护成本不可接受)
- **不**动 RRF(reciprocal rank fusion)实现
- **不**动 FTS5 检索路径
- **不**改 Worker postMessage 协议
- **不**做 ANN 索引(HNSW / IVF) —— 当前 brute-force 已满足召回需求,不引入加速结构

---

## 3. 方案对比与选型

### Option A(推荐): `@sqlite.org/sqlite-wasm` + JS brute-force

**优势:**
- 上游官方维护,无单点风险
- 标准 SQLite WASM,社区可追溯
- 替换面小(3 处 SQL 函数 + 一段 JS top-k)
- 性能与现状持平(brute-force vs brute-force)
- 可加热向量 cache,后续查询比当前更快(零 SQL 路径)

**风险:**
- OPFS-SAH 行为差异需 spike 验证
- 移动端 Float32Array 一次性内存占用需测

### Option B: hnswlib-wasm / usearch + sqlite.org

**优势:**
- ANN 加速,理论上 10k+ chunk 召回延迟更低

**劣势:**
- 工作量 7-10 天(新增向量库依赖、索引构建/持久化、与 SQLite 数据双写一致性)
- 引入第二个 WASM 依赖,bundle 膨胀
- 性能收益对当前 vault 规模(10k 量级)不显著

❌ **本 SDD 不采用,作为 Plan B 待命**

### Option C: wa-sqlite + 自编译 sqlite-vec

**劣势:**
- 自编译 sqlite-vec 维护成本高(版本追踪、跨平台编译)
- wa-sqlite 与官方 `@sqlite.org/sqlite-wasm` 接口不一致,迁移面大
- 等于换另一个上游,没消除单点风险

❌ **次优,不采用**

---

## 4. Spec design

### 4.1 三阶段实施计划

#### Phase 1: spike(3-5 天,在 `feat/sqlite-org-spike` 分支)

目标:验证 `@sqlite.org/sqlite-wasm` 在本项目的兼容性,在合并前回答以下问题。

1. **OPFS-SAH 兼容性**
   - 现有 vss schema(`vss_chunks` 表 + FTS5 虚拟表)在 `@sqlite.org/sqlite-wasm` 下能否直接打开
   - 数据持久化语义是否一致(关闭浏览器后重启数据是否完整)
   - 是否需要调整 `locateFile` / VFS 选择(SAH pool / `kvvfs` / `opfs` 等)

2. **性能基线测量**
   - 真机 vault(10k chunk × 1024 dim × 4 bytes = 40 MB embedding)做 brute-force top-k
   - 时间:< 50ms 期望
   - Worker 内存峰值

3. **移动端验证**
   - iOS Safari worker 一次性持有 40 MB Float32Array 是否触发内存上限
   - Android Chrome 同样测试

4. **API 形状差异**
   - `sqlite3InitModule` 入参/返回是否需要适配
   - prepared statement / transaction API 差异
   - Worker 内 `wasmUrl` 注入路径变化

5. **bundle 体积**
   - 替换后 dist 增减(预期持平或更小,因脱掉了 sqlite-vector + sqlite-sync 的额外编译产物)

**spike 退出条件:**
- 所有上述问题有明确答案
- spike 分支跑通 vss 全套测试
- 真机 vault 性能在预算内(见 §5)
- iOS / Android worker 内存不爆

**spike 失败 → 启动 Plan B(本 SDD 范围外)**

#### Phase 2: 迁移(2-3 天)

spike 通过后,在主分支正式迁移:

6. `package.json`:
   ```diff
   - "@sqliteai/sqlite-wasm": "3.50.4-sync.0.8.30-vector.0.9.23",
   + "@sqlite.org/sqlite-wasm": "<spike 验证版本>",
   ```

7. `./src/vss/sqlite-worker.ts`:
   - 替换 `vector_init`:改为标准 `CREATE TABLE` 包含 `embedding BLOB` 列
   - 替换 `vector_as_f32`:在 JS 端用 `new Float32Array(buffer)` 读取 / `new Uint8Array(float32.buffer)` 写入
   - 替换 `vector_full_scan`:改为 `SELECT id, embedding FROM vss_chunks` + JS 端 top-k

   伪代码:
   ```typescript
   // 替换 vector_full_scan
   async function bruteForceTopK(
       queryVec: Float32Array,
       k: number,
   ): Promise<{ id: string; score: number }[]> {
       const cache = await getOrLoadVectorCache();  // 见 §4.2
       const heap = new TopKHeap(k);
       for (const [id, vec] of cache) {
           const score = cosine(queryVec, vec);
           heap.push(id, score);
       }
       return heap.toSortedArray();
   }
   ```

8. `./src/vss/sqlite-inline-assets.ts`:
   - 调整 import 路径(`@sqliteai/sqlite-wasm/sqlite3.wasm` → `@sqlite.org/sqlite-wasm/...`)
   - WASM 懒加载逻辑(见 `archive/sdd-wasm-lazy-load.md`)保持不变

9. 删除 `@sqliteai` 在 `package.json` 与 lockfile 中的所有残留

#### Phase 3: 回归(1 天)

10. `npm test`(全量)
11. 真机 vault 10k chunk 性能验证(见 §5)
12. iOS / Android smoke test
13. bundle audit

### 4.2 热向量 cache 设计

**意图:** brute-force 每次查询都拉全表 SQL 是浪费;首次拉一次后驻留 worker 内存,后续查询零 SQL。

**形状:**

```typescript
// in worker scope
let vectorCache: Map<string, Float32Array> | null = null;
let vectorCacheVersion: number = 0;

async function getOrLoadVectorCache(): Promise<Map<string, Float32Array>> {
    if (vectorCache !== null) return vectorCache;
    const rows = db.exec("SELECT id, embedding FROM vss_chunks");
    const cache = new Map<string, Float32Array>();
    for (const row of rows) {
        const blob = row.embedding as Uint8Array;
        cache.set(row.id, new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
    }
    vectorCache = cache;
    return cache;
}
```

**失效策略:**

- vault 增删 chunk 时(`upsertChunk` / `deleteChunk` 路径)主动 invalidate:
  - 单条增删 → 局部更新 cache(`cache.set(id, vec)` / `cache.delete(id)`)
  - 批量重建(rebuild index)→ `vectorCache = null`,下次查询重新拉
- Worker reset / OPFS reload → 自然失效(worker 内存清空)

**持久化:** cache 不持久化,仅 worker 生命周期内驻留。

### 4.3 Worker 协议保持不变

主线程 → worker 的 postMessage 协议(`{ kind: "search", payload: {...} }` 等形状)**零改动**。worker 内部从"调 SQL 函数"切到"读 cache + JS 计算",对外是透明的。

### 4.4 schema 微调

只在 `vector_init` 替换处:

- 旧:依赖 `vector_init('embedding', 1024, 'f32')` 注册元信息
- 新:`CREATE TABLE vss_chunks (id TEXT PRIMARY KEY, embedding BLOB, ...)` 标准 SQL,维度通过 JS 端常量约束(BLOB 长度 = 1024 \* 4 bytes 在写入路径校验)

迁移现有用户数据需考虑 schema migration:旧 `vss_chunks` 表是 `@sqliteai` fork 创建的,可能有非标准元数据列。spike 阶段需验证 `@sqlite.org/sqlite-wasm` 能否打开旧表;若不能,需写一次性迁移脚本(读旧表 → 新 schema 重建)。

---

## 5. Acceptance Criteria

### 5.1 性能预算

| 指标 | 现状(`@sqliteai` + `vector_full_scan`) | 目标(`@sqlite.org` + JS brute-force) |
|------|------|------|
| 10k chunk top-k 延迟(冷,首次查询) | 基线 X ms | ≤ X + 20% |
| 10k chunk top-k 延迟(热,cache hit) | 基线 X ms | 显著优于(零 SQL) |
| Worker 内存峰值(含 cache) | 基线 ~10 MB | ≤ 80 MB(含 40 MB embedding cache) |
| Bundle 体积 | 基线 | 持平或更小(脱掉 sqlite-vector + sqlite-sync 编译产物) |

### 5.2 功能 Acceptance

- `./__tests__/vss-*.test.ts` 全过(包括 ingest / search / RRF / FTS / 持久化)
- 真机 vault 10k chunk 召回结果与现状一致(top-k 集合相同,排序允许浮点级抖动)
- iOS Safari 上 worker 持有 40 MB Float32Array 不触发内存上限(spike 必测,迁移阶段复测)
- Android Chrome smoke test 通过
- vault 增删 chunk 后 cache invalidation 生效(后续查询能召回新 chunk / 排除已删 chunk)
- bundle audit 持平或缩小(`npm run audit:bundle`)
- `tsc -noEmit -skipLibCheck` 零错
- `grep -rn "@sqliteai\|vector_init\|vector_as_f32\|vector_full_scan" ./src` 无业务命中

---

## 6. Verification

### 6.1 spike 阶段(`feat/sqlite-org-spike` 分支)

1. `npm install @sqlite.org/sqlite-wasm@<latest>`
2. 修改最小 demo:打开 OPFS-SAH 数据库 → 写入 1 条 chunk → 重启 worker → 读出
3. 灌 10k chunk fixture → brute-force top-k 性能测
4. iOS 模拟器 + 真机 worker 内存测
5. Android 模拟器 + 真机 worker 内存测
6. 现有 vss 全套测试在 spike 分支跑通

### 6.2 迁移阶段(主分支)

7. `tsc -noEmit -skipLibCheck`
8. `npm test -- --testPathPattern=vss`
9. `npm test`(全量)
10. `npm run build`
11. `npm run audit:bundle`
12. 真机 vault 10k chunk 性能验证
13. iOS / Android smoke test
14. `grep -rn "@sqliteai" ./` 应为 0(除 release notes 与本 SDD 自身)
15. 数据迁移验证:用旧 vault 升级到新版,确认现有 vss 数据可读 / 必要时迁移脚本生效

### 6.3 v2.2 期间过渡(E2 策略)

CI 加月度 spike 跑 `npm install @sqliteai/sqlite-wasm@latest` 全量回归,持续监控旧依赖是否复活(若供应商重新维护,可能改变迁移优先级)。**这条 CI 不阻塞 v2.2 发版。**

如 P0 任务提前完成可在 v2.2 内启动机会 spike(走 §6.1 流程),但**不作为 v2.2 发版条件**。

---

## 7. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| OPFS-SAH 行为差异:`@sqliteai` fork 可能修改了 OPFS 持久化逻辑 | 高 | spike 阶段必须 cover 持久化语义(关浏览器/重启 worker 后数据完整);若不一致,写一次性 schema migration |
| 移动端 worker 内存上限:iOS Safari worker 一次性 40 MB Float32Array 是否触限 | 高 | spike 必测真机;触限则降级为分块加载(每块 N MB,top-k 流式合并);最坏退到 SQL 路径每次拉(性能退步但不爆内存) |
| 热向量 cache 失效条件:vault 增删后 cache 是否要 invalidate | 中 | §4.2 设计阶段已明确;实施时增删路径主动调 invalidate API;测试覆盖单条增删 + 批量重建场景 |
| 旧 `vss_chunks` 表 schema 不兼容 `@sqlite.org/sqlite-wasm` | 中 | spike 阶段尝试打开真实用户备份的 vault DB;若不兼容,在 v2.3 迁移逻辑里一次性 rebuild 索引(可接受,因 chunk 源数据在 vault 里) |
| brute-force 在更大 vault(50k+ chunk)退化 | 低 | 当前用户 vault 集中在 10k 量级;若未来用户报 50k+ 性能问题,启动 Plan B(hnswlib-wasm / usearch) |
| `@sqlite.org/sqlite-wasm` API 形状与 fork 差异较大 | 中 | spike 阶段先做 API 适配薄层(若需要),把差异收敛在 `./src/vss/sqlite-worker.ts` 一处 |
| Plan B(hnswlib-wasm / usearch / sqlite-vec)启动条件 | 低 | 仅当 `@sqlite.org/sqlite-wasm` spike 失败 / 真机性能不达标 / 移动端内存爆,启动 Plan B;Plan B 工作量 7-10 天,需新开 SDD |

---

## 8. Plan B 不写代码

纯 JS 向量库(hnswlib-wasm / usearch)或 wa-sqlite + 自编译 sqlite-vec 是次优选项,工作量 7-10 天,**仅在 `@sqlite.org/sqlite-wasm` 出现阻塞性问题时启动**。

启动条件(任一即触发):

- spike 阶段 OPFS-SAH 持久化不可用且无适配路径
- 真机 10k chunk 性能 > 当前 + 50%
- 移动端 worker 内存触发上限且无降级方案

启动后**新开 SDD**,本 SDD 范围内不预先实现 Plan B 代码。

---

## 9. Critical Files

**修改:**
- `./package.json` —— 依赖替换
- `./package-lock.json` —— lockfile 同步
- `./src/vss/sqlite-worker.ts` —— 3 处 `vector_*` SQL 改 JS brute-force + 热向量 cache
- `./src/vss/sqlite-inline-assets.ts` —— WASM 路径调整(配合 `archive/sdd-wasm-lazy-load.md` 保持懒加载)
- `./src/vss/schema.ts`(若存在) —— `vector_init` 改为标准 `CREATE TABLE`

**可能新增:**
- 一次性 schema migration 脚本(若 spike 发现旧表不兼容)

**不动:**
- `./src/vss/rrf.ts`(RRF 实现)
- `./src/vss/fts.ts`(FTS5 检索)
- Worker postMessage 协议层
- `__tests__/vss-*.test.ts`(测试不变,验证行为不变)

**阅读参考:**
- `./docs/archive/sdd-wasm-lazy-load.md`(WASM 懒加载,本迁移需保持兼容)
- `./docs/archive/sdd-chat-tools-split.md`(memory 工具上游消费者)
- 项目 memory:`project_wasm_supplier_migration_plan`
