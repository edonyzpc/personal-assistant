# VSS SQLite/WASM 重构开发测试进展

## 文档目的

本文档用于记录 VSS SQLite/WASM 重构从 PoC 到上线验证的开发进展、测试结果、风险处理和关键决策。

设计依据：

- [VSS SQLite/WASM 架构设计](./vss-sqlite-wasm-architecture.md)
- [VSS SQLite/WASM 实施计划](./vss-sqlite-wasm-implementation-plan.md)

本文档不是架构设计的替代品。涉及方案原则、存储模型、状态机、交互策略和风险缓解时，以架构设计和实施计划为准；本文档只记录执行状态和验证证据。

## 当前状态

| 项目 | 状态 |
| --- | --- |
| 重构分支 | `codex/vss-sqlite-wasm-refactor` |
| 创建日期 | 2026-05-02 |
| 最后回顾 | 2026-05-09 |
| 总体阶段 | SQLite/WASM 主路径已完成；Memory 产品体验自动化测试已通过；Rebuild embedding 吞吐和实时进度已优化；首次授权后的后台 Memory 自动维护已实现并通过 Desktop test vault smoke test；Android 待验证 |
| 设计文档 | 已完成，并已补充当前实现快照、接口对齐和 Android 待验证说明 |
| 实现状态 | SQLite/WASM 主路径、manifest/marker、fallback 判定、MemoryManager 产品层、聊天前确认、Answer now fallback、高级入口隐藏、SQLite worker/WASM 内联发布路径、Rebuild 跨文件 embedding batch、provider-aware throttle/retry、实时进度 UI、后台 reconcile/auto flush、VSS 写锁和关键自动化测试已实现 |
| 最近结论 | 自动化测试、lint、生产构建已通过；Desktop 已验证 rebuild、refresh、reset、旧 JSON 清理、profile stale、OPFS 丢失检测与恢复、真实 LLM + RAG 聊天，以及首次授权后的后台 Memory 自动维护；iOS 已验证 rebuild、reload 持久化、refresh、状态命令和真实 LLM + RAG 聊天，存储为 best-effort；iOS resume/focus 后自动 reconcile 仍待真实设备补测；Android 因暂无实机设备仍待验证，并已在 README 标注 |

## 当前代码修改回顾

| 范围 | 主要文件 | 当前结论 |
| --- | --- | --- |
| VSS 核心门面 | `src/vss.ts` | 已从启动全量加载 JSON/`MemoryVectorStore` 改为 SQLite/WASM lifecycle；支持 rebuild、refresh、reset、legacy JSON 清理、profile stale、missing local index、fallback 判定；Rebuild 已支持跨文件全局 embedding batch；新增 `runExclusive` 写锁、`reconcileLocalFiles()`、delete/rename 串行写入和 rolling hash verify |
| Memory 产品层 | `src/memory-manager.ts`、`src/chat-view.ts`、`src/settings.ts` | 普通用户看到 Memory from your notes；首次成本动作确认；成功 prepare/update 后启用 `auto-refresh-after-prepare`；changed notes 在 durable ready 时后台维护且 Chat 不等待 refresh；fallback 只读并提示后台更新不可用 |
| VectorIndex 后端 | `src/vss/*` | 新增 `VectorIndex` 类型、`SqliteVectorIndex`、SQLite worker protocol/worker、`MemoryVectorIndex` fallback、marker/manifest helper；`listFileRecords()` 批量 metadata 接口已实现；主线程不再持有全量向量 |
| 构建与发布 | `package.json`、`package-lock.json`、`esbuild.config.mjs`、`Makefile`、`.github/workflows/release.yml` | pin `@sqliteai/sqlite-wasm`；worker/WASM 内联进 `main.js`；release 和 test vault deploy 回到 Obsidian 标准三文件安装形态 |
| 插件命令与状态 | `src/plugin.ts`、`src/settings.ts`、`src/stats/stats-store.ts` | 普通命令保留 `Prepare Memory`；Desktop 状态栏显示 Memory 状态；高级 reset/clean/status 命令按设置动态隐藏；新安装默认 Qwen v4，旧默认 v3 只提示不静默迁移 |
| 聊天 Memory | `src/ai-services/chat-service.ts` | Memory 有结果时使用 Memory prompt；Memory 无结果或用户选择 `Answer now` 时回到普通 chat prompt，不传空 `memory_content` |
| 自动化测试 | `__tests__/memory-manager.test.ts`、`__tests__/vss.test.ts`、`__tests__/chat-service.test.ts`、`__tests__/plugin-record-note.test.ts`、`__tests__/memory-vector-index.test.ts`、`__tests__/sqlite-vector-index.test.ts`、`__tests__/vss-state.test.ts` | 覆盖 Memory readiness、产品文案、skip-memory 聊天、auto policy changed-notes、fallback read-only、lifecycle、fallback 双硬上限、marker/manifest 路径、missing index 恢复、旧 JSON 清理保护、迁移提示、性能提醒、worker fatal error recovery、Rebuild 跨文件 batch、embedding retry/progress、失败文件停止排队、refresh 进度事件、reconcile metadata/rolling hash/hasMore 收敛 |
| 文档与发布说明 | `docs/vss-sqlite-wasm-*.md`、`README.md`、`README-CN.md`、`CHANGELOG.md` | 架构、实施计划、开发 tracker 已建立；README 标注 Android 待实机验证和标准三文件手动安装；CHANGELOG 增加 Unreleased 记录 |

## 剩余事项

- [ ] Android 实机验证：当前没有 Android 测试设备，不能标记为完整通过；README / README-CN 已明确说明 pending verification。
- [ ] iOS resume/focus 后台 reconcile smoke test：移动端进入后台、锁屏、恢复前台时 timers 可能被系统挂起或节流，需要真实设备验证 visibility/focus 触发是否可靠。
- [ ] rename 事件手动 smoke test：自动化覆盖 rename/delete 语义，仍可补一次 Obsidian UI 侧 rename 实测。
- [ ] 发布前许可证复核：`@sqliteai/sqlite-wasm` 已 pin 精确版本并披露，但正式发布前仍需复核上游许可证和分发条款。
- [ ] `embeddingDimensions` 设置：当前实现固定 `VSS_DEFAULT_DIMENSIONS = 1024`；是否暴露为用户设置待确认，避免错误维度导致索引 stale 或额外重建成本。
- [ ] 大 vault refresh 吞吐优化：让 manual refresh / changed notes 共享 Rebuild 的全局 embedding batch pipeline，避免大量小文件变更时逐文件请求过多。

## 执行原则

- 先做 Phase 0 PoC Gate，再进入主实现。
- Desktop PoC 未通过时停止主实现，重新评估后端方案。
- Mobile PoC 未通过时不阻塞 Desktop 主路径，但 Mobile VSS 必须降级为实验性手动 VSS 或禁用 VSS。
- 不做首次启动自动 prepare/rebuild 或 OPFS/profile 异常后的静默重建；首次用户确认并成功准备 Memory 后，changed notes 可在 durable SQLite/WASM ready 时后台自动维护。
- OPFS 索引是可重建缓存，但重建会消耗 AI credits/API calls，因此丢失检测和重建确认必须优先实现。
- fallback 只能基于 manifest 判断，且必须同时满足 `chunkCount <= 5,000` 和 `estimatedMemoryBytes <= 128MB`。

## 阶段进展

### Phase 0: WASM/OPFS/sqlite-vector PoC

目标：验证 `@sqliteai/sqlite-wasm`、`sqlite-vector`、Worker、`opfs-sahpool` 和打包资源路径能在目标平台形成最小闭环。

状态：代码路径已实现，Obsidian Desktop smoke test 已通过；Obsidian iOS VSS + Chat/RAG smoke test 已通过；Android 因暂无实机设备待执行。

任务：

- [x] 新增最小 PoC worker。
- [x] Worker 内 lazy-load `@sqliteai/sqlite-wasm`。
- [x] 验证 `sqlite-vector` 扩展加载。
- [x] 创建和重开 `opfs-sahpool` DB。
- [x] 创建最小 `vss_meta` / `vss_chunks` 表。
- [x] 写入 Float32 embedding BLOB。
- [x] 执行 `vector_init`。
- [x] 执行 `vector_full_scan` 并返回 top-k。
- [x] 重开 DB 后验证数据仍存在。
- [x] 验证内联 WASM/worker 在标准三文件安装下可加载。
- [x] 验证 OPFS 不可用时返回明确错误码。

平台验证：

- [x] Obsidian Desktop。
- [x] Obsidian iOS。
- [ ] Obsidian Android。

Gate 结果：

- Desktop：通过。Desktop 主路径可继续。
- iOS：通过核心 VSS smoke test；Storage Persistence 为 best-effort。
- Android：待验证；当前无 Android 实机设备，README 已标注该限制。
- 是否进入主实现：是；Mobile 支持级别仍需按 iOS/Android smoke test 结果决定。

记录：

| 日期 | 平台 | 结果 | 备注 |
| --- | --- | --- | --- |
| 2026-05-02 | Obsidian Desktop 1.12.7 / test vault | 通过 | 重建后 `Ready: 6 chunks`；Force Reload 后仍为 `Ready: 6 chunks`，marker/manifest 写入设备子目录 |
| 2026-05-02 | Obsidian iOS / iPhone Mirroring / test vault | 通过 | 初始 `VSS not initialized`；重建后 `Ready: 6 chunks across 5 files`；后端 `sqlite-wasm-opfs-sahpool`；reload 与 refresh 后仍 Ready；Storage 为 best-effort |

### Phase 1: VectorIndex 接口和 fallback manifest

目标：建立与具体后端解耦的索引抽象，补齐 device-scoped marker/manifest，为 SQLite 主路径和 Memory fallback 提供稳定边界。

状态：已实现。

任务：

- [x] 定义 `VectorIndex` 接口。
- [x] 定义 `EmbeddingProfile`。
- [x] 定义 `VSSIndexStats`。
- [x] 定义 `VectorIndexStatus`。
- [x] 抽出 device ID helper，复用 stats 的 localStorage device ID 机制。
- [x] 新增 marker 读写 helper。
- [x] 新增 manifest 读写 helper。
- [x] marker 路径使用 `.obsidian/plugins/personal-assistant/vss-index-state/<deviceId>/marker.json`。
- [x] manifest 路径使用 `.obsidian/plugins/personal-assistant/vss-index-state/<deviceId>/manifest.json`。
- [x] 实现 Memory fallback 的双硬上限判断。
- [x] SQLite 不可用且没有 manifest 时禁用 VSS/RAG，不扫描旧 JSON。

验收：

- [x] 业务层只依赖 `VectorIndex`，不直接依赖 sqlite-vector API。
- [x] manifest 按设备分片，不代表其他设备 OPFS 索引可用。
- [x] fallback 任一阈值超限时禁用。

### Phase 2: SQLite Worker 后端

目标：实现 `SqliteVectorIndex`，把向量存储、检索、删除、统计和 reset 移入 Worker + SQLite/OPFS。

状态：已实现，Desktop 和 iOS 运行时 smoke test 已通过；Android 待验证。

任务：

- [x] 引入并 pin `sqlite-vector/@sqliteai/sqlite-wasm` 精确版本。
- [x] 配置 esbuild 内联 WASM/worker assets。
- [x] 实现 Worker message protocol。
- [x] 初始化 SQLite schema。
- [x] 初始化 `vector_init`。
- [x] 实现 `upsertFile`。
- [x] 实现 `deleteFile`。
- [x] 实现 `search`。
- [x] 实现 `getStats`。
- [x] 实现 `verify`。
- [x] 实现 `reset`。
- [x] 保证 DB 操作串行化。
- [x] 记录 WASM 初始化耗时、搜索耗时和最近错误码。

验收：

- [x] Worker 可 lazy-load。
- [x] 主线程不持有全量向量数组。
- [x] `vector_full_scan` 返回结果稳定。
- [x] `dispose` 后 Worker 和资源可释放。

### Phase 3: VSS lifecycle 重构

目标：把现有 `MemoryVectorStore` + JSON cache 主路径替换为手动 SQLite VSS lifecycle。

状态：已实现。

任务：

- [x] 将 `AIService.vectorizeDocument` 拆分为清洗、chunking、embedding、index 写入。
- [x] 改造 `VSS` 使用 `VectorIndex`。
- [x] 移除启动全量加载 JSON 到 `MemoryVectorStore` 的主路径。
- [x] 手动 refresh/rebuild 清理已删除文件索引。
- [x] profile mismatch 时标记 stale。
- [x] profile mismatch 不自动重建。
- [x] 聊天 RAG 在索引未就绪时跳过检索，不影响普通聊天。
- [x] OPFS 丢失时进入 `missing-local-index`，不自动重建。
- [x] Rebuild 将跨文件 chunks 汇入全局 embedding batch，并按 provider policy 控制 batch size、串行发送、退避重试和失败文件隔离。
- [x] Manual refresh 保留逐文件路径，但接入文件级进度事件。
- [x] 新增 VSS operation queue，串行化 flush、rebuild、reset、delete、rename 和 reconcile 写操作。
- [x] 新增 `reconcileLocalFiles()`，批量对齐 vault 当前文件与 indexed records，并支持滚动 hash verify。

验收：

- [x] 插件启动不触发首次 prepare/rebuild。
- [x] Desktop 和 Mobile 的首次 prepare/rebuild 都遵循用户确认；changed notes 可在首次授权后后台自动维护。
- [x] 缺失索引只在 VSS 入口或聊天需要 RAG 时提示。

### Phase 4: Memory 产品体验、状态、提醒、命令

目标：把普通用户心智从“维护技术索引”改为“让助手读取来自笔记的 Memory”；用户只需要理解数据、成本和安全，高级诊断才暴露技术细节。

状态：Memory 产品层和自动化测试已实现；Desktop 后台维护 smoke test 已通过；iOS resume/focus 后自动 reconcile 待补 smoke test；Android 待验证。

任务：

- [x] 新增 `MemoryManager` 产品层。
- [x] 聊天前默认检查 Memory readiness。
- [x] 新增 `MemoryApprovalModal`，展示 Data、AI provider、Cost。
- [x] First use / local missing / settings changed 触发 rebuild 确认。
- [x] Changed notes 默认策略下触发 update 确认。
- [x] 首次成功 prepare/update 后升级 `memoryApprovalPolicy` 为 `auto-refresh-after-prepare`。
- [x] auto policy + durable ready 时 changed notes 不阻塞 Chat，并后台调度 reconcile/flush。
- [x] fallback 或非 durable 状态下不自动写入，只提示后台更新不可用。
- [x] `Answer now` 本次跳过 Memory，并继续普通聊天。
- [x] `Cancel` 不发送问题，不调用 LLM。
- [x] 状态栏显示 `Memory ready`、`Memory needs update`、`Memory unavailable`。
- [x] 普通命令保留 `Prepare Memory`。
- [x] Advanced memory controls 默认隐藏 reset、clean cache、technical status 等高级命令。
- [x] 技术状态统一放入 `Diagnostic details`。
- [x] persistent storage denied/unavailable 时显示 `This device may need to prepare memory again later.`。
- [x] Prepare/Update Memory 使用长驻 Notice 显示 `Scanning notes`、`Embedding chunks`、`Writing index`、`Retrying in Ns`、`Ready`。

验收：

- [x] 用户不会因为 Memory 静默不可用而误以为功能正常。
- [x] 不在插件启动时弹 OPFS 丢失提醒。
- [x] 凡是可能消耗 AI credits/API calls 的 prepare/update 都先确认。
- [x] Desktop 首次授权、策略升级、Chat 非阻塞 auto update、纯后台 quiet-window flush 已通过 test vault smoke test。
- [ ] iOS resume/focus 后自动 reconcile smoke test。

### Phase 5: 旧 JSON 清理和迁移保护

目标：在 SQLite 索引稳定后安全处理旧 JSON cache，并保护老用户 embedding 设置。

状态：已实现。

任务：

- [x] SQLite ready 后才允许提示清理旧 JSON。
- [x] 清理旧 JSON 前确认 `chunkCount > 0`。
- [x] 清理旧 JSON 前确认 profile 匹配。
- [x] 清理旧 JSON 前确认无 fatal error。
- [x] 清理旧 JSON 前确认 marker 写入成功。
- [x] 清理前显示将删除的文件数。
- [x] 清理前显示估算大小。
- [x] 明确提示不会删除用户笔记。
- [x] 新安装默认 Qwen `text-embedding-v4`、1024 维。
- [x] 老用户不静默改 `embeddingModelName`。
- [x] 仅旧默认 `text-embedding-v3` 显示迁移推荐。
- [x] 自定义 embedding 模型不打扰。

验收：

- [x] 旧 JSON 不会被误删。
- [x] 迁移提示不会导致静默 token 消耗。

### Phase 6: 测试与手动验证

目标：完成单元测试、构建验证和 Desktop/iOS/Android 手动验证。

状态：自动化测试已通过，Desktop 手动验证已通过；iOS 手动 VSS 与真实 LLM + RAG 聊天已通过；Android 待验证。

自动化测试：

- [x] profile mismatch 标记 stale，且不触发 rebuild。
- [x] marker 存在但 OPFS DB 缺失时返回 `missing-local-index`。
- [x] `missing-local-index` 状态下 rebuild 可复用现有空后端并恢复索引。
- [x] persistent storage denied 时允许继续，但状态为 best-effort。
- [x] manifest 缺失时不启用 Memory fallback。
- [x] fallback 双硬上限判断。
- [x] SQLite/OPFS 不可用时仅在 manifest 满足双硬上限时启用 Memory fallback。
- [x] SQLite/OPFS 不可用且没有 manifest 时禁用 VSS，不扫描旧 JSON。
- [x] old JSON 不再进入主路径内存加载。
- [x] distance 到 score 转换。
- [x] 聊天 VSS/RAG 返回空结果时仍能继续生成响应。
- [x] 迁移提示只保留旧默认 v3 并显示 notice，不触发 VSS rebuild 或 embedding。
- [x] SQLite worker fatal error 后可 terminate 并重建 worker。
- [x] device-scoped marker/manifest 路径和 fallback 双硬上限 helper 单测覆盖。
- [x] `MemoryVectorIndex` fallback 搜索和 score 归一化单测覆盖。

命令验证：

- [x] `npm test -- --runInBand --silent`（89 tests）
- [x] `npm run lint`
- [x] `npm run build`（仅有 Browserslist/caniuse-lite 过期提示）

手动验证：

- [x] Desktop 初始化。
- [x] Desktop refresh。
- [x] Desktop rebuild。
- [x] Desktop reload 后 OPFS-SAH 持久化。
- [x] Desktop reset。
- [x] Desktop 旧 JSON 清理。
- [x] Desktop profile stale 提示。
- [x] Desktop 真实 LLM + RAG 聊天。
- [x] iOS 手动 VSS。
- [x] iOS 真实 LLM + RAG 聊天。
- [ ] Android 手动 VSS（无 Android 实机设备，README 已标注待验证）。
- [x] OPFS 不可用降级（自动化覆盖 SQLite/OPFS 初始化失败后的 fallback/disabled 行为）。
- [x] 聊天无 RAG 时不崩溃（无网络单测覆盖，并已验证走普通聊天 prompt；未额外触发真实 LLM 无 RAG smoke test，避免未经确认的模型调用成本）。
- [x] 模拟 OPFS 丢失后出现 token 成本提醒。

## 可观测性记录

| 日期 | 场景 | chunkCount | fileCount | DB 大小 | 初始化耗时 | 刷新耗时 | 搜索耗时 | storagePersisted | fallbackMode | lastErrorCode |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 2026-05-02 | Desktop rebuild + reload + refresh | 6 | 5 | 131072 bytes | 已记录 | 已记录 | 聊天场景另见下方记录 | true | false | - |
| 2026-05-02 | Desktop profile stale + restore | 6 | 5 | 131072 bytes | 已记录 | - | - | true | false | stale 后恢复为 ready |
| 2026-05-02 | Desktop LLM + RAG chat | 6 | 5 | 131072 bytes | 已记录 | - | 已记录 | true | false | - |
| 2026-05-02 | iOS rebuild + reload + refresh | 6 | 5 | 未直接读取 | 已记录 | 已记录 | 聊天场景另见下方记录 | false | false | - |
| 2026-05-02 | iOS LLM + RAG chat | 6 | 5 | 未直接读取 | 已记录 | - | 已记录 | false | false | - |

性能阈值检查：

- [x] `chunkCount > 50k` 时提示精确检索可能变慢。
- [x] `chunkCount > 100k` 时建议后续考虑量化检索，但不自动启用。

## Mobile 手动验证协议

适用平台：Obsidian iOS / Android。iOS 优先使用用户已配置好的 `test` vault。

前置条件：

- `test` vault 已同步最新插件构建文件：`main.js`、`manifest.json`、`styles.css`。
- Mobile 端 Obsidian 已完整同步 `.obsidian/plugins/personal-assistant/`。
- Mobile 端已启用 Personal Assistant 插件。
- Mobile 端已重新打开 Obsidian，以确保加载最新 `main.js`。
- 不在 Mobile 上直接编辑 API token；只验证布尔存在和功能表现。

验证步骤：

1. 打开命令面板，运行 `Personal Assistant: Show Local VSS Index Status`。
   - 首次预期：`Local VSS: VSS not initialized...`。
   - 如果之前已经在该设备重建过，预期可以是 `Ready: N chunks...`。
   - 如果没有这个命令，说明 Mobile 未加载最新构建。
2. 运行 `Personal Assistant: Initialize/Rebuild Local VSS Index`。
   - 确认 token 成本提示。
   - 预期出现 `Local VSS index rebuilt...`。
   - 如果出现 `best-effort storage`，记录但不直接判失败。
3. 再次运行 `Show Local VSS Index Status`。
   - 预期：`Ready: N chunks... Backend: sqlite...`。
   - `N` 应大于 0；同一测试 vault 理想情况下接近 Desktop 的 6 chunks。
4. 完全关闭并重新打开 Obsidian。
   - 运行 `Show Local VSS Index Status`。
   - 预期仍为 `Ready: N chunks...`，且没有自动重建或 token 成本提示。
5. 运行 `Personal Assistant: Refresh Local VSS Index`。
   - 预期出现 `Local VSS index refresh finished.`。
   - 再次查看状态仍为 `Ready`。
6. 打开 `Personal Assistant: Open Chat in Sidebar`。
   - 输入：`请用一句话概括当前测试笔记的主题。`
   - 预期：模型正常返回，最好能看到 `Memory references`。
   - 该步骤会触发真实 embedding/query 和 LLM 调用；如需省 token 可跳过。
7. 可选破坏性验证：运行 `Reset Local VSS Index`。
   - 确认 reset。
   - 预期笔记不丢失，状态变为 `VSS not initialized`。
   - 再运行 rebuild，预期恢复到 `Ready`。
8. 可选 stale 验证：临时把 embedding model 从旧默认 `text-embedding-v3` 改为 `text-embedding-v4`，不要重建。
   - 重开 Obsidian 后运行状态命令，预期 `Index stale`。
   - 验证后恢复为 `text-embedding-v3` 并重开，状态应回到 `Ready`。

需要记录：

- 设备型号、iOS/Android 版本、Obsidian 版本。
- 每一步 Notice 或错误文案。
- rebuild 后的 chunk 数、backend、storage 文案。
- reload 后是否仍为 Ready。
- 聊天是否返回，以及是否显示 `Memory references`。

## 风险跟踪

| 风险 | 当前状态 | 处理方式 | 负责人/记录 |
| --- | --- | --- | --- |
| `opfs-sahpool` 在 Obsidian WebView 不稳定 | Desktop 和 iOS 核心路径已通过，Android 因无实机设备待验证 | Desktop 主路径继续；Android 未通过则降级 Android 支持；iOS 需保留 best-effort storage 提醒；README 已标注 Android 待验证 | Desktop/iOS: 2026-05-02 |
| OPFS 被清理导致重建产生 token 成本 | 已实现基础提醒 | marker 检测 missing index，重建前确认 | - |
| fallback 重新引入内存压力 | 已实现 | manifest + 双硬上限 | - |
| Qwen v4 迁移静默消耗 token | 已实现并自动化覆盖 | 老用户不自动改设置；仅 Qwen + 旧默认 v3 显示一次性推荐提示，不触发 VSS rebuild 或 embedding | 2026-05-02 |
| 旧 JSON 被误删 | 已实现基础保护 | SQLite ready、chunkCount > 0、profile 匹配、无 fatal error、marker 写入成功后才提示清理 | - |
| rebuild 确认信息不够完整 | 待确认是否本轮补强 | 当前已提示 token/API 成本；计划中的预计文件数/chunk 数和当前模型/维度尚未展示 | 2026-05-02 |
| embedding dimensions 是否配置化 | 待确认 | 当前固定 1024 维，避免错误维度导致 stale 或额外重建；如需支持非 1024 维模型，需要补 setting、profile 和 UI 验证 | 2026-05-02 |
| `sqlite-vector` 许可证和包稳定性 | 已处理基础披露 | 已 pin 精确版本，并在 README / README-CN / CHANGELOG 标注发布前复核上游许可证和条款 | - |
| Obsidian 安装器不复制 worker/WASM 额外资产 | 已修复 | worker/WASM 内联进 `main.js`，运行时从内联源码和 wasm data URL 创建 Worker | Desktop: 2026-05-02 |
| sqlite-wasm 控制台噪音 | 已修复 | 过滤未使用的 async OPFS VFS warning/error，并关闭 SQL trace 打开参数 | Desktop: 2026-05-02 |
| refresh 后 `storagePersisted` 被默认值覆盖 | 已修复 | 初始化和写 marker/manifest 前读取当前 Storage Persistence 状态；仅 rebuild 主动申请持久化 | Desktop: 2026-05-02 |
| refresh 对未变更文件也等待 embedding rate gap | 已修复 | 文件 diff 先完成，只有真实调用 embedding batch 前才等待 rate gap | Desktop: 2026-05-02 |
| `missing-local-index` 后 rebuild 恢复失败 | 已修复 | rebuild 恢复路径复用已打开的空 SQLite 后端，避免创建第二个 worker 导致 SQLite 不可用 | Desktop: 2026-05-02 |
| 大 vault rebuild embedding 请求过多 | 已优化 | Rebuild 使用跨文件全局 batch；Qwen v3/v4 单次最多 10 chunks，并用 token-aware throttle 和退避重试控制吞吐 | 1.6.4 / 2026-05-02 |
| refresh 在大量 changed 小文件下仍逐文件 embedding | 待优化 | 当前 refresh 已有文件级进度和 hash skip；下一阶段让 refresh 共享 Rebuild 的全局 batch pipeline | TODO / 2026-05-02 |
| 后台维护在 fallback 下误写入 | 已修复并测试 | `canAutoMaintain()` 只允许 durable SQLite/WASM ready，fallback 下只读并提示后台更新不可用 | 2026-05-09 |
| 大 vault reconcile `hasMore` 持续为 true | 已修复并测试 | reconcile 分 records/files phase 和 cursor 推进，下一轮从上次位置继续并最终收敛 | 2026-05-09 |
| 未来打开 embedding 并发后的 throttle 竞争 | 当前不触发 | 当前 policy 显式 `maxConcurrency: 1` 且外层串行；如后续允许并发，需要把 `nextEmbeddingRequestAt` 升级为并发安全的发送时间预订或队列限速器 | TODO / 2026-05-02 |

## 决策记录

| 日期 | 决策 | 原因 | 后续影响 |
| --- | --- | --- | --- |
| 2026-05-02 | 使用设备子目录保存 marker/manifest | 避免跨设备同步后误判 OPFS 索引可用 | 后续所有本机 VSS 状态文件放入 `vss-index-state/<deviceId>/` |
| 2026-05-02 | fallback 使用双硬上限 | 防止小 chunk 数但高内存或低内存估算但 chunk 过多的情况进入 Memory fallback | fallback 判断必须同时检查 chunk 数和估算内存 |
| 2026-05-02 | Desktop PoC 是硬 gate，Mobile PoC 是支持级别 gate | Desktop 主路径不能建立在未验证的 SQLite/OPFS 后端上；Mobile 不应阻塞 Desktop 价值交付 | Mobile 失败时标记实验性或禁用 VSS |
| 2026-05-02 | Worker/WASM 内联进主插件 bundle | Obsidian/BRAT/手动安装通常只可靠安装 `main.js`、`manifest.json`、`styles.css`，额外 release assets 可能不会进入 vault 插件目录 | Rebuild 不再依赖 `vss-sqlite-worker.js` 或 `sqlite3.wasm` 外部文件 |
| 2026-05-02 | Inline Worker 使用 Blob URL，WASM 使用 data URL 转 Blob URL | 保持 Worker module 运行隔离，同时避免 `app://` 文件加载和安装目录缺文件问题 | Worker client 仍在 dispose 时释放 wasm Blob URL；inline worker 在 terminate 时释放自身 Blob URL |
| 2026-05-02 | marker/manifest 写入前重新读取 Storage Persistence 状态 | reload 后内存默认值不能代表当前浏览器存储持久化状态 | refresh 不再把 `storagePersisted` 误写成 false |
| 2026-05-02 | embedding rate gap 只应用在实际 embedding batch 前 | 手动 refresh 大多数时候是检查变更，不应因未变更文件数量线性变慢 | unchanged refresh 不再因为逐文件 throttle 变慢；有变更时仍保护 embedding 调用频率 |
| 2026-05-02 | `missing-local-index` 下 rebuild 复用当前 SQLite 后端 | OPFS 丢失检测会留下一个已初始化但无 chunks 的后端，恢复时不应再新建 worker 抢占同一 OPFS DB | rebuild 可从 `VSS index missing` 状态恢复到 `Ready: N chunks` |
| 2026-05-02 | 当前实现固定 VSS embedding dimensions 为 1024 | Qwen v4 目标方案是 1024 维；开放维度设置会引入模型兼容和误配置风险 | 是否提供 `embeddingDimensions` 设置留作后续确认 |
| 2026-05-02 | 普通用户心智切换为 Memory from your notes | 用户关心数据、成本和安全，不关心 RAG、embedding、SQLite 等实现细节 | 普通聊天、设置、命令和 Notice 默认使用 Memory 文案；技术词只进入 Advanced diagnostics |
| 2026-05-02 | 初版成本动作按次确认，不长期记住授权 | Memory 准备可能调用 AI provider 并产生费用，不能静默或长期默认授权 | 聊天前检查 readiness；prepare/update 前显示 Data、AI provider、Cost；2026-05-09 起 changed notes 在首次成功授权后可走 auto policy |
| 2026-05-02 | Rebuild 优先优化跨文件 embedding batch，refresh 暂不共享管线 | Rebuild 是大 vault 最重的成本路径；refresh 还承担后台 dirty queue 语义，贸然重构影响面更大 | 1.6.4 先解决 Rebuild 吞吐和进度；refresh 共享全局 batch pipeline 留作下一阶段 |
| 2026-05-09 | 首次授权后 changed notes 可后台自动维护 | 用户已经理解并确认 Memory 数据流、AI provider 和成本；后续小变更不应阻塞 Chat | 新策略 `auto-refresh-after-prepare`；first-use、missing-local-index、settings/profile stale 仍需确认 |
| 2026-05-09 | 自动维护只写 durable SQLite/WASM index | fallback 是降级读取路径，自动写入会让用户误以为持久更新成功 | fallback 下 changed notes 只提示后台更新不可用 |
| 2026-05-09 | 跨设备变化通过 events、resume/startup reconcile、rolling hash 三层发现 | iOS/其他设备同步到本机时可能不产生完整 vault event，metadata 也可能不变 | 启动 60s、prepare 5s、resume 30s、周期 60min reconcile；周期 hash verify 每小时最多 50 个文件 |

## 变更记录

| 日期 | 变更 | 结果 |
| --- | --- | --- |
| 2026-05-02 | 创建重构分支和开发测试进展文档 | 待后续实现阶段持续更新 |
| 2026-05-02 | 实现 SQLite/WASM VSS 主路径、手动 lifecycle、marker/manifest、fallback 判定和基础命令 | `npm test`、`npm run lint`、`npm run build` 已通过；Desktop smoke test 已通过 |
| 2026-05-02 | 完成 Obsidian Desktop 实机 smoke test | rebuild、refresh、reload 持久化、状态栏、marker/manifest 路径均通过；reset/旧 JSON 清理因涉及删除需单独确认 |
| 2026-05-02 | 修复 Desktop smoke test 发现的问题 | Worker Blob fallback、sqlite-wasm 日志噪音、refresh storage status 覆盖问题已修复并重新通过 `npm run lint`、`npm test -- --runInBand --silent`、`npm run build` |
| 2026-05-02 | 优化 refresh 节流位置 | 未变更文件不再触发 3 秒 embedding 间隔；间隔只发生在实际 embedding batch 前 |
| 2026-05-02 | 补齐 lifecycle 自动化测试 | 覆盖 profile stale 不自动 rebuild、marker 存在但 OPFS chunks 缺失返回 `missing-local-index`、persistent storage denied 进入 best-effort |
| 2026-05-02 | 补齐 reset 和旧 JSON 清理自动化测试 | 覆盖 reset 后释放 active backend、删除设备 marker/manifest；旧 JSON 清理必须 SQLite ready、marker/profile 匹配、chunkCount > 0 且用户确认 |
| 2026-05-02 | 同步最新构建到 test vault 并 reload Obsidian | reload 后状态栏仍为 `Ready: 6 chunks` |
| 2026-05-02 | 执行 Desktop 破坏性 smoke test | reset 后状态栏为 `VSS not initialized`；旧 JSON 清理删除 5 个 legacy cache 文件且保留 `dirty.json`；OPFS 丢失模拟进入 `VSS index missing` |
| 2026-05-02 | 修复 OPFS 丢失后的 rebuild 恢复路径 | 首次恢复暴露 `SQLite VSS index is unavailable`；修复后重新构建、同步 test vault 并从 `VSS index missing` 恢复到 `Ready: 6 chunks` |
| 2026-05-02 | 验证 Desktop profile stale 提示 | 临时把测试 vault 的 embedding model 从 `text-embedding-v3` 改为 `text-embedding-v4` 后 reload，状态栏显示 `Index stale`；恢复设置后再次 reload 回到 `Ready: 6 chunks` |
| 2026-05-02 | 修正并补齐聊天无 Memory 单元测试 | mock VSS 返回空检索结果且 mock LLM，不访问真实模型；验证 ChatService 切换到普通聊天 prompt，不传空 `memory_content`，仍正常 stream 响应 |
| 2026-05-02 | 同步最新构建到 test vault | 同步 `main.js`、worker、WASM 和 manifest 后 reload Obsidian，状态栏仍为 `Ready: 6 chunks` |
| 2026-05-02 | 验证 Desktop 真实 LLM + Memory 聊天 | 在 Obsidian Chat 面板提问“请用一句话概括当前测试笔记的主题。”；模型返回中文回答并显示 `Memory references`，状态栏保持 ready |
| 2026-05-02 | 补齐 Mobile VSS 状态查看命令 | Desktop 有状态栏，Mobile 没有稳定状态栏入口；新增 `Show Local VSS Index Status` 命令用于 iOS/Android smoke test 和用户自查 |
| 2026-05-02 | 验证 iOS 核心 VSS 路径 | iPhone Mirroring 下初始状态为 `VSS not initialized`；重建后为 `Ready: 6 chunks across 5 files`，后端 `sqlite-wasm-opfs-sahpool`；Obsidian reload 后仍 Ready；Refresh 后仍 Ready；Storage 为 `best-effort storage` |
| 2026-05-02 | 验证 iOS 真实 LLM + Memory 聊天 | 在 iPhone Mirroring 的 Chat 面板提问 `Summarize this note in one sentence.`；模型正常返回摘要，`Memory references` 可展开并显示来源 `2026-05-01.md` |
| 2026-05-02 | 标注 Android 实机验证限制 | 当前没有 Android 设备，README / README-CN 已明确说明 Android VSS 尚未完整实机验证 |
| 2026-05-02 | 补齐 fallback、迁移和性能阈值自动化验证 | SQLite/OPFS 不可用时根据 manifest 双硬上限进入 Memory fallback 或禁用；迁移提示不改旧默认 v3、不打扰自定义模型；状态命令超过 50k/100k chunks 时显示性能提醒且不自动启用量化检索 |
| 2026-05-02 | 回顾当前代码修改和任务计划完成度 | 补充代码改动范围、Phase 完成快照、剩余事项、接口对齐和 Android 待验证状态 |
| 2026-05-02 | 实现 Memory 产品体验重构 | 新增 `MemoryManager`、聊天前确认弹窗、`Answer now` skip-memory、聊天内 Memory 提示、Memory references、高级入口默认隐藏；`npm test -- --runInBand --silent` 通过 102 个测试，`npm run lint` 和 `npm run build` 通过 |
| 2026-05-02 | 处理 Gemini review feedback | 手动 refresh abort 时不再显示成功 Notice；聊天历史引用块清理改为正则并覆盖空白变化 |
| 2026-05-02 | 发布 1.6.4 Rebuild 吞吐与进度优化 | Rebuild 跨文件 embedding batch、provider-aware throttle/retry、失败文件停止排队、refresh 文件级进度和 Memory Notice 实时更新已实现；发布前 `npm test -- --runInBand` 通过 116 个测试，`npm run lint` 和 `npm run build` 通过 |
