# Pagelet 按笔记独立 Detail Tab Product Spec

Document status: Current
Updated: 2026-10-17
Work item: B-177
Decision: [DEC-067](../decisions/dec-067-pagelet-note-detail-tabs.md)
Authority: 用户批准并已验收的 Detail UI/UX、按笔记入口与提示归属契约；历史验证见本文末尾。

## Problem And Product Outcome

用户点击当前笔记的 Pet 后，应直接读到该笔记的成果，并能在 A/B 之间切换而不丢失阅读现场。
新成果安静地留在所属笔记；正文、来源和章节位置清楚，窄分屏仍可读可操作。
本次只改善已批准的入口、阅读层级、导航、布局和提示，符合“安静且可信”。

## Scope

### In Scope

- B-177/REQ-01：Pet 打开或定位当前笔记唯一的默认 Detail。不同笔记使用不同原生标签；
  反复点击、快速连续点击不产生重复默认标签，不覆盖其他笔记；已有会话内容保持现场，恢复占位在原标签纯读取回。
- B-177/REQ-02：A/B 的内容、选中成果、阅读位置、来源展开与 Discovery 图状态独立。
  来源导航、关闭重开和异步完成遵循原阅读归属；用户关闭后不被结果重新打开。
- B-177/REQ-03：新发现只提示所属笔记。已打开 Detail 在对应标签提示；未打开且离开该笔记时静默保留；
  回到笔记才出现该笔记的 Pet 提示，不自动打开 Detail，不替换正在阅读的旧成果。
- B-177/REQ-04：按顶部导航稿改善正文层级、有限行宽、选中状态、同批成果计数、章节定位和来源消歧。
  来源、元信息与操作不压过正文；全文仍完整可读，不改生成文本、顺序或内容分类。
- B-177/REQ-05：按 Detail 容器宽度适配宽屏和窄分屏。窄屏导航采用紧凑选择器，操作换行、复杂布局单列化，
  不靠缩小正文或隐藏必要能力腾空间；键盘、焦点、主题与触控保持可用。
- B-177/REQ-06：保留下文内容覆盖表中的全部 14 类内容及既有状态；Discovery 交互图继续提供节点打开、拖动、
  键盘访问、关系强弱、来源消歧、折叠与关系列表，不以纯列表替代图。
- B-177/REQ-07：复用现有来源/权限、seen、缓存、运行、Chat 交接和副作用边界。
  Pet 的直接读取链路不主动生成；不同笔记 Detail 阅读可沿原有后台准入检查/刷新洞察，允许必要模型调用。
  同笔记转场避免伪 leave/open，长按快捷操作保留；原有 Panel 和其他 Detail 入口保持可达。

### Non-goals

- 改动 Agent 提示词、发现质量、检索/调度算法、provider、费用策略、来源准入或写入权限。
- 重做 Bubble、Pet 造型/手势、所有 Panel，删除维护/Memory/保存/Chat 能力，恢复已退役功能。
- 新增通知中心、跨笔记任务路由、永久成果历史、跨设备未读同步、新设置或 UI 框架。
- 把预览的 14 项选择器、六情境、模拟按钮、固定 A/B、假数据、宽窄镜像壳或备选侧边导航搬入产品。
- 其他模块清理、代码重构、性能项目或对旧 Backlog 的整体修复。

## User Flow And States

默认路径：当前 Markdown 笔记 → Pet → 该笔记 Detail → 阅读 / 来源 / 原有后续操作。
原生笔记标签和 Detail 标签可并存；用实际笔记名识别归属，同名时提供必要目录信息。

| 触发 / 现场 | 用户看到的结果 |
| --- | --- |
| A 尚无 Detail，点击 A Pet | 打开 A Detail；有最近阅读则恢复，否则纯读取回当前成果或真实空态 |
| A Detail 已有会话内容或真实空态/运行状态，再点击 A Pet | 定位现有 A，保留正文、选择、位置与展开 |
| 重载后 A Detail 仅剩恢复说明，再点击 A Pet | 在同一个 A 标签沿原纯读校验接入当前内容或真实空态；不新增标签、不自动分析 |
| 切到 B 笔记并点 Pet | 打开/定位 B；A 保留，A/B 互不替换 |
| 正在 B，A 新成果到达，A Detail 已开 | 仅 A 标签出现“新”提示；B 不跳转，B Pet 不承载 A 的提示 |
| 正在 A Detail 阅读时收到 A 新成果 | 正文不变，提示可选“查看新成果”；用户选择才换内容 |
| 正在 B，A 新成果到达，A Detail 未开 | 安静保留成果；不弹提示、不点亮 B Pet、不创建 A 标签 |
| 返回 A，A Detail 仍未开 | A Pet 按既有提示准入呈现新发现；返回本身不打开 Detail、不标已看 |
| 返回 A 时 A Detail 已开 | 更新仍由 A 标签承载，A Pet 不重复提示 |
| 在 A 点 Pet，过去尚未读过 A | 直接打开当前有效成果；若无有效内容，显示真实空态/运行状态 |
| 在 A 点 Pet，过去读过 A 后关闭 | 恢复仍保留的阅读；有更新时提供“查看新成果”，不自动换掉旧阅读 |
| 点击“查看新成果” | 进入已校验的新集合，解除本次更新提示；仅实际打开的成员标 seen，不批量标已读 |
| 同一成员身份与 preparedAt 的集合重复命中缓存 | 不新标“新”，也不清除仍待查看的真实更新 |
| 空 Detail 等待请求完成 | 仅同笔记、同一等待请求且该 Detail 尚存时允许填入；不能覆盖已有正文 |
| 关闭 / 插件重载 | 关闭保留会话内最近阅读，不取消独立任务；重载沿现有恢复说明，不承诺正文永久保存 |
| 来源变化、过期或撤权 | 沿 DEC-066：陈旧阅读说明原因并禁交接；撤权阻止读取，不借旧标签绕过 |

提示归属规则仅约束本轮按笔记发现，不改变其他类型提示的既有准入。
后台接纳成果不自动标 seen；激活标签但仍读旧内容也不消费未打开的新成果。

## Trust, Data And Authority

必要洞察调用沿现有缓存、调度及权限/额度准入，不新增独立生成、存储目录、网络或日志采集链路。
会话内最近阅读、有效成果、设备本地 seen 和 Chat 材料
继续由已有 owner 管理。真实笔记身份使用现有路径与来源事实，不从标题、模型文本或当前焦点推断成果归属。
保存、维护、Memory 操作与 Agent 交接保持原行为和权限。已接纳 Chat 材料的保存不扩展成 Pagelet 永久历史。

## Implementation And Lifecycle

- 笔记身份使用 vault-relative path，优先 `reading.anchorPath`，其次为明确的 `sourcePath`；
  无锚点的维护、Memory 或聚合视图继续使用相容的无锚点标签，不绑定当时活动笔记，也不按标题匹配。
  Pet 点击时冻结当前 Markdown 路径；原生标签用实际笔记名并按需补目录，不自建标签栏。
- `plugin` / `PageletDetailView` 负责原生 leaf 匹配、创建和激活；用户打开或定位在 reveal 后同步原生活动 leaf。
  仅恢复占位从同类型保存状态读取锚点并在原 leaf 接入；不加载无关后台标签、不刷新正常会话空态。
  同路径在途打开合并，结束即释放；后台到达只标记所属标签，不激活、重开已关闭标签或覆盖另一笔记。
- `orchestrator` 复用 `recentReadings` / `availableAgentInsights`；每个 TabView 自管正文、选择、位置、来源展开和图实例。
  新结果仅更新提示/必要导航，已有正文只在用户选择或同请求空等待接纳时替换。
  被新接纳集合取代的旧读取返回独立的结束结果，Panel/Detail 调用者均停止写回，不把它当作空集合。
  已有新成果时优先显示更新提示，实际运行/终态反馈保留。
- 集合更新按有序 `id/preparedAt` 比较；同集合不重复标新，也不清除仍待查看的更新。
  用户接纳完整新集合解除提示，逐份 seen 仍只记录实际展示的成员；关闭标签不等于忽略成果。
- 正文约 17px / 1.8、最大阅读行宽约 720px，沿 Obsidian 字体与主题变量适配用户缩放。
  同批成果保留顺序、完整标题、计数和明确选中状态；章节来自实际渲染 DOM，点击与当前项共用目标解析。
  正文清空或撤权时同步清空并隐藏章节按钮和窄屏选择器，折叠区域先展开再定位。
- 布局由 Detail 容器宽度驱动，约 560px 以下采用紧凑选择器、操作换行及复杂内容单列化；
  保留焦点、键盘、约 44px 触控目标和长路径换行，表格/代码可局部滚动。CSS 限定本插件 Detail，Panel 默认呈现不变。
- Discovery 沿用现有 graph 数据和事件，保留原笔记突出、目录消歧、关系强弱、节点打开/键盘、拖动后不误打开、
  图折叠与全部关系列表；不以 Graph Discovery 条目替代交互图。已开 leaf 复访不重建图，关闭后不承诺图位置持久化。
- 关闭时释放自身 renderer、订阅、计时器和观察器，不取消其他 leaf 或独立任务。
  Workspace state 仅保留原轻量恢复信息，不保存正文、回调或通知历史；改名、删除、过期和撤权沿既有来源失效路径。
  回退仅恢复相应 UI/导航或 Pet/leaf 路由，不迁移或清空缓存、seen、Chat 数据，不增长期双模式设置。

内容生成与终态归 Agent 及现有 scheduler/controller；来源与 Chat 准入沿 B-176；保存、Memory、维护及 Chat 效果
继续由既有 domain owner 执行。UI 只投影上述事实，不新增生成、权限、通知或持久化系统。

## Content Coverage

下表的 14 类为保留清单，不代表新增 14 个顶层 tab，也不为缺失数据制造入口。

| 内容 | 保留能力 / 现有落点 |
| --- | --- |
| 完整成果 reading | `TabView.renderReading/renderSelectedReading`；全文、多成果、状态、来源和 Agent 交接 |
| Summary | `renderSummaryContent/renderSummaryActions`；正文、保存、附属理解/Memory 与原空态 |
| Discover | `renderDiscoveryLayout`；交互图、联系、依据和来源 |
| Review / 默认综合 | `renderContent` slots / `renderFromFindings`；概览及既有 section 顺序 |
| Current note | `layoutType: current`；既有内容与来源归属 |
| Maintenance | `MaintenanceReviewSection`；建议、预览/执行/Undo 权限不变 |
| Contextual Memory | `MemoryGovernanceSection` 与 Detail exact claim 恢复；仅真实使用范围 |
| Quiet Recall | `QuietRecallSection`；候选、来源、保存/关联动作 |
| Graph Discovery | `renderGraphDiscoveryContent`；条目与关系状态，区别于 Discover 交互图 |
| Patterns | `renderPatternDetectionContent`；模式说明、证据和状态 |
| Saved insights | `renderSavedInsightContent`；已保存理解与来源 |
| ContextPager | `renderContextPagerContent/renderContextPagerAsDetails`；使用/跳过来源与折叠行为 |
| Legacy Memory | `MemoryGovernanceSection` 兼容输入；不恢复已退役产品 |
| Structured sections | `renderTabSections/renderStyledCard`；default、insight、comparison、action、quote、source-list |

## Acceptance Criteria

- B-177/AC-01：首次 / 重复 / 连续点击 A Pet 均定位 A 默认 Detail，B Pet 得到 B；
  不出现 A 覆盖 B、同笔记重复默认标签或直接读取强制生成，长按快捷操作仍可用。
  若 A 标签仅为恢复占位，点击 Pet 应在该标签纯读取回当前内容或真实空态，不能一直停在恢复说明。
- B-177/AC-02：A→B→A 可恢复各自成果、滚动、来源展开和图现场；打开来源后能回原 Detail。
  关闭再打开遵循最近阅读；晚到或等待中的 A 结果不能覆盖 B、重开已关闭 A 或夺取焦点。
- B-177/AC-03：覆盖“已开 A / 未开 A / 返回 A / 正读 A”四种到达情境；提示、点击目标、实际内容归属一致。
  旧正文不跳动；接纳新集合解除更新提示，seen 仅落实际打开成员；现有提示禁用边界仍有效。
- B-177/AC-04：全文、标题层级、成果选中与计数、章节当前位置、来源目录及原有操作可辨识；
  切换成果可恢复其阅读位置，定位不被固定导航遮挡，代码块、表格、长标题/路径不挤出布局。
- B-177/AC-05：960 / 560 / 400 / 320px 容器覆盖宽窄布局；无页面级横向溢出、重叠或不可达操作，
  原生表格/代码内容必要时局部滚动；键盘焦点、浅深主题和窄屏触控可用。
- B-177/AC-06：14 类内容分支及原有空态、失败/取消、部分成果、来源状态仍可达；
  Discovery 图与 Graph Discovery 条目保持区别，节点点击/键盘、拖动不误打开、折叠、关系列表和返回可用。
- B-177/AC-07：显式发现、保存、维护、Memory、Chat 交接沿原链路；内容归属不因活动笔记改变。
  Workspace 重载不新增正文持久化，撤权和陈旧阅读不退化；只修改本次明确的 UI/UX 接线及相关验证。

## Open Decisions

无未决产品选择或本范围未完成项。用户于 2026-10-17 明确授权文档收尾和本地 master 提交；推送与发布未授权。

## Traceability And Historical Validation

- [B-177 历史验证与处置](../../archive/2026/b177-pagelet-note-detail-tabs-validation.md)：最终证据、复审结论及验证限制；不作为当前实现权威。
- [B-176 当前契约](./pagelet-reading-loop-product-spec.md) 与 [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract) 继续约束来源、交接和效果。
