# VSS Embedding 刷新方案说明

## 目标

在保证 Memory 搜索结果新鲜度的前提下，降低频繁编辑和大 vault 重建时的 embedding 请求数与 Token 消耗，让准备和后台维护过程不阻塞聊天，并在限流或网络抖动时给用户明确反馈。

本文记录当前 SQLite/WASM VSS 主路径。旧的 JSON cache + `MemoryVectorStore` 方案已不再是默认主路径。

## 当前关键机制

- **事件改造**：`vault.create` / `vault.modify` 标记脏文件，`vault.rename` 删除旧 path 并标记新 path，`vault.delete` 删除本地索引记录；事件本身不直接计算 embedding。
- **首次授权后的自动维护**：用户确认并成功 prepare/update Memory 后，`memoryApprovalPolicy` 升级为 `auto-refresh-after-prepare`；后续 changed notes 在 durable SQLite/WASM ready 时由后台 reconcile/refresh 维护，Chat 不再等待 refresh。
- **Durable-only 写入**：后台自动维护只写 SQLite/WASM durable index；`MemoryVectorIndex` fallback 保持只读，changed notes 只显示非阻塞提示，不执行自动写入。
- **静默窗口 + 最长延迟**：后台 refresh 保留 `quietWindow=30s` 和 `maxDelay=10min`，避免用户连续编辑时反复计算。
- **跨设备 reconcile**：启动、首次 prepare 后、窗口恢复和周期任务会扫描 vault 当前文件与 indexed records，发现新文件、metadata mismatch、missing indexed path 后再标脏或删除索引。
- **串行写锁**：`flush`、`rebuildLocalIndex`、`resetLocalIndex`、delete、rename 和 reconcile 写入统一经过 VSS operation queue，避免并发写 SQLite index。
- **内容哈希去重**：清洗 Markdown 后计算 `contentHash`；hash 相同直接跳过，不调用 embedding provider。
- **脏队列持久化**：`dirty.json` 持久化待刷新路径，异常退出后可以继续处理。
- **大文件保护**：超过 `largeFileThreshold=1MB` 的文件跳过索引，并清理已有本地索引记录。
- **SQLite/WASM 本地索引**：chunk 和 embedding 写入设备本地 OPFS SQLite，不再把全部向量常驻 JS heap。
- **手动 Rebuild**：重置本设备本地 Memory index，重新扫描 vault，并将所有待更新 chunks 汇入跨文件全局 embedding batch。
- **手动 Update/refresh 与后台 refresh**：手动 Update 仍走 force refresh；后台自动 refresh 走非 force `flush({ silent: true, reason: "auto-refresh" })`，保留逐 dirty 文件刷新逻辑，先做 hash 去重，只对变化文件调用 embedding；当前尚未共享 Rebuild 的全局 batch pipeline。

## Reconcile 与后台调度

`MemoryManager.startAutoMaintenance()` 在插件加载后启动轻量调度器，并在 unload 时清理 timers 和 window/document listeners。自动任务只在 `memoryApprovalPolicy === "auto-refresh-after-prepare"` 且 VSS durable backend ready 时运行。

默认 reconcile 时机：

- 插件启动后 60 秒。
- 首次成功 prepare/update 后 5 秒。
- window focus 或 `visibilitychange` 恢复 visible 后 30 秒。
- 每 60 分钟一次周期 reconcile。
- Chat 遇到 `changed-notes` 且 auto policy 可用时立即排队 reconcile 和 auto flush。

`reconcileLocalFiles()` 优先用 `VectorIndex.listFileRecords()` 批量读取 indexed metadata，减少逐文件 worker round-trip。单轮最多处理 2000 个 metadata 项，每批 250 个文件后 `sleep(0)` 让出主线程；未完成时通过 `hasMore` 继续排队。周期 reconcile 还会按游标滚动校验最多 50 个 metadata 未变化文件的 `contentHash`，用于发现跨设备同步中 mtime/size 未变化但内容变化的少数情况。

## Embedding Batch 与限速

Rebuild 在 `VSS.rebuildLocalIndex()` 内部维护一个全局 chunk 队列。扫描文件、计算 hash、跳过 unchanged/empty/large 文件后，待写入的 chunks 按 provider policy 组成 embedding batch；embedding 返回后再按文件聚合写入 `VectorIndex.upsertFile()`。

| Provider / model | Batch 上限 | 并发 | 限速策略 |
| --- | --- | --- | --- |
| Qwen `text-embedding-v4` / `text-embedding-v3` | 10 chunks/request | 1 | 按安全 TPM 预算平滑发送，并保留最小请求间隔 |
| OpenAI-compatible default | 8 chunks/request | 1 | 串行 batch，保留最小请求间隔 |
| Ollama | 3 chunks/request | 1 | 本地串行 batch |

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
| `rollingHashVerifyLimit` | 50/hour | 周期 reconcile 的滚动 hash 校验上限 |
| `largeFileThreshold` | 1MB | 超过该大小的文件跳过 Memory index |
| `qwenMaxBatchItems` | 10 | Qwen v3/v4 单次 embedding 文本上限 |
| `qwenSafeTokensPerMinute` | 900,000 | Qwen v3/v4 安全 TPM 预算 |
| `embeddingRetryDelays` | 2s, 5s, 10s, 20s | 可重试 embedding 错误的退避序列 |

## 触发流程

1. **发现变化**：`create` / `modify` 标 dirty，`rename` 删除旧 path 并标 dirty，新旧设备同步差异由 reconcile 扫描补齐。
2. **触发维护**：Chat auto policy、vault event quiet window、启动/prepare/resume/周期 reconcile，或手动 Update。
3. **reconcile metadata**：批量读取 indexed records，与 vault 文件列表对比；missing indexed path 删除，metadata mismatch 或新文件标 dirty。
4. **筛选 refresh 候选**：按静默窗口、最长延迟和每分钟处理上限挑选 dirty 文件；手动 Update 使用 force refresh。
5. **去重判断**：读取本地文件记录，对比 `contentHash`，unchanged 直接跳过。
6. **生成 chunks**：变化文件用 `MarkdownTextSplitter(chunkSize=4000, chunkOverlap=80)` 切块。
7. **调用 embedding**：Rebuild 使用跨文件全局 batch；refresh 当前仍按文件内 batch。
8. **写入 SQLite**：按文件 upsert chunks 和 embeddings，更新 marker/manifest/state。

## 验证覆盖

自动化测试覆盖：

- 3000 个单 chunk 文件时，Qwen v4 按 10 chunks/request 调用 embedding，而不是每文件一次。
- 多 chunk 文件和小文件混合时，跨文件 batch 后仍能按文件正确聚合写入 index。
- 429 等可重试错误会退避重试并发出 retry progress；非限流错误不重试。
- 单个文件 batch 失败后，后续 chunks 不再继续排队。
- Rebuild 和 refresh 都能发出进度事件，Memory Notice 使用同一个 UI 更新。
- auto policy + durable ready + changed notes 时 Chat 不弹确认、不等待 refresh，会调度后台 reconcile/flush。
- fallback 或非 durable 状态下不会执行自动写入，并会提示后台更新不可用。
- reconcile 能发现新增、metadata mismatch、deleted indexed path，以及滚动 hash 校验发现的内容变化。
- 大 vault reconcile 的 `hasMore` 能在多轮扫描后收敛，避免持续每秒扫描。
