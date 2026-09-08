# Simple Settings Software Design Document

Document status: Approved
Updated: 2026-09-08
Work item: B-106
Authority: 本 track 的源码核实实现设计、字段闭集、生命周期与验证映射。
Product spec: [Simple Settings Product Spec](../../../product/specs/pa-simple-settings-product-spec.md)
Plan: [Delivery Plan](./plan.md)
Tracker: [Development Tracker](./tracker.md)

## Current Source Baseline

本轮源码检查基线为 `master@b4de9c03`。开始时未提交修改均为本对话前序
DEC-033/B-106 产品文档；没有 runtime/test/config 修改。本设计中的新增名称均标
`Proposed`，不把设计声明当作已存在接口。实施前重查相关输入和工作区差异。

| Responsibility | Verified source / interfaces | Design implication |
| --- | --- | --- |
| Settings shape 与 UI | [settings.ts](../../../../src/settings.ts)：`mergeLoadedSettings`、`SettingTab.display/openGroup/hide`、`renderMemorySection`、`runMemoryControlCenterAction` | 同一文件包含数据与 UI；保持现有入口，定点拆职责，不重写整套 Settings 框架 |
| Pagelet settings | [settings/pagelet/index.ts](../../../../src/settings/pagelet/index.ts)：`PAGELET_DEFAULTS`、`mergePageletSettings`、`renderPageletSection` | 当前旧 preload→deepDiscover 继承必须删除；局部 renderer 继续复用 |
| Persistence | [plugin.ts](../../../../src/plugin.ts)：`loadSettings`、`saveSettings`、`saveSettingsData`、`enqueueSettingsWrite`、`persistPaSettingsSlice`、`migrateSettingsOnce` | 复用事务与既有 migration，不全对象 reset；原始字段存在性在 merge 前取证 |
| Provider edits | `SettingTab.getEffectiveAIProviderConfiguration/queueAIProviderConfigurationPatch/settleAIProviderConfiguration/openApiTokenSecretEditor` | 保留 tuple/epoch/draft 与 SecretStorage，不让 UI 移组绕开事务 |
| Memory admission | [memory-manager.ts](../../../../src/memory-manager.ts)：`ensureReadyForChat`；[MemoryHost.ts](../../../../src/memory/MemoryHost.ts) | 删除 bypass，不改状态机、VSS 锁或 durable admission |
| Pagelet run lifecycle | [orchestrator.ts](../../../../src/pagelet/orchestrator.ts)：`runAutomaticDeepDiscover/runExplicitDeepDiscover`；Plugin 的 `runPageletDeepDiscover/syncPageletDeepDiscoverControllerIdentity/resetDeepDiscoverController` | 自动偏好与全局生命周期分开；不能 reset 整个 scheduler 来暂停后台 |
| Scheduling | [pagelet-deep-discover-scheduler.ts](../../../../src/pagelet/agent/pagelet-deep-discover-scheduler.ts)、[pagelet-deep-discover-controller.ts](../../../../src/pagelet/agent/pagelet-deep-discover-controller.ts) | 复用 automatic/explicit lane 与已有取消链 |
| Bundled guides | [skill-context-provider.ts](../../../../src/ai-services/skill-context-provider.ts)、[bundled-skill-catalog.ts](../../../../src/ai-services/bundled-skill-catalog.ts)、[pa-agent-runtime.ts](../../../../src/ai-services/pa-agent-runtime.ts)、[pa-agent-host-tools.ts](../../../../src/ai-services/pa-agent-host-tools.ts) | 固定可用 catalog，保留按需加载和名称校验 |
| Local understanding | [extraction-scheduler.ts](../../../../src/ai-services/memory-extraction/extraction-scheduler.ts)、[retrieval-habit-profile.ts](../../../../src/pa/retrieval-habit-profile.ts)、[memory-control-center.ts](../../../../src/pa/memory-control-center.ts) | 两个 opt-in 独立；管理不等于新提取或学习授权 |
| Feature-local controls | [Statistics.tsx](../../../../src/components/Statistics.tsx)：`handleViewChange`；[local-graph.ts](../../../../src/local-graph.ts)：`startup/setColorGroups`；[ai.ts](../../../../src/ai.ts) 与 [service.ts](../../../../src/ai-services/service.ts)：题图生成 | 统计已有现场切换；图谱和题图缺少完整 PA 现场配置，须新增入口后再移除旧行 |
| UI styles/locales | [custom.pcss](../../../../src/custom.pcss)：`.pa-settings-tab/.pa-settings-group-summary/.pa-settings-jump`；`src/locales/plugin/{zh,en}.json`、`src/locales/pagelet/{zh,en}.json` | 保留容器适配、原生控件与 44px 触摸，不注入 runtime style/HTML |

## Settings Disposition

### A. Exact removal set

五个字段是本次运行语义清理的封闭集合；删除旧 true、false、空列表、子集与非法
值的影响，禁止按前缀或所有 `false` 扩大清理。去除类型/默认/merge 输出、UI、
consumer 与保存输出；测试可以保留原始 JSON fixture 验证无效输入。

| Exact path | New behavior | Primary consumers |
| --- | --- | --- |
| `pagelet.preloadEnabled` | 不继承或映射为新后台偏好；旧管线不恢复 | Pagelet merge、旧 admission 适配、smoke runner |
| `pagelet.deepDiscoverEnabled` | 手动发现无该总 gate；自动发现只读新有效偏好 | Plugin、orchestrator、scheduler identity |
| `memoryAutoCheckBeforeChat` | 始终执行正常 readiness 判断；`memoryEnabled=false` 仍 answer-now | MemoryHost、MemoryManager、Plugin migration |
| `skillContextEnabled` | 内置只读指南按任务可用 | runtime registration、Chat/host settings projection |
| `enabledSkillIds` | bundled catalog 全量可用、按需加载，拒绝未知指南 | SkillContextProvider、host tools、Chat catalog |

**Proposed** `pagelet.backgroundDiscoveryEnabled: boolean` 是唯一新增的运行偏好，
默认 `true`。有效 `false` 在后续保存/重载中保留；缺失/非法为 `true`。
不得从任何上述旧字段生成此值，不增加版本号来每次重置新选择。

### B. Retain, relocate or internalize

| Fields / existing section | Target | Persistence / capability rule |
| --- | --- | --- |
| Provider preset、token、Chat model、base URL、policy/embedding model | AI 连接；Custom 自动展开高级连接 | 保留值、服务商兼容限制与事务；高级模型与地址不平铺首屏 |
| `qwenThinkingEnabled/webSearchEnabled` | AI 连接→服务商选项 | 保留有效联网/能力选择；不与后台偏好联动 |
| `memoryEnabled/memoryApprovalPolicy/memoryAutoAcceptPaused` | 笔记与隐私→使用笔记/管理详情 | 保留能力与更新授权；auto policy 只由原 admission 升级，不能因删 bypass 全部改 auto |
| `memoryExtractionEnabled/memoryExtractionConsent/memoryExtractionIncludeVaultInsights` | 独立长期记忆区域，附加笔记库洞察在其详情 | 默认未启用；保留有效启用/暂停，附加来源不得默认为允许 |
| `retrievalHabitProfile` | 独立本地习惯学习区域 | 与长期提取不联动；保留 disabled/clear/retention 和关闭后不再影响排序 |
| `pagelet.enabled/outputLanguage/petVisible/petCorner`、现有提示与静默时段 | 使用偏好 | 角色显示后才显示位置、静默开启后才显示时段；已有提示值保留 |
| `pagelet.temperature/maxInputTokens/maxOutputTokens/foregroundPerHourCap/foregroundPerDayCap` | 移除普通 UI | 本期保留内部/维护字段和既有有效数值；不宣称删除字段，不取消预算 |
| `preloadInterval/preloadPerHourCap/preloadPerDayCap/preloadTokenBudget` | 不提供普通控件 | 仍有旧 coordinator/callback/budget 引用，本次不删除整个子系统；不映射新后台控制 |
| `scopeRecapPreparationEnabled/scopeRecapBackgroundAuthorization/scopeRecapAuthorizationContextId` 与旧尝试数据 | 移除旧准备控件 | 当前 Recap 已走显式 Deep Discover；旧数据不成为新 admission 来源，不恢复 rollback-only 路由 |
| `scopeRecapHighValueHints/proactiveHints/quietRecall.quietRecallMode/operationsProactiveSaveSuggestionsEnabled` 与抑制记录 | 使用偏好→何时提醒 | 包含“建议保存有价值的结论”的独立关闭入口；有效提示偏好互不授权、不因相似命名清空 |
| `pagelet.proactiveHintsCooldown` | 内部提示节流，退出普通 UI | 保留现有数值/校验，不另造用户频率档位；不改变有效提示开关 |
| `quickCapture.enabled/destination/inboxPath/postProcessingEnabled` | 使用偏好→随手记录 | 关闭后隐藏子项；Inbox 才显示路径，后处理仍为独立附加行为 |
| `targetPath/fileFormat/author/noteTemplate/previewLimits`、`pagelet.reviewsFolder/featuredImagePath` | 笔记与隐私→保存与格式 | 按内容类型解释并分别保存；不机械合并目录；预览数量保留详情，不额外造面板 |
| `dataBoundary.*`、Pagelet 局部排除、`vssCacheExcludePath` | 笔记与隐私→笔记范围/局部例外 | 全局规则先行，局部不能扩大全局允许范围，不合并不同语义数组 |
| `operationsAgentEnabled/operationsAuditIncludeContent/operationsAuditRetentionDays` | 笔记与隐私→修改笔记及审计详情 | 保留 opt-in、当前预览确认/Undo 和审计正文权限；不用“启用 Agent”解释权限 |
| 图谱 `localGraph`、`enableGraphColors/colorGroups` | Proposed `GraphOptionsModal`，使用偏好提供同一入口 | 保留全部现有合法选项；新面板/现场入口完成前保留原行 |
| `statisticsType` | 现有 Statistics tabs | 删除 Settings 重复行；现场保存/重开须补交互证据 |
| 统计显示/动画/注释、`statisticsSyncEnabled` | 使用偏好→阅读统计；同步在隐私 | 保留选择；既有未展示的统计字段保持内部，不新增无必要调参 |
| `enableMetadataUpdating/metadatas/metadataExcludePath` | 高级与维护→笔记属性规则 | 保留会改写笔记的能力开关，启用后才显示规则与排除 |
| `featuredImageModel/numFeaturedImages/featuredImagePath` | Proposed `FeaturedImageOptionsModal` | 保留 Qwen/DashScope 边界；模型、数量在生成现场，目录可折叠 |
| `showAdvancedMemoryControls` | 由可直接打开的详情入口替代 UI 开关 | 仅作已有展示偏好处理，不再控制跨组字段可达性；不是运行授权或本次五字段清理对象 |
| Debug、匿名共享、法律/源码入口 | Debug/关于在高级与维护；共享在隐私 | 保留共享选择和全部法律入口，默认不平铺长列表 |

## Design And Data Flow

### Canonical settings and persistence

1. `loadSettings()` 在 merge 前检测 raw 对象是否含精确五旧键；**Proposed**
   `pendingSimpleSettingsCanonicalization` 只表示需要规范化写回，不参与能力判断。
2. `mergeLoadedSettings()` 忽略五旧键；Pagelet normalizer 只从新键和固定默认产生
   新后台偏好。不得清理 provider、有效权限或治理状态。
3. 复用 `migrateSettingsOnce()` 和 `enqueueSettingsWrite()` 写回；成功才清 pending。
   保存失败/冲突走现有重载与重试，不伪报“已清理”，也不恢复旧运行语义。
4. **Proposed** `omitDeprecatedSimpleSettingsFields()` 为纯、幂等、仅处理精确五键
   的浅层/root+pagelet 投影。放入现有 Settings 模块，由 `saveSettingsData()` 所有
   snapshot 保存路径使用；不执行完整 merge、重新授予 consent 或重置其他字段。
5. 保留 `LegacyMemoryCompatibilityBarrier.composeForSave()` 的四片合并与原始
   fingerprint 检查；输出在实际写入前清旧键，成功后依原流程刷新 barrier/fingerprint。
   Provider transaction snapshot/补偿保存同样不能重新写入五键。
6. 纯加载/清理/设置展开不调用 provider、不重建索引。正常启动后的合法后台触发
   按新默认运行并可消耗预算，两种证据单独记录。

### Pagelet automatic versus explicit

保留一个 controller/scheduler。**Proposed** `setAutomaticEnabled(enabled)` 原位
扩展 scheduler；`backgroundDiscoveryEpoch` 仅属于自动请求。

| Event | Automatic lane | Explicit lane |
| --- | --- | --- |
| 新后台偏好关闭 | 清 pending/timer/ready/waiter；取消 active automatic，递增 epoch | active/queued 保持；不销毁 controller |
| 再次开启 | 后续新触发可排队；不补跑取消的旧请求 | 不变 |
| 手动抢占自动 | 原有抢占逻辑保留；只有 still-enabled/current epoch 才能重排自动 | 按原优先级运行 |
| Provider/来源策略失效、Pagelet 总关闭、unload | 原全局 identity/abort/dispose 生效 | 同样遵守有效全局生命周期与权限 |

自动请求在入口、异步 snapshot/scheduler 准备后、`admitRun`、结果 cache commit、
orchestrator delivery 前均验证自动 epoch/偏好；暂停→恢复不能让旧结果 late publish。
已有 AbortSignal 继续贯穿 provider/tool；已发生调用仍记实际费用和 metrics。
普通后台暂停不清旧可用 cache、配额或已打开的显式结果，也不取消暂存的写入动作。

当前 Plugin 有 `force === true || triggerReason === "explicit"` 的显式路由判断。
设计将 trusted `triggerReason` 作为自动/显式来源；`force` 只承担重跑/cache 语义，
不能成为绕过后台暂停的入口。审计全部真实 caller，不增加面向模型的新绕过参数。

`persistPaSettingsSlice()` 当前在 await 保存前就修改 live settings，不能直接用于
此偏好，否则关闭→开启的保存失败期间也可能提前启动后台。**Proposed**
`PluginManager.setBackgroundDiscoveryEnabled(enabled)` 复用 `enqueueSettingsWrite()`：
在轮到该事务时构造仅替换 pagelet 新字段的 snapshot，交 `saveSettingsData(snapshot)`
保存；成功后仅发布这个字段到 live settings，并同步 scheduler/epoch，再通知 UI。
不替换整个 live settings，不修改 shared helper 的其他调用者。等待期间保持旧有效
值、按钮 busy；失败保留旧值并可重试，不能声称已开启/暂停。连续请求按队列提交。
排队和 admission 都读已提交值；成功关闭时立即取消自动 lane。若失败属于
write-after-persist/冲突，沿既有错误/重载路径恢复 durable truth，恢复前不额外
开放自动 admission。后台偏好不得加入全局 controller identity。

### Memory, guides and independent learning

- 删除 `ensureReadyForChat()` 的 bypass 分支；Memory disabled、first-use、
  ready/dirty、missing/stale、cancel 和 durable marker unknown 继续由原状态机处理。
- 内置指南固定采用 `BUNDLED_SKILL_CATALOG`/已知 ID；runtime registration、
  `load_skill`、prompt catalog 与 Chat picker 同步，不扩展到外部 Skill 文件或工具。
- 长期提取与本地学习维持独立控制。保存/renderer 不能把普通首次告知变为启用，
  新 UI 不再把两个不同作用叠成同一“智能功能”总开关。
- `loadSettings()` 当前可在 raw extraction=true、merge 后 false 时补 confirmed。
  T-04 必须覆盖该 caller：只有合法旧版无 consent 的启用迁移或有效 confirmed 能
  保留启用；已有明确 paused/unconfirmed 不得被矛盾 raw true 再次打开。
  不重置现有记录，停用只遵循原暂停/投影语义。
- Memory inspection 继续只读；提取停用不禁止查看、纠正或遗忘已有记录。

## UI Structure And Ownership

### Four groups using existing primitives

保留四个现有 group ID `ai-provider/features/data-privacy/system`，对应
AI 连接/使用偏好/笔记与隐私/高级与维护。继续用 `details`、TOC、移动 select、
ARIA 与 scroll tracking，四组由一个 registry 生成；不换 React/Tab 框架。
各区顶部只显示状态/主要选择，管理记录、专业规则和法律入口置于有语义的详情。

旧 `memory-personalization` 深链按目标路由到 `data-privacy` 的管理详情；
`memory-data-recovery` 到 `system` 的数据恢复详情。旧 `appearance` 路由到
保存与格式。四个保留组的显式折叠 bool 原样沿用；旧 Memory/Appearance 展开偏好
仅映射到对应详情的初始展开态，不能被误当作废弃运行开关的兼容分支。
无偏好时仍只展开 AI；显式 deep link 展开全部祖先并定位，未加载目标保留 pending。

**Proposed** `refreshMemoryControlCenter()` 与 `refreshPageletPreferences()` 是
SettingTab 内局部刷新方法，不新增全局事件总线。Memory 动作成功和 Pagelet
状态变化不再全量 `display()`；保留 generation、pending target、正在编辑的
provider 草稿和确认中的其他控件。目标删除后焦点回到管理入口。

### Provider and save feedback

高级连接只是显示层，不改变 provider tuple/credential 租约。切 Custom 必须携带
未 flush 草稿；预设覆盖走原确认。Passive render/input/Memory inspection 不读
unknown token；显式 token 编辑沿用 PA Modal 及关闭/失败隔离。

普通 `debouncedSave()` 当前失败只 log 并留 pending，不能当作 AC-07 已完成。
为受影响字段使用局部草稿/错误/重试状态，失败保留编辑内容并明确“未保存”；
权限/后台开关则由窄事务控制有效值，失败回退。复用 existing save queue，避免
另建通用表单状态系统。关闭 Settings 后迟到回调不能重建已卸载 DOM。

### Feature-local surfaces (Proposed)

- `GraphOptionsModal` 放在 `src/settings/graph-options-modal.ts`；图谱可见时的
  context command 与使用偏好按钮打开同一面板。沿用现有图谱值和 `LocalGraph`
  的 viewState 路径，不自行操作未核实的 Obsidian 私有控件。新命令 ID
  `pa-graph-options` 为 Proposed，仅当前图谱可用时显示；设置入口在无图谱时仍可
  编辑默认值。编辑只改草稿，取消不保存、不改 leaf；保存失败留草稿和重试。
  保存成功后，深度/显示/折叠/颜色通过窄 apply 方法更新现有 leaf；类型与弹窗
  尺寸沿 `startup()`/`ViewResize.resize()` 在下次打开时生效并明确说明。不得为
  apply 调用 `startup()` 新开图谱或清 `resized` 去调整无关弹窗。无 leaf 时只保存；
  leaf apply 失败与保存失败分开反馈，已保存值不因 apply 失败被谎称丢失。
- `FeaturedImageOptionsModal` 放在 `src/settings/featured-image-options-modal.ts`。
  现有题图命令先显示模型/数量与折叠路径，再按“生成”调用原 helper/service；
  设置入口用同一组件只编辑，取消和单纯打开必须零请求。保留已有合法值与
  Qwen/DashScope 限制，不新建生成管线；新增可见生成确认是现场配置步骤。
- `Statistics.handleViewChange()` 与 tabs 已有现场路径，直接复用并补保存失败/
  重开证据。`previewLimits` 没有现成现场选择，本期保留偏好详情，避免无必要面板。
- 题图当前 `AssistantFeaturedImageHelper.generate()` 不接受参数，service 在
  多次 await 后读取全局 model/count/path/endpoint，不能把这一路径描述为已具有
  完整 snapshot admission。**Proposed** `FeaturedImageRunOptions` 通过
  `generate(options)`→`generateFeaturedImage(editor, view, options)`→
  `generateFeaturedImageUrls(prompt, options)` 传递只读的本次模型、数量、目录、
  provider/endpoint 及 currentness guard；不另建生成管线。
- 面板打开只读取非 secret 配置并显示源笔记；点击生成时校验仍为绑定的 Markdown
  view/文件、重新验证 Qwen/DashScope 与有效连接，并先保存用户本次选择。保存失败
  不生成；保存成功后锁定 run options，随后改默认数量/模型/目录不改变该次任务。
  在 Plugin 内捕获已有 `aiProviderConfigurationRevision`/`aiTokenRevision` 并提供
  本次 `isCurrent()` closure，避免把 secret 或 revision 写入 settings。每次模型/
  生图请求前、取 token 后再次检查连接/currentness；provider/token 变更或现有
  credential gate 拒绝时停止后续请求，不把新 token 与旧 endpoint 混用。
  下载/插入前同样检查仍绑定本次目标，不因当前活动笔记切换写错文件；不改写已有
  下载失败处理和 Markdown 插入算法。已发生调用如实记录，停止不声称撤回既有调用。

### Accessibility and lifecycle

保留 scoped `.pa-settings-*` 与现有 720px/1040px 容器规则、44px 触摸、
sticky 高度测量、safe-area 和 reduced-motion。新 summary/Modal 同样可键盘
操作并有正确 label、busy/error 反馈。所有监听、observer、timer、Modal 与 pending
render 在 `hide/onClose` 清理；需要保留的保存事务按既有 unload/drain 规则完成。

## Validation Tooling Compatibility

以下源码已直接引用废弃字段，必须与 P1 一起调整，不能等 final smoke 失败才处理：

| Existing runner | Required adaptation | Evidence |
| --- | --- | --- |
| `scripts/pagelet-smoke-runner.js` | 移除 preload 字段存在断言，检查新偏好/手动能力和不复活旧值 | 有边界的 runner contract 或 App smoke，不制造宽泛新框架 |
| `scripts/retrieval-optimization-smoke-runner.js` | 执行输入 fingerprint 去除废弃五键，加入新后台键；其他 policy/consent/flags 原样保留 | 现有 `retrieval-smoke-runner.test.ts`，经 tooling 组运行 |
| `scripts/context-continuity-smoke-runner.js` | 当前以 skill=false/empty-list 隔离 synthetic evaluation；采用下述实例级构造接缝，将 runtime 的 `skillContextProvider` 设为 `null` | `context-continuity-smoke-runner-script.test.ts` 验证 catalog/load_skill 不进入模型输入、工具/来源拒绝仍有效；不重跑 LLM 质量矩阵 |

Runtime 已有 `PaAgentRuntimeOptions.skillContextProvider=null`，但当前
`ChatService.streamLLM()` 直接 new runtime，不透传它。**Proposed** 在
`src/ai-services/chat-service.ts` 原位提取私有
`createAgentRuntime(options: PaAgentRuntimeOptions)`，仍以本实例 host/AIUtils
构造 runtime，生产调用参数和默认值不变。Runner 只包装自己创建的隔离 service
方法，对传入 options 覆盖 `skillContextProvider: null`，并保留 vault deny、
skip-memory、联网/写入关闭与异常工具中止。只屏蔽工具执行不足以隔离 catalog
对模型输入的影响；不新增持久化设置、公共开关或通用 runtime factory 框架。

不为通过旧 checker 恢复生产技术开关。Source tests 中旧契约断言改为验证新的
行为/权限；无关算法、安全与输入完整性断言继续保留。

## Compatibility, Migration And Rollback

- exact five-key strip 幂等；新后台 false、有效 opt-in、提示、provider/token、
  数据边界、Memory barrier 四片、quota/notice/cache、retrieval flags/platform mask
  不受迁移重置。未知无关键沿现有兼容规则处理，不扩成全量 schema 重写。
- 升级旧关闭用户恢复默认后台工作是已批准行为；清理动作本身零请求，与后续
  正常后台触发分别验证。更新提示沿现有透明说明，不增加迁移选择弹窗。
- rollback-only Pagelet helpers 仍可保留为内部代码，但不能读已删除的五个字段，
  不能被接回生产路由；需要兼容类型的地方改用内部默认/显式参数，而不是重加
  用户设置。其余 legacy 参数保留不代表新后台行为继承它们。
- 本设计不创建保存旧关闭值的 shadow state。失败采用现有事务回滚；版本级修复
  保持源数据和有效设置。重新引入旧产品选择需另一个显式产品决定。

## Test Matrix

以下都是实施时的证据目标；实际执行结果只记录在 Tracker。最小充分命令、通过
条件与扩张触发由 Tracker 的 Evidence Plan 承担。

| Requirement / AC | Unit / integration | App smoke | Failure / fallback | Evidence target |
| --- | --- | --- | --- | --- |
| B-106/REQ-01 / B-106/AC-01 | `settings.test.ts`、`chat-view.test.ts`：四组、条件子项、provider 配置与手动发现 | 新装 AI 聚焦、正常提问、手动发现 | 未配置/缺 token 不虚报完成 | T-05/T-07/T-08 |
| B-106/REQ-02 / B-106/AC-02 | `memory-manager.test.ts`、`pa-agent-runtime-memory.test.ts`、`skill-context-provider.test.ts`、`pa-agent-host-tools.test.ts`、`pa-agent-runtime-prompt.test.ts` | 必要 Memory 和指南可用 | disabled、marker unknown、costly recovery、未知指南拒绝 | T-03/T-06 |
| B-106/REQ-03 / B-106/AC-03 | `settings.test.ts`、`local-graph.test.ts`、`statistics.test.ts`、`ai-service.test.ts`；新 Modal 用行为型组件测试 | 专业连接、图谱、统计、题图现场路径 | 打开/取消零 AI；保存失败不继续生成 | T-09/T-10/T-11 |
| B-106/REQ-04 / B-106/AC-04 | `settings.test.ts`、`plugin-lifecycle.test.ts`、`memory-extraction.test.ts`、`retrieval-habit-profile.test.ts` | 分别开启/停用、查看/清理、重开状态 | 00/10/01/11、paused+raw true、普通 notice 不授权 | T-04/T-08 |
| B-106/REQ-05 / B-106/AC-05 | `settings.test.ts`、`pagelet-settings.test.ts`、`plugin-lifecycle.test.ts`、Memory migration/compatibility suites | 旧 blob→新设置→保存→重载 | 写失败、陈旧 snapshot、provider save interleaving，保护 sentinel | T-01/T-06 |
| B-106/REQ-06 / B-106/AC-02 / B-106/AC-05 | `pagelet-agent-quality-cache.test.ts`、`pagelet-agent-runtime.test.ts`、`pagelet-orchestrator.test.ts`、`plugin-lifecycle.test.ts` | 自动暂停后手动仍工作 | pending/active/late result、force、关开、显式抢占、provider失效 | T-02/T-06 |
| B-106/REQ-07 / B-106/AC-04 / B-106/AC-05 | `data-boundary.test.ts`、`memory-governance-compatibility.test.ts`、Settings/provider/operations 相关现有 suites | 排除/写权限/联网/共享选择保留 | 缺授权零调用/零写入；治理 barrier 并发不覆盖 | T-01/T-04/T-08 |
| B-106/REQ-08 / B-106/AC-06 | `memory-control-center.test.ts`、`memory-manager.test.ts`、`settings.test.ts` | inspection、精确记忆深链、正确恢复入口 | token unknown 被动读为零；加载失败/目标遗忘/高风险 cancel | T-08/T-12 |
| B-106/AC-07 | Settings、Chat、locales 和新 Modal 交互测试 | Desktop 与 real-iOS 的输入/折叠/深链/重开 | 异步保存失败、关闭后回调、非当前窗口 document、焦点与触控 | T-07/T-12 |

## Open Design Findings

设计风险与处理结果只在 Tracker Findings 记录，避免维护第二份状态表。
任何未处理 P0/P1/P2 设计问题须在实施前解决；当前任务不以自动生成 Approved
状态替代 Owner 对产品偏差的明确选择。

## Approval

- Design authority: DEC-033、Approved Product Spec 与 Owner 2026-09-08 的 SDD 设计任务。
- Approved on: 2026-09-08；Owner 明确要求“按照sdd对应的方案设计与任务规划，帮我完成所有的setting优化”，授权采用此设计实施；设计复核记录见 Tracker。
- Authorized implementation scope: Owner 后续明确要求按此 SDD 和任务规划完成全部
  Settings 优化，已授权范围内的实施、修复与验证；范围或权限的实质偏差仍需另作决定。
