# VSS Embedding 刷新方案说明

## 目标

在保证 Memory 搜索结果新鲜度的前提下，降低频繁编辑和大 vault 重建时的 embedding 请求数与 Token 消耗，让准备过程有可见进度，并在限流或网络抖动时给用户明确反馈。

本文记录当前 SQLite/WASM VSS 主路径。旧的 JSON cache + `MemoryVectorStore` 方案已不再是默认主路径。

## 当前关键机制

- **事件改造**：`vault.modify` 仅标记脏文件，不立即计算 embedding；后续由文件切换、打开文件、定时器或手动入口触发 refresh。
- **静默窗口 + 最长延迟**：后台 refresh 保留 `quietWindow=30s` 和 `maxDelay=10min`，避免用户连续编辑时反复计算。
- **内容哈希去重**：清洗 Markdown 后计算 `contentHash`；hash 相同直接跳过，不调用 embedding provider。
- **脏队列持久化**：`dirty.json` 持久化待刷新路径，异常退出后可以继续处理。
- **大文件保护**：超过 `largeFileThreshold=1MB` 的文件跳过索引，并清理已有本地索引记录。
- **SQLite/WASM 本地索引**：chunk 和 embedding 写入设备本地 OPFS SQLite，不再把全部向量常驻 JS heap。
- **手动 Rebuild**：重置本设备本地 Memory index，重新扫描 vault，并将所有待更新 chunks 汇入跨文件全局 embedding batch。
- **手动 Update/refresh**：保留逐 dirty 文件刷新逻辑，先做 hash 去重，只对变化文件调用 embedding；当前尚未共享 Rebuild 的全局 batch pipeline。

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
| `largeFileThreshold` | 1MB | 超过该大小的文件跳过 Memory index |
| `qwenMaxBatchItems` | 10 | Qwen v3/v4 单次 embedding 文本上限 |
| `qwenSafeTokensPerMinute` | 900,000 | Qwen v3/v4 安全 TPM 预算 |
| `embeddingRetryDelays` | 2s, 5s, 10s, 20s | 可重试 embedding 错误的退避序列 |

## 触发流程

1. **标记脏**：`vault.modify` 写入 dirty queue。
2. **触发 refresh**：定时器、文件切换/打开、手动 Update，或到达 `maxDelay`。
3. **筛选候选**：按静默窗口、最长延迟和每分钟处理上限挑选文件。
4. **去重判断**：读取本地文件记录，对比 `contentHash`，unchanged 直接跳过。
5. **生成 chunks**：变化文件用 `MarkdownTextSplitter(chunkSize=4000, chunkOverlap=80)` 切块。
6. **调用 embedding**：Rebuild 使用跨文件全局 batch；refresh 当前仍按文件内 batch。
7. **写入 SQLite**：按文件 upsert chunks 和 embeddings，更新 marker/manifest/state。

## 验证覆盖

自动化测试覆盖：

- 3000 个单 chunk 文件时，Qwen v4 按 10 chunks/request 调用 embedding，而不是每文件一次。
- 多 chunk 文件和小文件混合时，跨文件 batch 后仍能按文件正确聚合写入 index。
- 429 等可重试错误会退避重试并发出 retry progress；非限流错误不重试。
- 单个文件 batch 失败后，后续 chunks 不再继续排队。
- Rebuild 和 refresh 都能发出进度事件，Memory Notice 使用同一个 UI 更新。
