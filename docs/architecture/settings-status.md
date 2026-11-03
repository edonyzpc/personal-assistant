# Settings Current Status

Updated: 2026-11-03

## Status

| Field | Value |
| --- | --- |
| Document type | Current status / navigation entry |
| Scope | Settings UI, settings persistence, SecretStorage migration follow-ups |
| Current source of truth | Current code and linked product contracts; B-106 historical delivery evidence is retained below |
| Historical design target | [Settings SDD](../archive/settings-ui-sdd.md) |

This document is the current entry point for Settings work. The original
[Settings UI Review](../archive/settings-ui-review.md) is retained as evidence and
contains historical finding evidence. It does not own current implementation
or delivery status.

## Settings UX — 2026-10-29

[DEC-076](../product/decisions/dec-076-settings-ux-and-adaptive-graph.md) 与
[B-191 Product Spec](../product/specs/pa-settings-ux-product-spec.md) 接续 Settings
呈现与导航设计：四组摘要、按需详情、真实状态、保留 Policy model、图谱初始尺寸自适应，
并明确中英文／桌面／移动端要求。设计基线保留为
[已确认预览](../archive/2026/b191-settings-ux-preview.html)。
以下说明当前源码行为；已完成的开发、双端运行验收与证据边界见
[B-191 最终验证](../archive/2026/b191-settings-ux-validation.md)，不代表已发布版本。

## AI 连接与协议适配的职责原则

2026-11-01 Owner 确认的长期边界见 [DEC-078](../product/decisions/dec-078-sdk-protocol-and-agent-boundary.md)：

- 连接定义与 resolver 表达用户选择的真实服务和用途；SDK 负责该服务的协议、消息与模型适配。
- AIUtils 复用同一凭据、请求身份、来源准入、传输和取消路径，协议适配不复制这些机制。
- PA 在结果边界理解文本、工具、usage与完成／失败，harness控制实际准入及效果；provider完成不等于业务任务完成。
- 物理请求沿用 SDK 分类与有界退避，Agent 保留现有跨轮恢复；额度不足和 SDK 明确停止优先，限流不触发 stream→invoke 重发。图像错误脱敏仅保留安全状态、重试标记与等待时间，不复制原始响应；每次发送仍由既有来源、连接和取消准入控制。
- 新抽象以当前消费缺口或具体SDK变化为依据，优先复用SDK，不维护另一份模型路由名单或新增provider平台。

当前源码已按此边界统一连接协议与 SDK 接缝；产品约束见
[B-194 Product Spec](../product/specs/pa-sdk-protocol-agent-boundary-product-spec.md)，
已完成升级的证据及限制见 [B-194 验收](../archive/2026/b194-sdk-protocol-validation.md)。
本节是当前架构，验收记录不是版本发布证明。

### SDK 接缝与恢复职责

当前锁定 `@langchain/core 1.3.2`、`@langchain/openai 1.8.0`，间接 OpenAI SDK 为
`7.47.0`。`AIUtils` 按真实用途连接创建 `PaChatOpenAI`，不从模型名或兼容投影猜服务。
OpenAI 使用公开 `useResponsesApi:true`；Custom 在 protected `_useResponsesApi`
接缝强制 Chat Completions，因为 `false` 本身不能阻止 SDK 的自动选择。
`withConfig` 保留子类及协议策略，SDK `bindTools` 也经过该派生路径。这个窄接缝与
具体 SDK 版本耦合，升级时验证实际请求；不直接替换 SDK 的 internal 模型类。

SDK 负责序列化、消息／工具格式及流式转换。`provider-result` 保留原消息并提取
文本与终态；字符串端口继续接收字符串，不为 SDK 消息扩大所有下游接口。普通
function tools 通过 SDK 保持 `strict:false` 的可选参数语义，Pagelet 自己的
`strict:true` 结构化输出独立生效。provider 完成后仍须领域校验及既有执行准入。

当前 SDK 的普通流转换会遗漏 `response.failed`，PA 只在原始流交界补传失败与
错误码，再让 SDK 继续转换；不复制请求循环。completed 可进入正常结果消费，
incomplete／failed／缺少终态／取消不能执行缓冲工具、交付成功写入或通过 invoke
重放未知结果。工具 call ID、usage、拒绝与媒体块保留；`streamWithInvokeFallback`
及文字辅助使用同一完成规则。

SDK→canonical 边界按消息实际表示区分流式片段与完整结果；`stream()` 也可能交付
完整消息，每次只消费一份调用表示。显式片段载体优先，包括空片段数组；
SDK 的 parsed／raw 镜像不是额外调用，解析失败的调用也不能静默丢失。调用身份
只由真实 ID 和共享的 provider index 关联，名称与参数内容不构成身份。缺失坐标时
生成的本地排列序号不能冒充 provider index；原生 Writing 仍校验未经改写的
provider identity。参数 `{}` 表示完整的空对象，是否合法由工具 schema／领域
校验决定；非空原始参数流无效时，不能以 structured 镜像代替它宣布解析成功。
Dispatcher 不猜测“同名空参数占位调用”，只处理准入、参数校验和已有执行效果去重。

结构化拒绝与普通正文、工具、provider 终态分别保留。SDK 已提供的拒绝信息直接
复用；仅在 SDK 转换遗漏字段的接缝补齐，不复制请求循环或保存完整原始响应。
拒绝说明通过既有聊天正文交付，`provider_refusal` 事实通过 runtime warnings
保留到历史；任务沿既有 incomplete 状态结束，不触发空答复纠正、invoke fallback
或 provider 恢复，不执行同批工具，也不生成 Writing 成果／恢复稿。取消、来源
失效及真正的传输失败仍保留各自优先级，provider 的 stop 不等于用户任务完成。

`provider-retry-policy` 先委托 SDK 默认 handler。只有 SDK 明确归为
`capacity/headerless_429` 且允许重试时才回到既有 AsyncCaller/pRetry，复用原次数、
指数退避与抖动。SDK 已识别的短等待提示照常处理，过长等待不强行改为 SDK 即时重试。
SDK 耗尽或流中断后，既有 Loop 继续负责有限跨轮恢复、等待、预算与取消；不增加
第三套计时器或计数器。SDK 公开的 false 标记及额度停止优先于乐观 true；真实 SSE
额度错误可能无 HTTP status，仍使用 SDK 默认 handler 的错误码识别，不另抄额度规则。
图像失败在脱敏前解析事实，只保留安全 status、SDK 重试标记及有限非负等待时间，
不携带原 message、body、headers 或 cause。重试前仍检查当前来源、连接身份和取消。

连接、发送／工具／结果准入及实际效果分别由原 resolver、harness 和领域 owner
负责，遵循 [Command Architecture Contract](./pa-agent-architecture-plan.md#command-architecture-contract)。
OpenAI 显式 `store:false`，每轮组装当前准入历史，不新增远端会话链或响应缓存。
没有 schema、凭据、历史或 Memory 迁移；回滚需成组恢复源码、依赖锁与相应文档，
不能仅降级依赖而保留不匹配的适配代码，也不清除用户配置或索引。

## Current Summary

Settings 的 AI 入口、子页与交互按
[DEC-079](../product/decisions/dec-079-settings-ai-configuration-ux.md) 和
[B-195 Product Spec](../product/specs/pa-settings-ai-configuration-ux-product-spec.md)
收束；本地验收见 [B-195 最终验收](../archive/2026/b195-settings-ai-configuration-ux-validation.md)。
以下描述当前源码，不是发布证明。

多服务配置依据 [DEC-077](../product/decisions/dec-077-multi-provider-connections.md)
及 [B-192 Product Spec](../product/specs/pa-multi-provider-connections-product-spec.md)
实现；运行验收及其证据范围见 [B-192 最终验证](../archive/2026/b192-multi-provider-validation.md)，
以下源码契约不表示已发布。

- 概览保留四组与原折叠偏好；AI 组只显示已保存的默认服务、例外和缓存状态，并以
  统一“打开”入口进入 AI 详情。顶部跳转、移动进度及其专属监听／置顶偏移已移除；
  scrollRoot、摘要刷新和 Memory 精确深链接保留。Chat 的 AI 修复／高级入口直达 AI 详情。
  已保存 AI 事实变化同时刷新分组与入口主行，不把未应用草稿写入总览摘要。
- AI 详情直接显示默认连接、按需展开的三用途选择和已保存连接列表。选择器只选择，
  相邻原生添加按钮携带默认／具体用途；添加、编辑共用一处页面标题和返回栏。
  聊天、笔记 Memory、图片默认继承；独立或未配置项收起仍显示真实状态。
  独立连接即使与默认是同一条，也明确标注单独使用；全部继承时只显示一条简短摘要。
  连接模型直接可见，新建标准服务的非必要字段收起；Custom 已支持的地址与模型直显。
  可保存不完整连接并如实提示不可用；现有地址只读，修复复用新增连接及显式切换。
  普通 Custom 新增表单和连接行说明自身缺地址／模型的原因，不受其它用途绑定影响。
- 用途变更先展示实际影响，再以单次事务应用；恢复继承同样需应用。
  配置 owner 复用同一投影，在队列执行时比较已展示的语义基线；相关事实漂移时零写入，
  保留意图并更新预览，等待再次应用。改名、凭据修订、Memory 进度及无关用途变化不误拒。
  带用途新建也复核实际已展示的影响，不提前写 Key 或创建连接。
- 连接持有各用途模型/地址和 SecretStorage 引用；用途绑定不复制 Key。
  普通界面只显示可读连接名及凭据状态，不显示内部 ID 或 SecretStorage 名称。
  管理页面提供留空保留、输入替换及单独移除 Key；渲染不读取秘密。
- 新 Key 存储名称采用服务前缀和短防重后缀；旧槽保留兼容，改名不搬迁秘密。
  替换或移除共享旧槽时只分离当前连接，不清空其他连接仍使用的 Key。
  仅明确保存时分配名称，检查宿主名称和连接引用占用；枚举失败不能假定空存储。
  Key写入后，settings保存成功才发布连接；失败补偿不成功须如实报告。
  凭据状态和修订按连接隔离，provider/地区/地址改变通过新增连接完成。
- Settings 与 Chat 首配共用配置 owner 和持久化队列。旧配置需明确迁移；已存在但损坏的
  新 schema 不回退旧全局 Key。迁移后的页面隐藏旧图片连接及旧 Key 编辑入口。
  自定义网关迁移保留原聊天/检索地址、模型及Policy；已知官方地址与确认的服务归属冲突才纠正。
  旧地址为空时，用户明确选择服务后采用该服务默认地址和模型，仍保留旧Key引用。
  新增连接在写Key前校验已填API地址，字段错误保留草稿；未使用的用途可留空。
- 非秘密草稿随本地返回保留，Key 离开编辑区即清除；取消零提交，关闭 Settings 不自动保存。
  异步保存不能重开已离开的页面或覆盖较新的草稿。
  返回保留的非秘密草稿在连接行提示，可继续编辑；取消只丢弃对应草稿。
  选择草稿仅保留真实未提交字段；未编辑或已经提交的字段跟随最新保存值，删除替代不制造反向草稿。
  同一新增入口在保存期间返回重进时复用进行中的提交，完成后可编辑已创建连接，不重复新建。
  选择事务保留于当前 tab 实例，跨隐藏／重建可见其结算状态，只锁选择区；普通连接保存仍沿
  owner 排队，普通资产创建按入口独立防重。无全局操作平台或持久恢复机制。
  内部页定位保留返回按钮、滚动和入口焦点；新增／删除完成回 AI 详情的添加入口。
  普通返回后重新打开缓存 AI 详情，会重建当前状态查询和按钮回调，旧版本结果仍被隔离。
- Memory 状态取自实际当前配置；切换不自动准备。笔记 Memory 的独立连接只影响笔记
  准备和检索，长期学习与文字准备继续使用聊天连接。
  主开关改变时仅更新 AI 详情的Memory区域，不丢连接草稿或移动开关焦点；关闭时不提供准备/更新动作。
  AI 内的管理入口复用原 Memory 详情并保留返回 AI 的来源；内部刷新保留来源，外部精确链接清除来源。
- resolver仅解析非秘密配置，不读Key。AIUtils的Agent、Policy及全部文字辅助消费者使用实际
  Chat连接；笔记准备/查询使用embedding用途。端点、模型、有效选项、连接及凭据版本构成
  用途请求身份，发送与结果交付检查同一身份；改名和不影响独立用途的默认变化不撤销该用途请求。
- OpenAI Chat 默认采用 `gpt-6.1-terra`／reasoning high，不覆盖其它已保存连接的模型。
  当前 [DEC-078](../product/decisions/dec-078-sdk-protocol-and-agent-boundary.md) 将 OpenAI
  连接的全部聊天用途统一为 Responses，Custom 固定 Chat Completions，DashScope
  委托 SDK。新 schema 按真实 providerId，旧 schema 按既有官方地址归属，不按模型名、
  显示 preset 或旧兼容投影切换协议。
- `PaChatOpenAI` 保持 SDK 模型类关系及 withConfig／bindTools 派生策略，公共工厂
  沿用 `createOpenAIClientOptions` 的凭据、请求身份、来源准入与取消。SDK 负责请求、
  消息和流式转换；PA 只在 SDK 丢失必要失败事实时补传，并在共同结果入口解释终态。
  原 SDK 消息块、usage、拒绝与 call_id 保留，纯文字消费者读取文本投影；不再把所有
  invoke 消息强制改成 string content。普通工具保留可选参数语义，Pagelet 的显式
  strict 结构化输出独立保持。
- OpenAI 通过 SDK 公开配置表达 Terra 的 high 和 `store:false`；真实 OpenAI 连接不
  注入 PA 内部温度或 top_p，使用 SDK／API 模型默认，不维护逐型号采样例外。
  Custom／DashScope 保留传入温度；旧非 Terra OpenAI 的内部固定温度改随服务默认，
  不改已保存配置。各请求重建当前准入的 canonical 历史，不新增远端响应链、Conversations 或
  加密推理缓存。failed 保留实际错误，incomplete／缺少终态不作为成功工具执行或
  写入成果；后台 Memory 与独立图片接线不随聊天协议改变。不能由此推定任意模型、
  网关或账户可用。初版 Terra 适配的历史依据保留于
  [B-192 产品修订](../product/specs/pa-multi-provider-connections-product-spec.md#2026-10-31-openai-模型与-api-兼容修订)
  与 [B-193 验收](../archive/2026/b193-readme-validation.md#openai-validation)，升级验收见 [B-194 验收](../archive/2026/b194-sdk-protocol-validation.md)。
- 2026-11-01 Owner后续要求新建OpenAI连接默认embedding使用 `text-embedding-3-large`，
  维度保持1024。仅修改当前新建连接预置，不改显式保存的small或旧单连接兼容预置，
  不自动切换用途、迁移Memory或调用provider。选型与边界见
  [embedding修订](../product/specs/pa-multi-provider-connections-product-spec.md#2026-11-01-openai-默认-embedding-调整)。

下文涉及 vault-scoped token、provider preset 和 tuple 的单连接说明保留为旧 schema
兼容路径；已迁移配置以以上规则为准，其余 Settings 导航/偏好契约继续适用。

Settings 简化的产品目标和旧选项失效规则见
[DEC-033](../product/decisions/dec-033-simple-settings-and-unified-defaults.md) 与
[B-106 Product Spec](../product/specs/pa-simple-settings-product-spec.md)。这是已确定的
产品契约，运行时以当前源码为准；已完成的开发验收见
[B-106 最终验证](../archive/2026/b106-simple-settings-validation.md)。

2026-09-12当前实现已将长期记忆提取与本地习惯学习分别默认开启。缺失值及没有
明确用户关闭证据的旧`false`按新默认迁移为开启；明确关闭或有效暂停继续保留。
迁移不伪造用户确认时间，也不触发历史回填。两项能力各自通过当前调度、预算、
来源与治理边界运行，并可独立关闭；关闭长期提取只停止新增学习，已有有效Personal
仍须通过Memory主开关、来源有效性、治理、排除和遗忘边界后才可使用。

该修订及其scheduler/collector、设置页和Desktop退出证据见
[B-135最终验证](../archive/2026/b135-unified-task-execution-validation.md)，产品修订见
[DEC-034](../product/decisions/dec-034-unified-agent-task-execution.md)。旧B-106不新增任务；
B-135已复用共享Linux/Desktop证据，并以390×844 Obsidian mobile simulator验证设置
可达性。改动面没有macOS/iOS专属路径，因此没有B-135设置真机缺口；Keychain等其它
功能实际拥有的平台门不由本修订取消。

Highest-risk Settings issues are no longer open:

- API token migration clears legacy persisted token fields after SecretStorage
  handling.
- API token editing uses a PA-owned modal over the existing vault-scoped
  SecretStorage ID. It does not patch Obsidian's private Keychain picker DOM or
  programmatically focus the password field when the modal opens.
- Numeric settings use safe parsing and bounds.
- Metadata add form initializes, validates, and resets values.
- Runtime-only settings state is not persisted.
- Provider preset changes and token clearing require explicit confirmation.
- Memory settings copy and visibility have been aligned with current product
  language.

The current Settings implementation uses four groups: AI connection,
Preferences, Notes & privacy, and Advanced & maintenance. Committed summaries
identify the current configuration; advanced fields use native details.
Feature management opens an internal detail with Back to settings, preserving
the overview's expansion, scroll position, entry focus and neighboring drafts.
Old Memory and Appearance deep links resolve to the corresponding detail;
exact recovery targets open the maintenance detail.
Detail navigation has a separate local lifetime from the tab's async generation.
Back, switching details, and leaving then reopening invalidate old navigation and
pending exact targets. Late Memory completions can still refresh committed data
or restore a failed action's button, but cannot reopen a detail or steal focus.
Explicit links sent before display are replayed after mounting; a missing target
falls back only after the current snapshot is ready and while its request is current.
AI purpose targets sent before display are consumed once after mounting. A newer
explicit group or AI request supersedes the older target; leaving clears it.
Mobile Settings and the shared graph / featured-image editors keep text inputs
and selectors at least 16px while retaining larger host fonts; primary controls
retain 44px targets and narrow layouts wrap long values.

Tag styles 位于 Preferences。`tagStyleEnabled` 默认
false，加载时仅原始 `true` 开启；设置切片提交成功后同步标签外观，保存期间禁用
当前开关，失败回滚并保留原有效外观。关闭或卸载清理自有资源，使当前主题和
snippets 接管；跨视图与固定配色契约见 [Tag Appearance](./tag-appearance.md)。

Pagelet preferences and Memory management refresh their own regions. Provider
tuple drafts remain separate from the effective connection, and passive
Settings navigation reads only the token cache state. Permission changes use
queued snapshots and become effective after persistence. The source detail
distinguishes global, Pagelet and Memory exclusions; exclusion text and generated
note policy have explicit Save scope actions and retain drafts on failure.
Editing the policy does not cancel Memory preparation or publish a new scope;
the existing cancellation/admission transaction runs only on explicit Save.

Graph and featured-image options share concrete editors between Settings
internal details and contextual modals. Each entry saves only its changed
fields; the existing persistence queue merges against current settings, so
an older model or graph draft cannot overwrite another entry's newer path,
color or opening choice. Statistics preferences share one Settings detail;
statistics view selection remains in its existing tabs. Ordinary field saves
and statistics choices expose failure/retry feedback.

These are concrete editors in the existing graph, featured-image and chat-image
modules, not a generic settings framework. Back hides a cached detail and keeps
its draft; Cancel restores its committed snapshot. Successful saves advance the
editor comparison baseline; graph apply failures retain the saved-versus-applied
distinction and retry. Modal close disposes its editor; tab hide disposes all
details and navigation listeners while retaining the existing pending-save flush.
Leaving the Ghost detail clears only its sensitive key draft, keeping ordinary
site preferences available. Ghost credentials remain with their existing owner.

Desktop floating local graphs keep the Hover Editor dependency. Initial size
fits the target's own window, up to 550×500 CSS px; changing graph preferences
does not resize already open graphs. Manual width/height controls and their
runtime values are retired. Loading ignores legacy `localGraph.resizeStyle`,
and the next ordinary canonical save removes it without discarding other graph
options. That field alone does not trigger a startup migration write.
Sizing targets newly connected local-graph hover elements in their own window,
using 16px margins (reduced for very small windows) and centered coordinates.
The existing observer/debounce owns this one-time initialization; no continuous
resize service or saved drag dimensions are added. Reverting the code restores
the old default sizing, but cannot reconstruct custom dimensions already removed
by canonical saves; recovering those values requires an existing user backup.

Policy model remains available in advanced AI connection settings. Independent
image connection fields belong to AI connection; image defaults, save locations,
chat-image management and Ghost use their respective functional details. Memory
distinguishes a retained learning preference from a pause while Memory is off;
explicitly stopping conversation learning still revokes vault-structure sharing.
Platform guards and paired zh/en copy apply to the same navigation; mobile
does not expose Ghost configuration or ineffective floating-graph choices.

B-106 已退役的闭合字段集合是 `pagelet.preloadEnabled`、
`pagelet.deepDiscoverEnabled`、`memoryAutoCheckBeforeChat`、`skillContextEnabled`
与 `enabledSkillIds`；它们不再决定运行能力。Pagelet 的唯一后台开关为
`pagelet.backgroundDiscoveryEnabled`，默认 true，保留有效显式 false，不由旧键推导。
关闭只暂停 automatic lane，不重置 scheduler 或阻止手动发现。Skills 使用当前
统一运行契约，不恢复已退役的 enabled-ID 配置。

[DEC-075](../product/decisions/dec-075-legacy-surface-cleanup.md) 进一步退役
`operationsAgentEnabled` 的设置链：通过既有 deprecated projection 忽略旧 true/false，
保存时剔除该字段；它单独存在时也可触发一次规范化保存，不重置其他设置或清理历史。
真实 Operations live availability、独立写权限/来源检查和
`operationsProactiveSaveSuggestionsEnabled` 保留。Pagelet 另移除“高价值回顾提示”
与“相关回顾”两个无效 UI，保留其旧值读取；维护界面的每周扫描设置跳转同步退役，
不删除 weekly 数据或新建调度。实施与验证状态见
[B-189 Tracker](../development/active/legacy-surface-cleanup/tracker.md)。

AI 配置由 `PluginAIConfiguration` 持有共享事务队列、计数 credential lease、
token tri-state 与失败补偿；`SettingTab` 持有未提交草稿、界面状态和非秘密的在途选择／
创建记录。Key 不进入这些记录；离开编辑区清变量与密码输入框，关闭 tab 丢弃普通草稿。
Provider tuple、token-only 修改与跨存储失败语义见
[B-126 Product Spec](../product/specs/pa-silent-first-use-memory-preparation-product-spec.md)。

The [B-106 最终验证](../archive/2026/b106-simple-settings-validation.md) retains
only its historical delivery evidence. B-135 owns the later default-on,
migration, independent-exit, platform-risk audit, and mobile-simulator evidence
described above.

## Navigation Rule

Use this file for current planning. Use the historical review only when exact
finding details, original evidence, or previous risk rationale are needed.
