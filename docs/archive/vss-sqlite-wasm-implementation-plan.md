# VSS SQLite/WASM 实施计划

> 2026-05-20 superseded note: this historical implementation plan describes the original marker/manifest and `MemoryVectorIndex` fallback design. The current VSS local state behavior is defined by [VSS Local State Plan](../vss-local-state-plan.md): runtime marker/dirty state is stored in local IndexedDB, manifest generation and JSON fallback are removed, and old vault files are not auto-deleted.

## Summary

- 主路径从 `MemoryVectorStore` 改为 `sqlite-vector/@sqliteai/sqlite-wasm` + `opfs-sahpool` 本机 SQLite 索引，避免启动时全量向量进入 JS 内存。
- 正式实现前先做 Phase 0 PoC Gate：Desktop PoC 是进入主实现的硬门槛；iOS/Android PoC 是 Mobile 支持级别门槛，未通过只降级 Mobile 支持。
- 首次 prepare、missing local index、settings/profile stale 仍需用户确认；用户首次确认并成功准备 Memory 后，changed notes 可在 durable SQLite/WASM ready 时由后台自动维护，Chat 不再等待 refresh。
- 普通用户体验从“维护 VSS 索引”改为“让助手读取来自笔记的 Memory”；技术细节默认隐藏，只在 Advanced diagnostics 中出现。
- VSS 索引是“有 token 成本的可重建缓存”：OPFS 丢失不影响笔记，但重建前必须提醒用户并确认。
- 新安装默认 Qwen `text-embedding-v4` + `1024` 维；旧用户和旧索引只提示迁移，不自动消耗 token。
- 检索精确优先：默认 `vector_full_scan`；超过 `50k` chunks 提醒可能变慢，超过 `100k` chunks 建议未来考虑量化，但不自动切换。

## Implementation Status Snapshot

截至 2026-05-09，本计划已经进入 Phase 6 后的后台维护优化阶段。当前执行状态以 [VSS SQLite/WASM 重构开发测试进展](./vss-sqlite-wasm-development-tracker.md) 为准，摘要如下：

| Phase | 当前状态 | 备注 |
| --- | --- | --- |
| Phase 0 PoC Gate | Desktop/iOS 已通过，Android 待验证 | Desktop 是主实现硬 gate；Android 因无实机设备暂未完整验证 |
| Phase 1 VectorIndex + manifest | 已实现 | marker/manifest 使用设备子目录；fallback 使用双硬上限 |
| Phase 2 SQLite Worker 后端 | 已实现 | worker/WASM 已内联进 `main.js`，release/deploy 回到标准三文件安装 |
| Phase 3 VSS lifecycle | 已实现并扩展 | 插件启动不自动 prepare/rebuild；changed notes 可在首次授权后后台自动 reconcile/flush |
| Phase 4 UI 状态与提醒 | Memory 产品体验已实现，Desktop 后台维护 smoke test 已通过 | 状态栏、聊天前确认弹窗、Answer now fallback、高级入口隐藏和 auto policy 已完成 |
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
- 内联 WASM/worker 在标准三文件安装下可加载。
- OPFS 不可用时能返回明确错误码。

Gate 结果：

- Desktop 通过、Mobile 失败：Desktop 主路径继续，Mobile 标记为实验性手动 VSS 或禁用 VSS。
- Desktop 失败：停止主实现，重新评估后端。

## Storage And Persistence

- `SqliteVectorIndex` 在 dedicated Worker 中 lazy-load `@sqliteai/sqlite-wasm`，优先使用 `opfs-sahpool`。
- 首次手动初始化 VSS 时，在主线程主动调用 `navigator.storage.persist()` 请求 persistent storage。
- 如果 persistent storage 不可用或返回 `false`：
  - 继续允许用户手动建立索引。
  - UI 标注 `This device may need to prepare memory again later.`，提示索引未来可能被系统/WebView 清理，重建会产生 AI credits/API calls。
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
  - 只在 Memory 入口或聊天需要读取 Memory 时提示，不在插件启动时弹窗。
  - 提示用户索引可能被系统/WebView 清理；笔记未丢失；重建会重新调用 embedding 并可能产生 token 成本。
  - 不自动重建。

## Architecture Changes

- 新增产品层 `MemoryManager`，作为 Chat UI 和 VSS 之间的用户体验门面。
- 新增 `VectorIndex` 接口：
  - `initialize(profile)`
  - `upsertFile(fileState, chunks, embeddings)`
  - `deleteFile(path)`
  - `listFilePaths()`
  - `listFileRecords()`
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
  - 任一条件超限即禁用 Memory 检索，聊天普通回答。
- 业务层只依赖 `VectorIndex`，不暴露 sqlite-vector 专有 SQL/API，保留未来替换为 `sqlite-vec` 的空间。
- `sqlite-vector/@sqliteai/sqlite-wasm` 必须 pin 精确版本，并在 README/release notes 披露许可证边界。

## Memory Product Layer

普通用户不直接管理 VSS、RAG 或向量索引。用户看到的是 `Memory from your notes`：

- 默认开启 `memoryEnabled` 和 `memoryAutoCheckBeforeChat`。
- 聊天前调用 `MemoryManager.ensureReadyForChat(prompt)`。
- `ready`：直接使用 Memory 检索并回答。
- `first-use`、`local-memory-missing`、`settings-changed`：显示确认弹窗，确认后调用 `rebuildLocalIndex({ silent: true })`。
- `changed-notes`：
  - 默认 `always` 策略下显示确认弹窗，确认后调用 `refreshLocalIndex({ silent: true })`。
  - 首次成功 prepare/update 后策略升级为 `auto-refresh-after-prepare`。
  - auto policy + durable SQLite/WASM ready 时不弹确认、不等待 refresh；Chat 使用上一版 Memory，同时后台排队 `reconcileLocalFiles()` 和非 force `flush({ silent: true, reason: "auto-refresh" })`。
  - fallback 或其他非 durable 状态下不自动写入，只提示后台更新不可用。
- `unavailable`：普通提示 `Memory is unavailable`，本次走普通聊天。
- 用户点 `Answer now`：本次传入 `memoryMode: "skip-memory"`，不调用 `vss.searchSimilarity()`，聊天内显示 `Memory was not used for this answer.`。
- 用户点 `Cancel`：不发送用户问题，不调用 LLM。
- 同一聊天视图内拒绝后 10 分钟不重复弹窗。

确认弹窗固定包含：

- `Data`: `Your notes will not be changed or deleted.`
- `AI provider`: `To prepare memory, note text may be sent to your configured AI provider.`
- `Cost`: `This may use AI credits or API calls. Unchanged notes will be skipped when possible.`

设置页新增普通 `Memory` 区块：

- `Use memory from my notes`，默认开启。
- `Check memory before chat`，默认开启。
- `Advanced memory controls`，默认关闭。

高级入口中保留维护能力：update、rebuild、reset、clean old cache、technical status、memory model，以及 `Keep memory updated in background` 开关。普通命令面板只暴露 `Prepare Memory` 和 `Open Chat in Sidebar`；高级命令通过当前设置动态隐藏或显示。

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

普通用户看到 Memory 状态，而不是 VSS 技术状态：

- `Memory ready`
- `Memory needs update`
- `Preparing memory...`
- `Memory unavailable`
- `This device may need to prepare memory again later.`

聊天 Memory 行为：

- Ready：正常读取 Memory。
- First use / local memory missing / settings changed：显示确认弹窗。
- Changed notes：默认策略下显示确认弹窗；首次成功 prepare/update 后启用 auto policy，durable ready 时不阻塞 Chat，由后台自动 reconcile/flush。
- 用户确认：prepare/update memory，然后继续原问题；成功后后续 changed notes 可自动维护。
- 用户选择 `Answer now`：本次不读取 Memory，直接普通回答。
- 用户选择 `Cancel`：不发送问题。
- Unavailable：轻量提示后普通回答。

确认弹窗必须说明：

- Data：笔记不会被修改或删除。
- AI provider：准备 Memory 时 note text may be sent to configured AI provider。
- Cost：可能产生 AI credits/API calls；未变化笔记尽量跳过。
- 能估算时显示 notes to check、notes likely to update 和 this device only。

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
- 验证内联 WASM/worker 在标准三文件安装下可加载。
- 输出 gate 结果，决定是否进入主实现。

### Phase 1: VectorIndex 接口和 fallback manifest

- 定义 `VectorIndex`、`EmbeddingProfile`、`VSSIndexStats`、`VectorIndexStatus`。
- 抽出 device ID helper，复用 stats 的 localStorage device ID 机制。
- 新增 marker 和 manifest 读写 helper。
- 实现 `MemoryVectorIndex` fallback 的阈值判断，但暂不作为主路径。

### Phase 2: SQLite Worker 后端

- 引入并 pin `sqlite-vector/@sqliteai/sqlite-wasm`。
- 配置 esbuild 内联 WASM/worker assets。
- 实现 `SqliteVectorIndex` worker message protocol。
- 实现 schema 初始化、`vector_init`、upsert、delete、search、stats、reset。
- 保证 DB 操作串行化。

### Phase 3: VSS lifecycle 重构

- 将 `AIService.vectorizeDocument` 拆分为清洗、chunking、embedding、index 写入。
- 改造 `VSS` 使用 `VectorIndex`。
- 移除启动全量加载 JSON 到 `MemoryVectorStore` 的主路径。
- 手动 refresh/rebuild 清理已删除文件索引。
- profile mismatch 时标记 stale，不自动重建。
- 新增 VSS operation queue，串行化 flush、rebuild、reset、delete、rename 和 reconcile 写操作。
- 新增 `reconcileLocalFiles()`，批量对齐 vault 当前文件与 indexed records。

### Phase 4: UI 状态、提醒、命令

- 新增 `MemoryManager` 产品层。
- 新增聊天前 Memory readiness 检查。
- 新增 `MemoryApprovalModal`，覆盖 Data、AI provider、Cost。
- 普通命令保留 `Prepare Memory` 和 `Open Chat in Sidebar`。
- 高级命令默认隐藏，并按 `Advanced memory controls` 动态显示。
- Chat Memory chip 显示 `Memory ready`、`Memory needs update`、`Memory unavailable` 等普通文案。
- ChatService 支持 `memoryMode: "auto" | "use-memory" | "skip-memory"`。
- `Answer now` 跳过 Memory 检索但继续普通聊天。
- 技术状态只通过 `Diagnostic details` 暴露。
- 首次成功 prepare/update 后升级 `memoryApprovalPolicy` 为 `auto-refresh-after-prepare`。
- auto policy 下 changed notes 使用上一版 Memory 回答并后台维护，不再阻塞 Chat。
- fallback 或非 durable 状态下不自动写入，只提示后台更新不可用。

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
- ChatService 在 Memory 无结果时切回普通 prompt，不传空 `memory_content`。
- `Answer now` 不调用 `vss.searchSimilarity()`。
- Memory readiness 映射到 ready / first-use / changed-notes / local-memory-missing / settings-changed / unavailable。
- auto policy + durable ready + changed notes 不弹确认、不等待 refresh，并调度后台维护。
- fallback 或非 durable 状态下自动维护不写入。
- reconcile 覆盖新增文件、metadata mismatch、删除 indexed path、rolling hash verify 和大 vault `hasMore` 收敛。
- 普通 Memory 文案不包含禁止暴露的技术词。

Phase 0 smoke tests：

- worker lazy-load 成功。
- `opfs-sahpool` DB 创建和重开成功。
- `vector_init` 成功。
- 插入 Float32 embedding。
- `vector_full_scan` 返回 top-k。
- 内联 WASM/worker 在标准三文件安装下可加载。

Manual verification：

- Desktop：初始化、刷新、重建、reset、旧 JSON 清理、profile mismatch 提示、真实 LLM + Memory 聊天。
- Desktop background maintenance：首次授权后策略升级、create/modify/delete 事件、Chat 非阻塞 auto update、纯后台 quiet-window flush。
- iOS：手动 Memory、reload 持久化、refresh、状态命令、真实 LLM + Memory 聊天。
- Android：待实机验证；当前没有 Android 测试设备，README 已标注支持状态为 pending verification。
- iOS resume/focus 后 reconcile 自动触发仍需真实设备补测；移动端 timers 可能被系统挂起或节流。
- 模拟 OPFS 丢失：保留 marker，删除/重置 DB，确认出现 token 成本提醒。

## Assumptions

- 接受继续使用 `sqlite-vector/@sqliteai/sqlite-wasm`，并承担版本 pin、许可证披露和 smoke test 成本。
- VSS 索引是可重建缓存，但因为重建有 API 成本，必须显式检测和提醒。
- 自动维护只在 Obsidian 插件运行期间执行，不创建系统级后台任务；首次 prepare/rebuild、missing local index、profile stale 仍保持用户确认。
- Android 支持在没有实机验证前不能视为完整通过。
- `embeddingDimensions` 是否暴露为用户设置需要后续确认；当前实现固定为 1024 维。

## Related Documents

- [VSS SQLite/WASM 架构设计](../vss-sqlite-wasm-architecture.md)
- [VSS Embedding 刷新方案说明](../vss-embedding-refresh.md)：当前 SQLite/WASM Memory refresh、Rebuild batch、embedding throttle 和进度事件说明。
- [Obsidian 插件移动端网络兼容优化方案](./mobile-network-optimization-plan.md)：移动网络兼容背景文档；其中 VSS 自动/手动生命周期以本文和架构设计为准。
