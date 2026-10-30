# Settings Current Status

Updated: 2026-10-30

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

## Current Summary

多服务配置依据 [DEC-077](../product/decisions/dec-077-multi-provider-connections.md)
及 [B-192 Product Spec](../product/specs/pa-multi-provider-connections-product-spec.md)
实现；运行验收及其证据范围见 [B-192 最终验证](../archive/2026/b192-multi-provider-validation.md)，
以下源码契约不表示已发布。

- 概览以默认 AI 服务为主，聊天、笔记 Memory、图片默认继承；按需调整才选择独立连接。
  切换先预览再应用；独立项收起后仍显示，恢复默认同样需应用。
  分组摘要取已保存的默认连接及其自身缓存状态；提交后局部更新，不重建导航或抢焦点。
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
  自定义网关迁移保留原聊天/检索地址、模型及Policy；只有已知官方地址与确认的服务归属冲突才纠正。
  新增连接在写Key前校验非空API地址，字段错误保留草稿；未使用的用途可留空。
- 非秘密草稿随本地返回保留，Key 离开编辑区即清除；取消零提交，关闭 Settings 不自动保存。
  异步保存不能重开已离开的页面或覆盖较新的草稿。
  同一新增草稿在保存期间返回重进时复用进行中的提交，完成后可编辑已创建连接，不重复新建。
  内部页定位保留返回按钮和标题，复用现有移动置顶栏偏移；取消回原入口，新增/删除完成回管理页添加入口。
- Memory 状态取自实际当前配置；切换不自动准备。笔记 Memory 的独立连接只影响笔记
  准备和检索，长期学习与文字准备继续使用聊天连接。
  主开关改变时仅更新概览的Memory区域，不丢连接草稿或移动开关焦点；关闭时不提供准备/更新动作。
- resolver仅解析非秘密配置，不读Key。AIUtils的Agent、Policy及全部文字辅助消费者使用实际
  Chat连接；笔记准备/查询使用embedding用途。端点、模型、有效选项、连接及凭据版本构成
  用途请求身份，发送与结果交付检查同一身份；改名和不影响独立用途的默认变化不撤销该用途请求。

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
token tri-state 与失败补偿；`SettingTab` 只持有未提交草稿和界面状态。
Provider tuple、token-only 修改与跨存储失败语义见
[B-126 Product Spec](../product/specs/pa-silent-first-use-memory-preparation-product-spec.md)。

The [B-106 最终验证](../archive/2026/b106-simple-settings-validation.md) retains
only its historical delivery evidence. B-135 owns the later default-on,
migration, independent-exit, platform-risk audit, and mobile-simulator evidence
described above.

## Navigation Rule

Use this file for current planning. Use the historical review only when exact
finding details, original evidence, or previous risk rationale are needed.
