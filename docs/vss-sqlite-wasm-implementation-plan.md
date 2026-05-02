# VSS SQLite/WASM 实施计划

## Summary

- 主路径从 `MemoryVectorStore` 改为 `sqlite-vector/@sqliteai/sqlite-wasm` + `opfs-sahpool` 本机 SQLite 索引，避免启动时全量向量进入 JS 内存。
- 正式实现前先做 Phase 0 PoC Gate：Desktop PoC 是进入主实现的硬门槛；iOS/Android PoC 是 Mobile 支持级别门槛，未通过只降级 Mobile 支持。
- Desktop 和 Mobile 第一版都采用手动 VSS：不启动自动扫描、不自动 embedding、不自动重建。
- VSS 索引是“有 token 成本的可重建缓存”：OPFS 丢失不影响笔记，但重建前必须提醒用户并确认。
- 新安装默认 Qwen `text-embedding-v4` + `1024` 维；旧用户和旧索引只提示迁移，不自动消耗 token。
- 检索精确优先：默认 `vector_full_scan`；超过 `50k` chunks 提醒可能变慢，超过 `100k` chunks 建议未来考虑量化，但不自动切换。

## Implementation Status Snapshot

截至 2026-05-02，本计划已经进入 Phase 6 验证阶段。当前执行状态以 [VSS SQLite/WASM 重构开发测试进展](./vss-sqlite-wasm-development-tracker.md) 为准，摘要如下：

| Phase | 当前状态 | 备注 |
| --- | --- | --- |
| Phase 0 PoC Gate | Desktop/iOS 已通过，Android 待验证 | Desktop 是主实现硬 gate；Android 因无实机设备暂未完整验证 |
| Phase 1 VectorIndex + manifest | 已实现 | marker/manifest 使用设备子目录；fallback 使用双硬上限 |
| Phase 2 SQLite Worker 后端 | 已实现 | worker/WASM 已纳入 build、deploy、release assets |
| Phase 3 VSS lifecycle | 已实现 | 插件启动不自动建索引；refresh/rebuild 手动触发 |
| Phase 4 UI 状态与提醒 | 基础实现已完成 | 状态栏和 Mobile 状态命令已完成；rebuild 确认文案仍可补充预计文件数/chunk 数和当前模型 |
| Phase 5 旧 JSON 清理和迁移保护 | 已实现 | 清理前检查 SQLite ready、marker/profile、chunkCount 和 fatal error |
| Phase 6 测试与验证 | 自动化、Desktop、iOS 已通过；Android 待验证 | README 已标注 Android VSS 为待实机验证状态 |

## Phase 0 PoC Gate

在正式改造 VSS 前，先验证最小闭环：

- lazy-load Worker。
- Worker 内加载 `@sqliteai/sqlite-wasm` 和 `sqlite-vector`。
- 创建/重开 `opfs-sahpool` DB。
- 创建 `vss_meta` / `vss_chunks` 最小表。
- 写入 Float32 embedding BLOB。
- 执行 `vector_init` 和 `vector_full_scan`。
- 重开 DB 后验证数据仍存在。

平台验证：

- Obsidian Desktop。
- Obsidian iOS。
- Obsidian Android。

额外验证：

- `navigator.storage.persist()` / `persisted()` / `estimate()` 在主线程可调用。
- 打包后的 WASM/worker asset 路径可加载。
- OPFS 不可用时能返回明确错误码。

Gate 结果：

- Desktop 通过、Mobile 失败：Desktop 主路径继续，Mobile 标记为实验性手动 VSS 或禁用 VSS。
- Desktop 失败：停止主实现，重新评估后端。

## Storage And Persistence

- `SqliteVectorIndex` 在 dedicated Worker 中 lazy-load `@sqliteai/sqlite-wasm`，优先使用 `opfs-sahpool`。
- 首次手动初始化 VSS 时，在主线程主动调用 `navigator.storage.persist()` 请求 persistent storage。
- 如果 persistent storage 不可用或返回 `false`：
  - 继续允许用户手动建立索引。
  - UI 标注 `best-effort storage`，提示索引未来可能被系统/WebView 清理，重建会产生 embedding token 成本。
- 使用 `navigator.storage.persisted()` 和 `navigator.storage.estimate()` 记录并展示 storage 状态、usage/quota、VSS DB 估算大小。
- OPFS DB 不放入 vault，不参与同步；底层文件只通过 VSS reset/rebuild 管理。

## Metadata And Loss Detection

- 新增本机索引 marker，写入 vault 中按设备分片的轻量记录：
  - 路径：`.obsidian/plugins/personal-assistant/vss-index-state/<deviceId>/marker.json`。
  - `deviceId` 复用现有 stats 的 `localStorage` device ID 机制，必要时抽成共享 helper。
  - marker 随 vault 同步时只代表对应设备曾经建立过本机索引，不表示其他设备的 OPFS 索引可用。
- marker 记录：
  - `deviceId`
  - `indexId`
  - `profileSignature`
  - `backend`
  - `schemaVersion`
  - `chunkCount`
  - `fileCount`
  - `builtAt`
  - `lastVerifiedAt`
  - `storagePersisted`
  - `estimatedDbBytes`
  - `estimatedEmbeddingTokens` 或重建成本提示所需统计
- 新增轻量 VSS manifest，作为 fallback 阈值判断的唯一来源：
  - 路径：`.obsidian/plugins/personal-assistant/vss-index-state/<deviceId>/manifest.json`。
  - manifest 按设备分片，只能用于该 `deviceId` 对应设备的 fallback 判断。
  - 记录 `fileCount`, `chunkCount`, `estimatedMemoryBytes`, `profileSignature`, `legacyJsonCacheBytes`。
  - SQLite 不可用且没有 manifest 时，不扫描旧 JSON 向量，不启用 Memory fallback。
- 如果 marker 显示本设备曾有索引，但 OPFS DB 打不开、meta 表缺失或 profile 记录缺失：
  - 标记 `missing-local-index`。
  - 只在 VSS 入口或聊天需要 RAG 时提示，不在插件启动时弹窗。
  - 提示用户索引可能被系统/WebView 清理；笔记未丢失；重建会重新调用 embedding 并可能产生 token 成本。
  - 不自动重建。

## Architecture Changes

- 新增 `VectorIndex` 接口：
  - `initialize(profile)`
  - `upsertFile(fileState, chunks, embeddings)`
  - `deleteFile(path)`
  - `listFilePaths()`
  - `getFileRecord(path)`
  - `search(queryEmbedding, k)`
  - `getStats()`
  - `verify()`
  - `reset()`
  - `dispose()`
- 第一版主实现：`SqliteVectorIndex`。
- fallback 实现：`MemoryVectorIndex`，仅在 SQLite/WASM/OPFS 不可用、manifest 存在且规模同时低于两个硬上限时启用。
- fallback 双硬上限：
  - `chunkCount <= 5,000`。
  - `estimatedMemoryBytes <= 128MB`。
  - 任一条件超限即禁用 VSS，聊天跳过 RAG。
- 业务层只依赖 `VectorIndex`，不暴露 sqlite-vector 专有 SQL/API，保留未来替换为 `sqlite-vec` 的空间。
- `sqlite-vector/@sqliteai/sqlite-wasm` 必须 pin 精确版本，并在 README/release notes 披露许可证边界。

## Data Model

SQLite tables：

```sql
CREATE TABLE IF NOT EXISTS vss_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vss_files (
  path TEXT PRIMARY KEY,
  content_hash TEXT,
  mtime INTEGER,
  size INTEGER,
  status TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS vss_chunks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  embedding BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE(path, chunk_index)
);
```

初始化后执行 `vector_init`：

- dimension: `1024`
- type: `FLOAT32`
- distance: `COSINE`

写入向量使用 `Float32Array`/BLOB，不再用 JSON 数组作为主存储格式。

检索使用 `vector_full_scan` 精确搜索；返回时将 cosine distance 转为旧接口兼容 score。

## Embedding Strategy

新安装默认：

- Qwen embedding model: `text-embedding-v4`
- dimensions: `1024`

旧用户：

- 不静默覆盖 `embeddingModelName`。
- 只有当旧值等于项目旧默认 `text-embedding-v3` 时显示推荐迁移。
- 自定义模型只显示 profile 状态，不主动劝迁移。

当前实现使用 `VSS_DEFAULT_DIMENSIONS = 1024` 作为 VSS profile 维度。是否增加用户可配置的 `embeddingDimensions` 设置仍是待确认项；在确认前不静默开放维度配置，避免用户选到与模型或已有索引不一致的维度后触发额外重建成本。

记录 profile 签名：

```text
provider + baseURL + model + dimensions + distanceMetric
```

profile mismatch：

- 索引标记 stale。
- 不混用旧向量。
- 不自动重建。
- 用户确认后才重新调用 embedding。

第一版仍走 OpenAI-compatible embeddings；不实现 DashScope 专用 query/document、instruct、sparse 能力。

## Lifecycle

- `AIService.vectorizeDocument` 拆分为：
  - markdown 清洗。
  - chunking。
  - embedding 生成。
  - index 写入。
- 手动 refresh/rebuild：
  - 扫描 eligible markdown。
  - 计算 `contentHash`。
  - unchanged 文件跳过。
  - changed 文件事务内删除旧 chunks，写入新 chunks。
  - 清理索引中已删除文件的记录。
- 旧 `vss-cache/*.json`：
  - 不再启动加载到内存。
  - SQLite 重建成功后可提示清理。
  - 清理必须满足全部条件：SQLite index ready、`chunkCount > 0`、profile 匹配、最近 rebuild/refresh 无 fatal error、marker 已成功写入。
  - 清理前显示将删除的 JSON 文件数和估算大小。

## User Interactions

VSS 状态必须在聊天或状态栏可见：

- `Not initialized`
- `Ready: N chunks`
- `Stale profile`
- `Missing local index`
- `Best-effort storage`
- `Fallback memory mode`
- `Disabled`

聊天 RAG 行为：

- Ready：正常检索。
- Not initialized/stale/missing：提示一次，并跳过 RAG。
- Disabled：轻量显示状态，不阻塞聊天。

重建确认弹窗必须说明：

- 将重新调用 embedding 模型。
- 可能产生 token/API 成本。
- 预计文件数/chunk 数。
- 当前模型和维度。

当前实现已经覆盖 token/API 成本确认；预计文件数/chunk 数和当前模型/维度展示属于待补强项，不影响手动 VSS 主路径，但发布前应决定是否纳入本轮。

不在插件启动时弹窗，避免普通使用被打扰。

## Observability

VSS stats 作为产品状态保存和展示，不只写 debug log：

- `initDurationMs`
- `lastRefreshDurationMs`
- `lastSearchDurationMs`
- `chunkCount`
- `fileCount`
- `estimatedDbBytes`
- `storageUsage`
- `storageQuota`
- `storagePersisted`
- `fallbackMode`
- `lastErrorCode`

性能提示：

- `chunkCount > 50k`：提示精确检索可能变慢。
- `chunkCount > 100k`：建议后续考虑量化检索，但不自动启用。

## Development Phases

### Phase 0: WASM/OPFS/sqlite-vector PoC

- 新增最小 PoC worker。
- 验证 `opfs-sahpool`、`vector_init`、`vector_full_scan`。
- 验证 Desktop/iOS/Android。
- 验证打包后的 WASM/worker asset 路径。
- 输出 gate 结果，决定是否进入主实现。

### Phase 1: VectorIndex 接口和 fallback manifest

- 定义 `VectorIndex`、`EmbeddingProfile`、`VSSIndexStats`、`VectorIndexStatus`。
- 抽出 device ID helper，复用 stats 的 localStorage device ID 机制。
- 新增 marker 和 manifest 读写 helper。
- 实现 `MemoryVectorIndex` fallback 的阈值判断，但暂不作为主路径。

### Phase 2: SQLite Worker 后端

- 引入并 pin `sqlite-vector/@sqliteai/sqlite-wasm`。
- 配置 esbuild 复制 WASM/worker assets。
- 实现 `SqliteVectorIndex` worker message protocol。
- 实现 schema 初始化、`vector_init`、upsert、delete、search、stats、reset。
- 保证 DB 操作串行化。

### Phase 3: VSS lifecycle 重构

- 将 `AIService.vectorizeDocument` 拆分为清洗、chunking、embedding、index 写入。
- 改造 `VSS` 使用 `VectorIndex`。
- 移除启动全量加载 JSON 到 `MemoryVectorStore` 的主路径。
- 手动 refresh/rebuild 清理已删除文件索引。
- profile mismatch 时标记 stale，不自动重建。

### Phase 4: UI 状态、提醒、命令

- 新增或调整 VSS 命令：
  - `Initialize/Rebuild Local VSS Index`
  - `Refresh Local VSS Index`
  - `Reset Local VSS Index`
  - `Clean Legacy VSS JSON Cache`
- 在聊天或状态栏显示 VSS 状态。
- 实现 missing local index 提示。
- 实现 rebuild token 成本确认。
- 实现 best-effort storage 警告。

### Phase 5: 旧 JSON 清理和迁移保护

- SQLite ready 后才允许提示清理旧 JSON。
- 清理前显示文件数和估算大小。
- 老用户不静默改 `embeddingModelName`。
- 仅旧默认 `text-embedding-v3` 显示推荐迁移。

### Phase 6: 测试与手动验证

- 补充 unit tests。
- 补充 WASM smoke tests。
- 运行 `npm test`、`npm run lint`、`npm run build`。
- 手动验证 Desktop/iOS/Android。
- 模拟 OPFS 丢失，确认 marker 检测和 token 成本提醒。

## Test Plan

Unit tests：

- profile mismatch 标记 stale，且不触发 rebuild。
- marker 存在但 OPFS DB 缺失时返回 `missing-local-index`。
- `missing-local-index` 状态下 rebuild 可复用现有空后端并恢复索引。
- persistent storage denied 时允许继续，但状态为 best-effort。
- manifest 缺失时不启用 Memory fallback。
- fallback 阈值判断。
- old JSON 不再进入主路径内存加载。
- distance 到 score 转换。
- SQLite worker fatal error 后可重建 worker。
- ChatService 在 RAG 无结果时切回普通 prompt，不传空 `rag_content`。

Phase 0 smoke tests：

- worker lazy-load 成功。
- `opfs-sahpool` DB 创建和重开成功。
- `vector_init` 成功。
- 插入 Float32 embedding。
- `vector_full_scan` 返回 top-k。
- 打包后 WASM/worker asset 路径可加载。

Manual verification：

- Desktop：初始化、刷新、重建、reset、旧 JSON 清理、profile stale 提示、真实 LLM + RAG 聊天。
- iOS：手动 VSS、reload 持久化、refresh、状态命令、真实 LLM + RAG 聊天。
- Android：待实机验证；当前没有 Android 测试设备，README 已标注支持状态为 pending verification。
- 模拟 OPFS 丢失：保留 marker，删除/重置 DB，确认出现 token 成本提醒。

## Assumptions

- 接受继续使用 `sqlite-vector/@sqliteai/sqlite-wasm`，并承担版本 pin、许可证披露和 smoke test 成本。
- VSS 索引是可重建缓存，但因为重建有 API 成本，必须显式检测和提醒。
- 第一版优先稳定、可控、低内存，不追求自动后台索引和量化/ANN。
- Android 支持在没有实机验证前不能视为完整通过。
- `embeddingDimensions` 是否暴露为用户设置需要后续确认；当前实现固定为 1024 维。

## Related Documents

- [VSS SQLite/WASM 架构设计](./vss-sqlite-wasm-architecture.md)
- [VSS Embedding 刷新方案说明](./vss-embedding-refresh.md)：旧 VSS JSON/`MemoryVectorStore` 刷新策略背景文档。
- [Obsidian 插件移动端网络兼容优化方案](./mobile-network-optimization-plan.md)：移动网络兼容背景文档；其中 VSS 自动/手动生命周期以本文和架构设计为准。
