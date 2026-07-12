# VSS Embedding 刷新方案说明

> **Status (2026-07-11)**: Current refresh/maintenance contract. Ollama support was removed in v2.0.0; the current provider matrix is Qwen plus supported OpenAI-compatible embedding providers.
## 目标

在保证 Memory 搜索结果新鲜度的前提下，降低频繁编辑和大 vault 重建时的 embedding 请求数与 Token 消耗，让准备和后台维护过程不阻塞聊天，并在限流或网络抖动时给用户明确反馈。

本文记录当前 SQLite/WASM VSS 主路径。旧的 JSON cache + `MemoryVectorStore` / `MemoryVectorIndex` 方案已被废弃，不再作为 fallback 检索路径。

## 当前关键机制

- **事件改造**：`vault.create` / `vault.modify` 先观察本地索引 metadata：启动期旧 mtime replay 仍会经过轻量 observation，只有 metadata 已匹配的 replay 被忽略；普通 `vault.modify` 即使 metadata 匹配也会进入 verify queue，metadata drift 进入 verify queue，缺失 indexed record 才标记 dirty；`vault.rename` 删除旧 path 并标记新 path，`vault.delete` 删除本地索引记录；事件本身不直接计算 embedding。
- **首次授权后的自动维护**：用户确认并成功 prepare/update Memory 后，`memoryApprovalPolicy` 升级为 `auto-refresh-after-prepare`；后续 changed notes 在 durable SQLite/WASM ready 时由后台 reconcile/verify/refresh 维护，Chat 不再等待 refresh。
- **本地静默状态**：后台自动维护只写设备本地 SQLite/WASM OPFS Memory index，并把 marker 与 dirty journal 写入本地 IndexedDB state store；默认不在 vault 中创建 `vss-index-state/`、`manifest.json` 或 `vss-cache/dirty.json`。如果 IndexedDB 暂时打不开，VSS 先把 marker/dirty state 保留在进程内，后续 update/status 路径重试并落盘。
- **静默窗口 + 最长延迟**：后台 refresh 保留 `quietWindow=30s` 和 `maxDelay=10min`，避免用户连续编辑时反复计算。
- **跨设备 reconcile**：启动、首次 prepare 后、窗口恢复和周期任务会扫描 vault 当前文件与 indexed records；新文件标脏，missing indexed path 删除索引，metadata mismatch 只进入验证队列，不会直接让 Memory 进入 changed-notes。
- **低预算 verify queue**：file-open、reconcile metadata mismatch、rolling hash candidate 先进入 verify queue。verify 在平台预算内读取文件并计算 `contentHash`：hash 未变只同步文件级 metadata，hash 变化才标 dirty 并触发后续 refresh。
- **串行写锁**：`flush`、`rebuildLocalIndex`、`resetLocalIndex`、delete、rename、reconcile upsert/delete 和 verify 阶段的索引写入统一经过 VSS operation queue，避免并发写 SQLite index。
- **Shutdown cost control**：插件 unload/热重载后，旧 VSS 实例不会继续启动新的 embedding batch、retry sleep、local state 写入、status update 或后台 retry/reconcile 调度。
- **内容哈希去重**：清洗 Markdown 后计算 `contentHash`；hash 相同直接跳过，不调用 embedding provider。
- **脏队列持久化**：IndexedDB dirty journal 持久化待刷新路径，异常退出后可以继续处理；旧 `dirty.json` 不会被默认导入或改写。
- **大文件保护**：超过 `largeFileThreshold=1MB` 的文件跳过索引，并清理已有本地索引记录。
- **SQLite/WASM 本地索引**：chunk 和 embedding 写入设备本地 OPFS SQLite；搜索所需 vector cache 在 dedicated Worker 中按需加载，不常驻 Obsidian UI 主线程。
- **手动 Rebuild**：重置本设备本地 Memory index，重新扫描 vault，并将所有待更新 chunks 汇入跨文件全局 embedding batch。
- **手动 Update/refresh 与后台 refresh**：手动 Update 仍走 force refresh；后台自动 refresh 走非 force `flush({ silent: true, reason: "auto-refresh" })`，保留逐 dirty 文件刷新逻辑，先做 hash 去重，只对变化文件调用 embedding；当前尚未共享 Rebuild 的全局 batch pipeline。

## Reconcile 与后台调度

`MemoryManager.startAutoMaintenance()` 在插件加载后启动轻量调度器，并在 unload 时清理 timers 和 window/document listeners。自动 reconcile/refresh 只在 `memoryApprovalPolicy === "auto-refresh-after-prepare"` 且 VSS durable backend ready 时运行；verify 是本地 hash/metadata 检查，可在默认确认策略下运行，确认 dirty 后仍走既有确认/自动刷新策略。

`stopAutoMaintenance()` 会让 in-flight background task 和 prepare flow 进入 shutdown-aware 模式：已经返回的长任务不会再 schedule retry/reconcile、刷新 Memory status bar 或弹出成功/失败 Notice。这样插件升级或热重载时，不会由旧实例继续触发 UI 更新或新的 embedding 工作。

默认 reconcile 时机：

- 插件启动后 60 秒。
- 首次成功 prepare/update 后 5 秒。
- window focus 或 `visibilitychange` 恢复 visible 后 30 秒。
- 每 60 分钟一次周期 reconcile。
- Chat 遇到 `changed-notes` 且 auto policy 可用时立即排队 reconcile、verify 和 auto flush；如果只是 pending verification，聊天前最多做一个小预算 fast verify，移动端使用更小的 1-file 预算。Vault-event verify 也可在后台做同类本地检查，以免进程内候选在 reload 前丢失。

`reconcileLocalFiles()` 优先用 `VectorIndex.listFileRecords()` 批量读取 indexed metadata，减少逐文件 worker round-trip。单轮最多处理 2000 个 metadata 项，每批 250 个文件后 `sleep(0)` 让出主线程；未完成时通过 `hasMore` 继续排队。metadata mismatch 不在 reconcile 内读文件 hash，而是进入 verify queue，所以文件只是 mtime/size 漂移时不会把 Memory status 变成 changed-notes。周期 reconcile 还会按游标把最多 50 个 metadata 未变化文件加入 verify queue，用于发现跨设备同步中 mtime/size 未变化但内容变化的少数情况。

`verifyPendingChanges()` 是独立轻量阶段。默认桌面端每轮最多 20 files / 5MB / 500ms，移动端最多 3 files / 512KB / 100ms；聊天 fast path 桌面只处理 5 files / 1MB / 100ms，移动端只处理 1 file / 512KB / 100ms。verify 为了避免队头阻塞会保证每轮至少尝试一个候选，因此首个候选最多可能读取到 `largeFileThreshold=1MB`。verify hash 相同只调用 `VectorIndex.updateFileMetadata()` 更新 `vss_files` 的 `content_hash`、`mtime`、`size`，不重写 chunks，也不调用 embedding provider。verify hash 变化时才进入 dirty queue，并由后续 flush 按 quiet window / max delay / rate limit 更新 Memory。

## Embedding Batch 与限速

Rebuild 在 `VSS.rebuildLocalIndex()` 内部维护一个全局 chunk 队列。扫描文件、计算 hash、跳过 unchanged/empty/large 文件后，待写入的 chunks 按 provider policy 组成 embedding batch；embedding 返回后再按文件聚合写入 `VectorIndex.upsertFile()`。

| Provider / model | Batch 上限 | 并发 | 限速策略 |
| --- | --- | --- | --- |
| Qwen `text-embedding-v4` / `text-embedding-v3` | 10 chunks/request | 1 | 按安全 TPM 预算平滑发送，并保留最小请求间隔 |
| OpenAI-compatible default | 8 chunks/request | 1 | 串行 batch，保留最小请求间隔 |

Qwen v3/v4 当前使用 `900,000 TPM` 作为安全预算。实现上用保守字符估算近似 token 数，不引入 tokenizer 依赖。遇到 429、rate limit、quota、`Request rate increased too quickly` 或网络超时，会按 `2s -> 5s -> 10s -> 20s` 退避重试；非限流错误直接让该 batch 失败。

所有 embedding provider 的 LangChain 参数都由 VSS 显式传入：`batchSize` 由 provider policy 决定，`maxConcurrency: 1`，`maxRetries: 0`。外层只对整批请求做可控重试，避免库内部并发拆 batch 造成不可见限流。

## 进度事件与用户反馈

`VSSProgressEvent` 用于把长任务进度传给产品层：

- `scanning`：正在扫描 notes，包含 `filesTotal`、`filesDone`、`currentFile`。
- `embedding`：正在生成 embeddings，包含 `chunksTotal`、`chunksEmbedded`。
- `writing`：正在写入本地 SQLite index。
- `retrying`：embedding batch 遇到可重试错误，包含 `retryDelayMs`。
- `ready`：准备完成。

`MemoryManager.prepareMemory()` 使用同一个长驻 Notice 更新进度，常见文案包括：

- `Scanning notes 120/3000`
- `Embedding chunks 120/661`
- `Writing index`
- `Retrying in 5s`
- `Ready`

DOM 更新节流到约 350ms，`retrying` 和 `ready` 会立即显示。

## 失败处理

- 单文件读取、hash、split、写入失败只增加失败计数，继续处理其他文件。
- 单个 embedding batch 最终失败时，涉及的文件会标记为 failed；该文件不会写入不完整 embeddings。
- 对于一个大文件，如果某个 batch 失败，后续 chunks 不再继续排队，避免产生不会被写入的额外 embedding 请求。
- Rebuild 已经 reset 本地 index，因此中途失败仍保持当前语义：可能得到部分可用的本地 Memory index；本阶段不做临时 index 原子替换。

## 当前限制与后续优化

- Manual Update/refresh 仍使用逐文件 refresh 路径，没有共享 Rebuild 的跨文件全局 batch pipeline；大量 changed 小文件时仍可能有较多 embedding 请求。
- 当前不支持暂停、取消、断点续建或临时 index 原子替换。
- 当前限速估算不使用模型 tokenizer；如果真实用户仍撞 TPM，再考虑接入 tokenizer 或暴露用户可配置速率。
- 如果未来允许 embedding 并发，`nextEmbeddingRequestAt` 的限速预约逻辑需要升级为并发安全的队列或同步预订发送时间。

## 参数（当前默认值）

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `quietWindow` | 30s | 后台 refresh 的最小静默时间 |
| `maxDelay` | 10min | 脏文件最长等待时间 |
| `maxPerMinute` | 5 files/min | 后台 refresh 每分钟处理文件数上限 |
| `reconcileBatchSize` | 250 files | reconcile 批间 yield 粒度 |
| `reconcileMaxMetadataItems` | 2000 | 单轮 reconcile metadata 预算 |
| `rollingHashVerifyLimit` | 50/hour | 周期 reconcile 的滚动 verify queue 入队上限 |
| `desktopVerifyBudget` | 20 files / 5MB / 500ms | 桌面后台 verify 单轮预算 |
| `desktopChatVerifyBudget` | 5 files / 1MB / 100ms | 桌面聊天前 fast verify 预算 |
| `mobileVerifyBudget` | 3 files / 512KB / 100ms | 移动端后台 verify 单轮预算 |
| `mobileChatVerifyBudget` | 1 file / 512KB / 100ms | 移动端聊天前 fast verify 预算 |
| `largeFileThreshold` | 1MB | 超过该大小的文件跳过 Memory index |
| `qwenMaxBatchItems` | 10 | Qwen v3/v4 单次 embedding 文本上限 |
| `qwenSafeTokensPerMinute` | 900,000 | Qwen v3/v4 安全 TPM 预算 |
| `embeddingRetryDelays` | 2s, 5s, 10s, 20s | 可重试 embedding 错误的退避序列 |

## 触发流程

1. **发现变化**：`create` / `modify` 先走 observation gate；启动期旧 mtime replay 只在 metadata match 时忽略，metadata mismatch 进入 verify queue，missing record 标 dirty；普通 `vault.modify` 即使 metadata match 也进入 verify queue；`rename` 删除旧 path 并标 dirty，新旧设备同步差异由 reconcile 扫描补齐。
2. **触发维护**：Chat auto policy、vault event quiet window、启动/prepare/resume/周期 reconcile，或手动 Update。
3. **reconcile metadata**：批量读取 indexed records，与 vault 文件列表对比；missing indexed path 删除，新文件标 dirty，metadata mismatch / rolling candidate 进入 verify queue。
4. **verify queue**：按桌面/移动端预算读取少量文件计算 hash；hash 相同只同步 `vss_files` metadata，hash 变化才标 dirty。
5. **筛选 refresh 候选**：按静默窗口、最长延迟和每分钟处理上限挑选 dirty 文件；手动 Update 使用 force refresh。
6. **去重判断**：读取本地文件记录，对比 `contentHash`，unchanged 直接跳过或同步 metadata。
7. **生成 chunks**：变化文件用 heading-aware Markdown chunker 切块，保留 frontmatter 摘要、heading path、起止行号和 `chunkStrategy=heading-aware-v2` metadata；默认 `chunkSize=4000`、`chunkOverlap=80`。
8. **调用 embedding**：Rebuild 使用跨文件全局 batch；refresh 当前仍按文件内 batch。
9. **写入 SQLite**：按文件 upsert chunks 和 embeddings，更新本地 marker、dirty journal 和统计状态。

## 验证覆盖

自动化测试覆盖：

- 3000 个单 chunk 文件时，Qwen v4 按 10 chunks/request 调用 embedding，而不是每文件一次。
- 多 chunk 文件和小文件混合时，跨文件 batch 后仍能按文件正确聚合写入 index。
- 429 等可重试错误会退避重试并发出 retry progress；非限流错误不重试。
- 单个文件 batch 失败后，后续 chunks 不再继续排队。
- Rebuild 和 refresh 都能发出进度事件，Memory Notice 使用同一个 UI 更新。
- VSS dispose 后 read/rebuild 路径不会重新 initialize；并发 stats/search 只触发一次 SQLite 初始化。
- `VSS_SCHEMA_VERSION=2` 的旧 marker 会进入 `stale`/确认重建路径，避免 heading-aware chunking 切换后静默复用旧 chunks。
- Foreground `opfs-sahpool-locked` 不触发 query embedding，也不加载 legacy JSON fallback；manual path 可 bounded retry 恢复 SQLite。
- `SqliteVectorIndex` 在 worker 初始化 pending 时 dispose 会释放 Worker，后续请求拒绝而不是重建。
- auto policy + durable ready + changed notes 时 Chat 不弹确认、不等待 refresh，会调度后台 reconcile/verify/flush。
- 非 durable 或不可用状态下不会执行自动写入，并会提示后台更新不可用。
- reconcile 能发现新增、deleted indexed path，并把 durable ready 下的 metadata mismatch/rolling candidate 放入 verify queue。verify 只有在 hash 真实变化时才标 dirty。metadata-only 漂移不会让 Memory 进入 needs update，也不会把聊天入口的 brain 状态变成 changed-notes。
- vault event observation 能过滤启动期旧 mtime replay 和 metadata 已匹配的 `create`/`modify` 事件；只有 missing indexed record 或 hash-confirmed 变化会写入 dirty journal。
- 大 vault reconcile 的 `hasMore` 能在多轮扫描后收敛，避免持续每秒扫描。
- verify budget 能限制单轮读取文件数、读取字节估算和主线程占用；dirty 清理使用 epoch/stamp 防止 verify 误清除更新的 modify 事件。
