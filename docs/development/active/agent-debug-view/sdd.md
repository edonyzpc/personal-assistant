# Agent Debug View Software Design Document

Document status: Approved
Updated: 2026-09-22
Work item: B-145
Authority: 本 track 的 source-verified implementation design；工程参数为实现初值与验收预算，非实测结果。
Product spec: [Agent Debug View](../../../product/specs/pa-agent-debug-view-product-spec.md)
Plan: [Delivery Plan](./plan.md)
Tracker: [Development Tracker](./tracker.md)

## Current Source Baseline

核查基线为 `83eecba3` 加本任务未提交文档；运行源码未修改。所有下列文件/符号
已检查；Proposed 标识表示拟新增，不得假称已有接口或已验证行为。

| 接入面 | 现有文件/符号 | 设计处理 |
| --- | --- | --- |
| Composer | [chat-view.ts](../../../../src/chat/chat-view.ts)：`LLMView`、`syncComposerControls`、`reserveConversationId` 调用、`onClose` | 相邻按钮、稳定会话关联、打开 tab；不改变关闭 Chat 本身的取消语义 |
| View/Host | [ChatHost](../../../../src/chat/ChatHost.ts)、[ChatPluginIntegration](../../../../src/chat/plugin-integration.ts)：`initialize`、`createChatHost`、`recoverAfterLayoutReady` | 插件级服务与窄 Host port，view 只消费 |
| 注册/卸载 | [plugin.ts](../../../../src/plugin.ts)：`registerObsidianViews`、`registerObsidianCommands`、`unloadAsync` | 追加受控注册和 begin/dispose，不重排既有 Memory/Chat bootstrap |
| 设置/语言 | [settings.ts](../../../../src/settings.ts)：`settings.debug=false` 默认、`renderAdvancedSection`；[EN](../../../../src/locales/plugin/en.json)/[ZH](../../../../src/locales/plugin/zh.json)：`plugin.settings.advanced.debug.desc` | 沿用开关，修改说明；直接切换时同步撤销 capture epoch |
| Chat 启动 | [chat-service.ts](../../../../src/ai-services/chat-service.ts)：`streamLLM` | startup lease 在 runtime 前；Debug 根身份必须更早创建 |
| 循环与事件 | [runtime](../../../../src/ai-services/pa-agent-runtime.ts)：`streamTurn`；[loop](../../../../src/ai-services/pa-agent-loop.ts)：`runTurn`；[primitives](../../../../src/ai-services/agent-runtime-primitives.ts)：`AgentLifecycleEventEmitter` | 复用业务 run/turn/seq；覆盖前后准备与终态交付 |
| Provider | [ai-utils](../../../../src/ai-services/ai-utils.ts)：`ProviderRequestOptions`、`createOpenAIClientOptions`；[obsidian-fetch](../../../../src/ai-services/obsidian-fetch.ts)：`ObsidianFetchControl`、`traceProviderDispatch` | final serialized dispatch 观察、稳定 attempt ID、动态 gate |
| Prompt/辅助调用 | [prompts](../../../../src/ai-services/pa-agent-prompts.ts)：`createPaAgentAnswerStreamPrompt`；[memory-search-tool](../../../../src/ai-services/memory-search-tool.ts)：`rewriteQueryWithTimeout`、`prepareReranker` | 模板变量不是实际请求；辅助 response 转文本前采集 |
| 删除/预留 | [ConversationPersistence](../../../../src/chat/ConversationPersistence.ts)：`reserveConversationId`、`persistRunningTurn`、`deleteConversation`；[manager](../../../../src/chat/chat-history-manager.ts)：`deleteTurn`、`removeTurnsFromIndex`、`prune` | 绑定预留 ID，所有删除路径通过 durable outbox，不能依靠吞错的 Promise 判成功 |
| Chat 存储 | [chat-history-store](../../../../src/chat/chat-history-store.ts)：`IndexedDbChatHistoryStore`、`MemoryChatHistoryStore`、`UnavailableChatHistoryStore` | 删除同事务写 outbox；增量 schema 升级，保留所有旧数据 |
| 来源治理 | [governance storage](../../../../src/memory/plugin-governance-storage.ts)：`getMemoryGovernanceVaultDeviceScope`、`createMemoryGovernanceOpaqueVaultKey`；[source-access](../../../../src/plugin/source-access.ts) | 复用可靠设备 vault 身份；规则、标签与文件事件均需覆盖 |
| Forget | [coordinator](../../../../src/pa/memory-governance-coordinator.ts)：`forget`、`ExactMemoryProjectionCleanupPort`；[persistence](../../../../src/pa/memory-governance-persistence.ts)：`MemoryForgetOperation` | 复用 pendingOperations，新增 claim 级 cleanup 步骤，覆盖 device_collaboration |
| Legacy Forget / 权限提交 | [legacy store](../../../../src/pa/memory-governance-store.ts)：`MemoryGovernanceStore.forget`；`plugin.ts`：`forgetMemoryFromPagelet`、`forgetConfirmedMemory`；[settings persistence](../../../../src/plugin/settings-persistence.ts)：`saveSettingsPermissions`、`notifySettingsChanged` | legacy tombstone 同样是恢复 authority；权限撤销代际必须与设置权威提交绑定，不能依靠 allSettled listener |
| 媒体 | [image-types](../../../../src/chat/image-types.ts)：`ImageRef`、`ImageVariantRecord` | 仅投影引用与处理版本元数据，无 Blob/新 owner/文件读取 |

## Design And Data Flow

### 模块边界（Proposed）

代码组织于 `src/agent-debug/`，不创建通用 telemetry 框架。

| 模块 | 职责 | 明确不拥有 |
| --- | --- | --- |
| `types.ts` / `projection.ts` | 专用事件/内容 DTO、白名单过滤、缺失原因、usage 归一化 | 原始 SDK 对象、业务消息的深拷贝 |
| `collector.ts` | 采集 epoch、有界队列、delta 合并、身份关联和缺口 | 磁盘等待、业务取消/重试 |
| `store.ts` | Debug IDB、索引、事务、容量、TTL、分页和清理屏障 | Chat/Memory 业务数据所有权 |
| `service.ts` / `governance.ts` | 插件生命周期、动态开关、恢复门、删除 outbox 消费和来源撤销 | Agent 调度、VSS 锁、跨设备同步 |
| `view.tsx` / `components/` | ItemView/React 轨迹、节点详情、分页与安全文本 | 采集生命周期、工具执行 |

Proposed Host port `agentDebug` 通过 `ChatHost` / `AiServiceHost` 注入；不使用全局
singleton、console 拦截或 `window` 挂载。Debug view 使用专用只读查询 Host。
Proposed view type `pa-agent-debug-view`、command `open-agent-debug-history`；新增
locale 前缀 `plugin.agentDebug.*`、CSS 前缀 `.pa-agent-debug-*`。不新建设置开关。

### 身份、时间与采集区间

1. `streamLLM` 接收时产生廉价 `captureId`，关联预留 conversationId / 当前消息，
   即使 debug 关闭也只有非内容身份与动态 gate；不分配正文缓存。启动失败也可有
   一个无 runtimeRunId/Turn 的根记录。启动 lease 必须包在可记录取消/失败的边界内。
2. runtime 建立后把既有 runId 绑定到 captureId，不另造业务 Run；per-turn lease
   在对应 Turn 之前作为排队阶段，不能挂到上一个 Turn 或丢失。
3. Debug 每次开/关/清除增加 `captureEpoch`。同一 Run 可以有多个采集 segment；
   segment 记录起止序号、原因、缺口。关闭同步使旧 sink 失效并清会话详情，
   settings 保存失败不能复活旧 sink。后续设置恢复仍创建新 epoch。
4. `message_end` 的累计内容按实际采集区间投影，不回填开关前 delta。晚到事件
   要同时通过 owner session、epoch、删除屏障与来源检查。新请求可记录其实际
   使用的旧会话输入，但不能反向构造旧事件。
5. wall clock 用于列表与期限；单调时钟用于阶段耗时。分别记录 dispatch、transport
   response、first model content、first provider text、first Chat text committed、
   provider completion、consumer end；未观察到即为空。buffered response 只有
   完整缓冲后可见，不报伪 TTFT。`firstChatTextCommittedAt` 由 `LLMView` 当前有效
   `renderMarkdownInto` 首次提交非空 Agent 正文后发一次无内容事件，不能用
   `text_delta`/`message_update` 替代，也不改变 live render 的 drain/cooldown。
   DOM commit 不等于像素已绘制；真实 app 验证结合下一绘制机会和实际观察。
   Chat 不可见、渲染被撤销、仅工具或无正文时记 unknown/N/A，不记录零延迟。
6. conversationId 可预留但未写入；无 ID 时用当前 Chat 会话的临时 scope，恢复
   可持久 ID 时事务绑定并校验删除 generation。关联缺失不等于删除；不能用 Chat
   库不存在作为自动清除依据。Debug 自己的稳定 captureId 不随绑定改变。

### Provider 与辅助调用接入

- 每次逻辑模型调用分配 `logicalCallId`，包含用途 `answer/context_summary/
  query_rewrite/rerank` 和 parent tool/Turn；通过显式 scoped options 传递，不能
  从模型名、时间或异步全局变量推断。未带 Chat scope 的后台调用不进入本库。
- `requestAttemptId` 在准入成功、即将调用实际 transport 时一次分配；诊断、
  输入快照、transport 结果使用同一 ID。SDK retry 产生新 attempt；stream→invoke
  是同一业务调用的不同尝试方式。未发送的准备/准入失败是阶段结果，不伪造 HTTP。
- 唯一实际 Prompt 观察点为最后来源准入后的 serialized request body；模板变量
  与 `prompt.pipe` 之前的输入只作为逻辑投影，不称为实际 Prompt。SDK tools/model
  kwargs 已应用后再投影。调用 transport 后观察其已有 body，不为采集推迟 dispatch。
- 只处理已存在、在大小预算内的字符串/明确结构对象，复用一次有界解析结果给
  shape、token-limit diagnostic 和安全快照。未知 Request/stream body 不读取、不
  clone、不消费，标 `unobservable_body`；过大/格式未知标缺失，不回退到原始 JSON。
- 所有 scoped model 的 hook 始终安装为动态 cheap gate，关时不解析、遍历或建立
  内容对象；不能在 model 构造时用 debug 值决定永久不安装 callback。
- answer 的现有 chunk 适配与辅助 `invoke` response 转纯文本前观察输出/usage；
  fail-open catch 前记录过滤后的错误，不能改变 rewrite/rerank 的降级行为。
- 归一化 usage 同时保留字段来源、累计/增量语义及完整性。仅一侧输入/输出的和
  是已知下界，不是 provider total；cache/reasoning 是细分时不重复相加。按
  `(logicalCallId, attemptId?, updateKey)` 幂等聚合；SDK 无法归属物理尝试的 usage
  只放逻辑调用级，不复制给每个 attempt，再在 Run 汇总去重。
- completion 后自然到达的 usage 可更新该记录，但不延长流消费、不另读尾部。
  native writing 提前 return、取消、尾部挂起时标统计不完整。业务终态不因 usage
  变化而改变；本地取消与远端是否结束分开表达，保留 detached/unknown 状态。

### 持久与会话 DTO

持久 `DebugRecord` 与 `SessionDetail` 使用不同类型；store 只接受前者，不接受
`PaAgentMessage`、`PaAgentPersistedTurn`、SDK response 或任意 `Record<string, unknown>`。
`thinking`、reasoning 专用字段和整个 metadata 对象不能经通用 JSON serializer
落盘。设置快照只挑选 provider/model/非秘密参数，不能复制整个 settings。

持久内容块包含 `kind/text/orderedRefs/sourceRefs/claimIds/legacyRecordRefs/
conversationRefs/lineageCompleteness/possibleDomains/sourceGenerations/redactions/
version`。聚合摘要和后续 Prompt 继承实际派生
来源；输出无法精确切分时保守继承其输入来源全集，不用“未发现引用”当作无来源。
`lineageCompleteness=unknown` 不能仅靠缺失的 claim link 查找：`possibleDomains`
至少区分 vault_notes、personal_memory、insights、legacy_memory、chat_history，
不确定时取可能域全集，并建立 domain+unknown 索引。Forget 清理精确链接和相应
域全部 unknown 内容；device claim 的该选择器跨所有 vault 分区。相关规则收紧时
整块或整 Run 内容失效，元数据仅保留无内容统计，不用文本匹配猜来源。
来源 generation 在实际取得/投影材料时取得并沿派生链传播，不能在 Debug 落盘时
给旧准备输入贴上“当前许可”代际；无法证明时按 unknown 处理。去重限定同 vault、
同 lineage、同过滤版本，禁止
仅按 text hash 跨来源/跨 vault 合并。块引用和引用计数在同事务修改。

过滤使用 provider schema 白名单，剔除认证字段、URL 中认证/query 凭据、data URL
媒体和 nested reasoning。错误仅采允许字段，未知 metadata 默认丢弃，不调用对象
getter 或自动 `toJSON`。会话详情也不收凭据。用户正文作为用户数据保存，不能
声称可凭正则识别所有用户自行书写的秘密；认证配置和协议凭据绝不能作为记录来源。

附件保存现有 ImageRef、实际 provider variant 的 hash/mime/尺寸/processor/policy
元数据（有则记录）；缺指纹标未知，不为 Debug 读文件、生成 variant、注册 owner
或下载外部资源。正文显示为文本，不渲染其 HTML、远程图片或自动执行链接。

## Interfaces And Ownership

### 设备 Debug 库与 vault 隔离

选用一个独立的设备本地 IndexedDB，所有用户读写强制以 `opaqueVaultKey` 分区。
这不是跨 vault 历史功能；仅 claim 清理器有跨分区删除权限，绝不返回其他分区正文。
单库能在一个事务写设备 claim 屏障并协调各 vault 内容清理，无需新建数据库目录
注册服务。复用 `getMemoryGovernanceVaultDeviceScope` 和 opaque key 算法；身份
不可用时仅会话模式，不照搬 default-vault/空 path 的正文库 fallback。

Proposed object stores：

| Store | 键 / 索引 | 作用 |
| --- | --- | --- |
| `runs` | `[vaultKey,captureId]`；vault、started、expires | 轻量列表、绑定身份、采集/业务状态、字节水位 |
| `events` | `[vaultKey,captureId,seq]`；vault、run、sequence | 阶段事实/因果与缺口，不内嵌大正文 |
| `contents` | `[vaultKey,captureId,contentId]`；run、claims、legacy、domains、unknownDomains | run-owned 过滤文本块；multiEntry 索引直接承载删除关联，不建平行 links 表 |
| `control` | typed keys：vault/claim/domain/conversation generations、purge jobs、owner recovery、schema | 写屏障、全量清除、分批回收和幂等 applied IDs |

所有普通 store 方法必须绑定 vault scope，禁止暴露通用 `getAll` 给 view。持久提交
在一个事务检查 generations、更新事件/块/字节水位/lastCommittedSeq；commit
失败只产生采集缺口。块不跨 Run 共享，不引入引用计数/全局去重；索引用于分页、
TTL 和容量候选，不加载全库正文。身份、来源和删除范围不因四表布局而改变。

### 初始资源预算

以下为工程选定初值，P0 测量后在保持产品边界下可收紧并记录依据，不是设备实测。

| 参数 | 初值 | 达限行为 |
| --- | --- | --- |
| 当前 vault 持久预算 | 256 MiB accounted bytes | 按最旧 ended Run 淘汰，立即继续最新采集；设备实际 quota 更小时提前处理 |
| 单 Run 持久预算 | 32 MiB / 20,000 事件 | 合并高频事件；保留终态/缺口，超额正文不记录 |
| 单次 request body 检查 / 文本快照 | 2 MiB 输入检查 / 1 MiB 文本块 | 超限标记不可完整采集，不同步解析巨大 base64 body |
| 插件实例待写队列 | 2 MiB 或 2,048 事件 | 合并 delta，优先留边界；舍弃有明确 gap；其中 64 KiB 预留终态/缺口 |
| 当前 vault 会话详情 | 16 MiB，总体 LRU；单 Run 4 MiB | 清最旧详情，显示会话内容已淘汰 |
| flush | 每 250 ms 或 128 事件/256 KiB；终态触发 | 单 writer；不 await 主 Agent；每批允许 yield |
| 实时 UI / 分页 | 最多 10 Hz；每页 50 Run / 200 节点 | 终态立即调度；隐藏不渲染；长文本按需分块 |
| 清理 | 每批 20 Run 或 2 MiB，启动/恢复/写前及每 5 分钟检查 | 批间 yield；过期读取先过滤，不等全扫 |

accountedBytes 是 UTF-8 内容、DTO 编码及每行 256-byte 索引预留的保守应用预算，
不是 IndexedDB 物理文件字节的精确声明；不把 `navigator.storage.estimate` 的整个
origin 用量当 Debug 用量。quota failure 后淘汰一批并至多重试本批一次，仍失败则
有界会话降级；没有可淘汰项时保留缺口。UI 分别显示“本分区记录用量/上限”和
“浏览器配额不足”，不能无穷循环删除或重试。计数包括所有 Debug 自有记录和索引预留。

## Lifecycle And Cleanup

### 启动、设置、视图与卸载

- 插件持有一个 service，按既有 onload ordering 注册 view/command；service lazy
  open IDB，不阻塞 Chat。调试正文可见前等待身份、删除 outbox、Memory tombstone
  和最新来源规则恢复门；统计可先显示“恢复中”。debug=false 也必须完成必要清理。
- 复用 setting，不重置旧值。旧 debug=true 升级后用一次非阻塞说明明确新增的
  本机正文保留行为，沿用开关，不引入第二授权。false 不主动打开 view。
- Proposed `open-agent-debug-history` 不受 capture 开关限制；按钮只在 debug=true
  显示，生成期间保持可用。view 仅保存非敏感 route ID；Obsidian workspace state
  不保存正文、Prompt、reasoning、错误消息或含用户内容的标题。
- 同 vault 多窗口/leaf 共用持久 control generations。可用时用标准同源通知只发
  无内容 epoch；查询/提交仍重验，不依赖通知正确性。无通知时仅可见 Debug 以
  1 秒间隔检查轻量 epoch，并在 focus/resume 立即复核；隐藏 view 不轮询正文。
- 删除/失效时当前详情立即清空，query generation 丢弃迟到结果；关闭 view 取消
  定时器/observer/订阅，`root.unmount()`。打开 Debug 不关闭 Chat leaf，避免其
  `onClose` 触发原有任务取消；新 tab/拆分叶子不得替换运行 Chat。
- `unloadAsync` 首先同步关闭 Debug admission/清 session，再有界收尾；最长 500 ms
  尽力 flush，之后关闭连接并释放监听。未提交尾部下次标未知，不延长插件退出。

### 对话删除：跨库 outbox

Chat 与 Debug 不共享事务，单靠回调不能保证崩溃后不恢复内容。

1. UI/manager 删除开始先撤销当前会话 content lease，清已打开详情。Chat store
   同一个删除事务追加 Proposed `debugDeletionOutbox`：operationId、scope、
   conversationId、受影响的稳定 runtimeRun/message IDs；不含正文或标题。
2. 接入 `deleteConversation/deleteTurn/deleteTurnsForConversation/prune` 的 store
   路径。truncate/retry 删除用被删除记录中的旧 IDs，不用可复用 turnIndex 单独
   定位；缺旧 IDs 时按会话内容保守失效，不能误删后来使用相同 index 的新 Run。
3. Debug consumer 在自己事务持久 conversation/Run tombstone，再删除/递减块
   引用、索引、事件并记录 applied operationId；较大删除分批但查询立即被屏蔽。
4. Debug 提交成功后 ack Chat outbox；各间隙崩溃均幂等重试。启动读取 pending
   outbox 后先设屏障，才能展示相关正文；新 append 每次事务检查 tombstone。
5. Chat 删除成功但 Debug 清理失败时，不恢复 Chat、不显示全清成功。调整
   ConversationPersistence 的结果表达或消费独立清理 receipt；其当前吞异常
   `Promise<void>` 不能作为成功证据。治理数据不可读时相关 Debug 内容保持隐藏。

新增 outbox 是本特性专用的无内容表；当前 Chat schema 递增一版并保留原表，
Memory/Unavailable store 必须实现等价接口或明确不可持久，不做空成功兼容。
无持久 conversation 的采集按 Debug 自身删除屏障处理，不创造空 Chat 记录。

### Forget、来源撤销与派生内容

- 为 `MemoryForgetOperation` 新增可恢复的 claim-level Debug cleanup 阶段/字段，
  由现有 `pendingOperations` 驱动；旧 pending 记录把缺字段归一化为待清理，不
  跳过步骤。不能只在 `cleanupExactProjection` 的 activeLinks 循环内触发。
- Debug 库先写 claim tombstone 阻止全设备各分区读写关联内容，再按 links 分批
  删除正文/Prompt/派生快照和识别信息。claim 属于 device_collaboration 时同样
  扫其所有分区 link；普通 view 永远没有跨分区读取接口。
- 清理 domain+unknown 内容时，在同一屏障事务推进对应 domain generation；
  不明来源块沿用取得原始材料时的域代际，在查询/提交时重验。不能清完当前块后
  让缺 claimId 的旧队列绕过 tombstone 重写；无法证明新代际的内容仍标 unknown。
- registry 不需要另建：单 Debug DB 的 claim 索引覆盖已有分区。新分区/新内容
  写入同事务检查 claim tombstone。清理成功 receipt 返回 coordinator 才允许相应
  阶段完成；DB unavailable/blocked 就保持 pending，不宣称所有副本已清除。
- 若 Forget 在 Debug 尚未初始化时发生，持久 claim 状态/原 pending 仍为恢复
  authority；任何 Debug 内容恢复前先对齐。已经完成的旧 Forget 不重开用户动作，
  其 forgotten tombstone 仍阻止旧副本可见。不能把暂停使用 Memory 当成 Forget。
- `legacy_threshold` 的 `forgetConfirmedMemory → MemoryGovernanceStore.forget`
  不经过 coordinator，单独接入：复用其持久 `forgotten_tombstone` 为 authority，
  Debug control 按 vault+legacyRecordId+forgottenAt 幂等建屏障/purge job。启动及
  读写恢复门核对这些 tombstone；同时清 legacy_memory 域 unknown 内容。原记录
  Forget 成功与 Debug 副本待清理分开反馈，不强制升级 Memory 模式，不假报全清。
- 来源排除包含 settings patch、文件 `#no-ai`/tag/路径变化及范围撤销。仅保存最后
  一次规则并在 listener 中写 purge job 不够；必须覆盖“撤销→通知失败→重新允许
  →崩溃”的时序。采用下节单调撤销协议，规则再次放宽不得恢复旧内容。
- 对来源未知/混合派生内容保守清除相关内容域，保留无内容统计。事件标签、错误、
  preview 和附件路径同样参与清理，不只删 `contents` 表。规则再次放宽不恢复旧数据。
- clear-all 先增加 vault generation，清 queue/session/view 后分批 purge；清除前
  已发出的请求和旧聚合消息不得重建内容。仍在运行任务只记录清除后的新元数据
  segment，新的用户请求再按新 epoch 采集正文。不得取消业务任务或清原附件。

### 来源撤销的权威提交与恢复

1. 在现有权限设置中 Proposed `dataBoundary.sourceRevocationEpoch` 保存一个
   不含正文/路径/Run/设备 ID 的不透明许可代际 token。每次明确收紧来源规则时，
   在 `SettingsPersistence` 的同一次排队保存中随新规则写入新 token；放宽规则
   保留 token。它是来源权限治理元数据，不是 Debug 事件或历史索引；即使 Debug
   关闭也更新。所有权限保存路径必须集中使用该比较/提交逻辑，不能只修一个 UI。
2. Debug 分区与内容记录已校验的 token。token 不同或旧配置缺字段时，先关闭旧
   内容读写门；若已有精确 purge job 则按其清理，否则保守清除该分区旧代际内容
   （保留无内容统计），再 ack 新 token。绝不能直接把旧记录改成新 token。由于
   token 随规则持久化，Debug DB 故障/普通通知失败也不会丢掉撤销历史；设置保存
   失败则保持原权威状态，当前会话已屏蔽内容不自动复活。
3. 数据边界设置按既有行为可能同步；这里只传播权限代际，不传播任何 Debug
   数据。另一设备发现代际变化可保守清理自己的历史。任意外部回滚/备份恢复不能
   保证可追溯完整撤销事件；启动遇到缺失/不可信代际按保守清理，不承诺清除备份。
4. 文件标签/路径事件不与 settings 同事务：观察到撤销时先同步撤销本实例内容
   lease，并把待推进权限代际的操作加入现有持久设置事务队列；等待该 token
   提交后才能确认 Debug 清理。独立设置放宽/后续事件不得取消已排队撤销。相关
   Debug 写入/可见内容在 pending 期间保持关闭，持久化失败如实表示未完成。
5. 为覆盖文件事件后、token 提交前进程退出的窗口，service 在允许历史正文读写
   前，必须先在 Debug control 持久写入 owner-session 标记（当前为 `owner` control）。
   只有正常关闭且已观察的撤销全部 durable、待写与清理屏障均已处理，才清标记。
   恢复发现未正常关闭的标记时，给该 owner 写入有界 `uncertain-owner` 屏障，
   隔离它的 vault_notes 与来源 unknown/派生历史正文；查询对应事件时隐藏
   label/details/contentIds 并标 `recovery_unverified`。无关 owner、已知非笔记域
   历史正文及当前新 owner 的 Run 不进入全库隔离。只有命中持久撤销
   证据或当前明确拒绝来源时物理 purge；无法证明连续权限的内容继续隐藏并标
   `recovery_unverified`，按原 TTL/容量正常回收，不把崩溃/iOS 进程回收本身当
   删除事实，也不能仅凭最新允许规则解除隔离。已验证无关域的正文和无内容轨迹
   仍可诊断。正常重启不因此清除或隔离历史；无法持久建立标记则不开放持久正文。
   500 ms 卸载预算到期时保持标记，不假报 clean shutdown。
6. 多窗口复用本设计的无内容通知能力确认仍存活的 owner；无法确认时按异常恢复
   隔离，绝不凭超时推断其他 Agent 已停止。owner 屏障阻止未验证旧 writer
   再写入相关敏感正文；撤销代际阻止已失效的旧 writer 复活数据。不把插件未运行
   期间观察不到的临时标签变化伪称为已观测；重新运行
   仍校验当前来源规则。新的请求在当前权限及新代际下可采集，旧副本不因放宽复活。

这不增加数据使用权限，不让 Debug 失败阻止 Agent 或用户收紧权限；失败影响的是
Debug 正文可用性和清理完成声明。来源规则保存仍使用原设置事务，不复制整个
settings，不把凭据或 Debug 清理详情加入设置。实现测试必须覆盖 token 提交前后
每个崩溃点以及撤销后立即放宽，证明保守 fallback 实际成立。

## Data, Privacy, Permission And Cost

DEC-041 和 Product Spec 是数据范围 authority。Debug 正文、事件、索引及会话详情
不经过 `saveData`、vault adapter 或 telemetry；唯一设置增量是上节无内容的来源
权限代际，不是同步 Debug 的通道。不从 `redactForLog` 推导持久化安全。凭据及不透明 provider
字段按白名单拒收。并发撤销在 payload 采集、排队、事务提交、查询返回和视图
渲染各边界检查 generation；快照格式版本独立于 provider/model 版本。

Debug 不额外发送网络请求、模型调用或工具，不更改 provider options、采样参数、
上下文预算或消费尾部。真实 prompt/结果本来就可能含用户敏感文字，这正是 Owner
已选择的本机有限保留；不承诺加密、字节级请求复现或不可恢复擦除第三方备份。

## Compatibility, Migration And Rollback

- Debug schema v1 独立初始化；旧 Chat 不回填。旧/新 schema 检查 fail closed，
  不自动重置正文库。`blocked/versionchange` 关闭本实例连接并显示可恢复状态，
  不无限等待或偷偷新建另一个库逃避删除意图。
- 回退功能首先关闭 capture/view 写入，保留 TTL 和删除 consumer；不能仅关按钮
  就遗留不可管理正文。旧插件二进制不懂 outbox/Debug schema，回退前应完成清理，
  或明确保留仅恢复/清理可用的新 reader；不承诺任意旧版本安全管理新正文。
- Desktop/native 与 buffered/mobile 同一数据语义；允许可观测时间/usage 能力
  不同并标未知。平台身份不足不扩大隔离范围。2026-09-23 Owner 将移动端验收
  调整为优先使用 Obsidian CLI mobile simulator；其证据覆盖窄屏布局、控件和通用
  Debug 数据语义，不覆盖 iOS WKWebView 的实际存储/进程行为。只有具体 iOS 系统
  专有风险才要求真机，不能把模拟 adapter 的结果标作真机验证。
- 同一 vault 多窗口、vault 移动/复制、设置复制及插件热重载需要负例。可靠设备
  路径改变视为新 scope，不自动搬迁旧正文或扫描其他库；旧分区仍参与设备级 TTL
  和 claim 清理，只有当前身份分区可展示。

## Test Matrix

现有测试名称已核实；新增测试名称均为 Proposed，由 worker 在对应切片创建。

| Requirement / AC | Unit / integration | App smoke | Failure / fallback | Evidence target |
| --- | --- | --- | --- | --- |
| B-145/REQ-01 / B-145/AC-01 | `chat-view.test.ts`、Proposed `agent-debug-view.test.tsx`；button/command、route、i18n、unmount | 实际点击新入口，实时/历史、开关关闭后命令、窄布局与键盘 | 多 leaf、已选历史不跳转、Chat 不被替换关闭 | T-05 |
| B-145/REQ-02 / B-145/AC-02 | `chat-service.test.ts`、`pa-agent-loop.test.ts`、`agent-run-coordinator.test.ts`；Proposed trace projection | 排队→执行→恢复→交付 | startup/下轮排队取消、早期失败、工具并行/结果未知 | T-03/T-04 |
| B-145/REQ-03 / B-145/AC-03 | `pa-agent-runtime-prompt.test.ts`、`obsidian-fetch.test.ts`、`pa-agent-runtime-search-vss.test.ts`；Proposed usage | 节点 input/result/usage 与已观察事实对照 | logical/physical身份、late usage、partial total、buffered、rewrite/rerank fail-open | T-04 |
| B-145/REQ-04 / B-145/AC-04 | `pa-agent-debug.test.ts`、`chat-plugin-integration.test.ts`、`plugin-settings-persistence.test.ts` | off→on→off，关 tab 后运行、重开/重载 | model 已构造、message_end 回填、隐藏 tab、多窗口 | T-03/T-05 |
| B-145/REQ-05 / B-145/AC-05 | Proposed `agent-debug-projection.test.ts` / `agent-debug-store.test.ts` | 重启前后可用性差异 | nested reasoning、认证 query、data URL、raw JSON、unknown DTO、来源缺失 | T-01/T-02 |
| B-145/REQ-06 / B-145/AC-06 | Proposed store tests：fake clock/quota/cursors/事务；真实 IDB smoke | 重启后到期/最旧淘汰/分页 | 活跃超限、共享引用、物理配额与应用计数不同、schema blocked | T-01/T-06 |
| B-145/REQ-07 / B-145/AC-07 | `chat-history-store.test.ts`、`chat-history-manager.test.ts`、`memory-governance-coordinator.test.ts`、`plugin-settings-persistence.test.ts`；Proposed governance | 删除对话、两种 Memory 模式的 Forget、撤销来源，重载不恢复 | 每个跨库提交点崩溃、late writer、turnIndex复用、设备claim跨分区、未知domain selector、撤销后放宽 | T-02 |
| B-145/REQ-08 / B-145/AC-08 | 现有 `b129-image-request.test.ts`、Proposed projection tests | 图片请求历史与原件变化标记 | 无Blob/base64/asset owner、缺hash、变体与原件不同 | T-04/T-05 |
| B-145/REQ-09 / B-145/AC-09 | `pa-agent-runtime-chat-history.test.ts`、`chat-service.test.ts`；故障注入 | 失败/取消/卸载仍正确 | IDB不可用、observer throw、SDK重试、诊断不增加请求/消费尾部 | T-03/T-04/T-06 |
| B-145/REQ-10 / B-145/AC-10 | `agent-debug-service.test.ts`、`agent-debug-view.test.tsx`；实际三态轻量观察 | Desktop 三态与 CLI mobile simulator；具体 iOS 专有风险再用真机 | 资源上限、关闭基线额外开销、可感知回归 | T-00/T-06 |

### 性能验收预算

Owner 后续明确性能为软约束：下列延迟/CPU 数值仅为诊断参考，不作交付阻塞门。
用有界固定输入与三态观察确认正常 Agent、取消和界面不受明显影响；只针对暴露的
风险补充测试，不做统计认证、额外 provider 成本研究或穷举压力矩阵。

- 关闭模式不新增 provider 调用或正文序列化；确定性本地流程耗时增量目标 ≤2%
  或 ≤5 ms（取较宽者），无新增 ≥50 ms 的 Debug 主线程任务。
- 开启后台采集/实时查看的本地流程耗时增量目标 ≤5% / ≤10% 或 ≤20/30 ms
  （分别取较宽者）；请求 dispatch 到 Chat 首次有效正文 DOM commit 的 Debug
  附加延迟 ≤20/30 ms，同时检查绘制机会/实际可见状态，不用 provider delta 代替。
- 单次同步 enqueue 目标 ≤1 ms；内容处理批次 CPU 目标 ≤8 ms；Debug 不能制造
  ≥50 ms 长任务。取消处理附加延迟 ≤20 ms；真实设备不满足时修复原因而非隐藏采样。
- 队列/session/accounted disk 均不超定义硬上限；超过单项限制有可检索 gap。
  隐藏/关闭视图无持续渲染，unmount 后无残留 listener/timer。能测 JS heap 时记录
  稳态与回收后趋势，不能把 DTO 字节数当进程物理内存。
- 内存/usage/输出等行为指标是硬断言；环境噪声导致性能结论不明确时改用更小
  对照定位，不把未定标为 PASS，也不无依据扩大成长时间统计认证。

## Open Design Findings

设计修正与独立 reviewer 证据统一记录于 Tracker。实现前不得有未处理 P0/P1/P2；
本 SDD 的故障方案必须以测试证据兑现，不把文字闭环当成 runtime 验收。

## Approval

- Design authority: Owner 授权最终设计复核与开发方案；DEC-041 的产品边界不变。
- Approved on: 2026-09-22；主代理完成源码核对及两路独立设计复核收敛。此为工程设计可实施性批准，不代表 Owner 另行授权实现或性能已达标。
- Authorized implementation scope: 2026-09-22 Owner 后续明确授权 GPT 按方案完成开发验证、必要 provider 请求；性能数值仅软参考，不做过度设计/测试。本文数值门由此修订覆盖，正常 Agent 功能、资源有界及数据安全约束保持。Git/发布未授权。
