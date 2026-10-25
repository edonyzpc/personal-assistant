# PA Bounded Code Cleanup Product Spec

Document status: Current
Updated: 2026-10-25
Work item: B-189
Decision: [DEC-075](../decisions/dec-075-legacy-surface-cleanup.md); predecessor [DEC-035](../decisions/dec-035-bounded-cleanup-and-pagelet-scope-retirement.md)
Authority: 有界清理的当前产品边界与行为验收；B-189 三批范围由 Owner 于 2026-10-25 逐项批准，实施证据由 Tracker 记录。B-136 的未接续边界与历史证据保留。

## B-189 第三批接续范围 — 2026-10-25

| Requirement / Criterion | 行为与验收边界 |
| --- | --- |
| B-189/REQ-15 / B-189/AC-15 | 后台审阅准备状态命令及专用接线退出；设置页用量、真实预算、当前发现保持 |
| B-189/REQ-16 / B-189/AC-16 | metadata 自动更新命令/实现/专用设置退出；既有属性、Capture 模板、Agent 属性操作及共享状态栏保持 |
| B-189/REQ-17 / B-189/AC-17 | DEC-075 列明的旧 Pagelet 设置与兼容恢复退出；历史结果、suppression/attempt/diagnostics/acceptedCount、savedInsights 及当前设置保持 |
| B-189/REQ-18 / B-189/AC-18 | 旧 coalescer/短期内存缓存、导出及专用测试退出；现行 scheduler/cache/取消/预算保持 |
| B-189/REQ-19 / B-189/AC-19 | 旧追加预览及 framework content-hash 分支退出；创建文件预览与确认后目标复核、来源身份、Agent 追加/Undo、Capture 共享检查保持 |
| B-189/REQ-20 / B-189/AC-20 | 主动提示旧 pending/接口退出；实际展示才开始冷却、安静时段、当前队列和显示保持 |
| B-189/REQ-21 / B-189/AC-21 | 三个已确认无消费者辅助入口退出；全文读取/范围限制/调试日志/当前设置/有效测试保持 |

AI 摘要、局部图谱、Callout 插入、Records Preview、模拟权益及全部当前 Agent/Pagelet 能力
明确保留。只删除专用测试，混合测试转到当前入口；不改写历史数据，不改动已有笔记。
回滚恢复代码即可，不依赖数据重置。第三批不包含提交、推送、发布或 closeout。

## B-189 第二批接续范围 — 2026-10-25

下列条目按 DEC-075 第二批决定接续下文第一批及 B-136 的对应保留约定；历史验收
不是本批实现后证据。范围之外的能力、配置和数据继续保留。

| Requirement / Criterion | 行为与验收边界 |
| --- | --- |
| B-189/REQ-07 / B-189/AC-07 | 旧 Quiet Recall/Scope Recap 生成及专用查看、保存、手动关联退出；当前阅读、正常保存、共享成果库/来源权限/provider身份保持；不删除历史结果或笔记 |
| B-189/REQ-08 / B-189/AC-08 | 双 Ctrl 入口退出；发现命令和 Pet 可用，正常打开已有阅读不新增 provider 请求 |
| B-189/REQ-09 / B-189/AC-09 | 匿名能力使用开关及其专用事件记录退出；其他调试、运行记录与统计同步保持 |
| B-189/REQ-10 / B-189/AC-10 | 旧录记、插件/主题更新、单个/批量插件启停及右键管理退出；Quick Capture、Records Preview、共用设置和已有插件/主题状态保持 |
| B-189/REQ-11 / B-189/AC-11 | 三个无效 weekly 开关退出；维护 action log、手动维护、已有笔记与回顾内容保持，不新增自动扫描或数据清理 |
| B-189/REQ-12 / B-189/AC-12 | 旧 append-action 退出；现行 Agent/Chat 追加、Undo、Quick Capture、共享保存和路径检查保持 |
| B-189/REQ-13 / B-189/AC-13 | 旧 StatsStore 类退出；当前统计采集/存储/界面/同步/历史导入与共享 helpers 保持，统计数据不删除 |
| B-189/REQ-14 / B-189/AC-14 | 旧气泡/preload预算/无消费者导出和专用测试退出；当前 Pet、发现气泡、状态提示、布局/动画/移动交互、实际预算和阅读保存保持；混合测试保留现行断言 |

保留 Records Preview 和 free/paid mock tier。代码回滚不依赖数据重置；旧命令不再
提供兼容别名，已删除开关的值不保证降级恢复。现行 Agent 的能力注册、写权限、
来源身份、结果/撤销事实不因专用旧实现退役而改变。

本轮授权实施与必要验证，不包含新的提交、推送、发布或 closeout。

## B-189 第一批范围（接续基线）— 2026-10-25

第一批仅执行以下范围；不是整批清退旧功能。命令 ID 曾被明确保留，按 DEC-075
局部接续。Owner 已接受所列旧快捷键需重绑，不实现兼容转发或修改热键文件。

| Requirement | 行为边界 |
| --- | --- |
| B-189/REQ-01 | 删除 Pagelet “高价值回顾提示”和“相关回顾”设置 UI；保留 `scopeRecapHighValueHints`、`quietRecallMode` 旧值读取、归一化及兼容，不改变当前自动发现开关 |
| B-189/REQ-02 | 删除 `pa-pagelet:open-prepared-review`、`pa-pagelet:review-current`、`pa-pagelet:quick-review`、`pa-pagelet:quiet-recall`、`pa-pagelet:scope-recap`、`pa-pagelet:preload-status`、`pa-pagelet:clear-scope-recap-cache`；保留 `pa-pagelet:discover-connections` 及 provider-free 的 `pa-pagelet:open-panel`，其他当前命令保持 |
| B-189/REQ-03 | 移除 Maintenance Review 的 `weeklyDisabled` 设置跳转；保留手动维护、历史 `weeklyReview` / `weeklyScanEnabled`、action log 与评估工具消费者，不新增每周自动扫描 |
| B-189/REQ-04 | 清理 `operationsAgentEnabled` 设置声明/默认/归一化/传递链；保留 live availability、独立写权限/来源、`operationsProactiveSaveSuggestionsEnabled` 及历史；规范化保存仅剔除退役字段，不丢其他设置或历史数据 |
| B-189/REQ-05 | 移除无生产 `directAction` 生成方的 Pagelet 专用自动关联 UI、stage/confirm/cancel/undo 与专用会话接线；保留共享 Chat Operations、完整成果 discuss handoff 及共用有效性/取消检查、阅读/保存和已有 `pa-related` 元数据 |
| B-189/REQ-06 | 仅删除上述链的专用类型/文案/样式/测试契约；有其他生产、历史或工具消费者时保留。不扩大其他旧功能清理，不删除用户笔记、会话、每周数据或测试 vault 内容 |

### B-189 Acceptance Criteria

| Criterion | 可观察结果 |
| --- | --- |
| B-189/AC-01 | 桌面/移动设置不再显示两个旧控制；旧配置输入仍按原兼容规则可读，当前自动发现及提示设置没有被一并移除 |
| B-189/AC-02 | 七个 ID 不再注册；保留的发现命令继续按活动笔记和现有来源/模型准入运行，`open-panel` 只打开已有阅读且零 provider 调用；文档说明旧热键重绑 |
| B-189/AC-03 | 维护界面不再显示每周扫描设置跳转，手动扫描仍可用；历史每周数据、action log 与评估读取未删除或改写 |
| B-189/AC-04 | 无生产代码继续依赖旧设置字段；live controller 可用/不可用、写权限与 proactive save 仍按各自事实工作；旧配置规范化最多清退该旧字段，不重置其他设置、不清理历史 |
| B-189/AC-05 | Pagelet 专用关联链和独立接线无残留；既有发现可阅读、保存并完整交给 Chat，取消/失效检查不被连带删除；Chat Operations 与旧 `pa-related` 笔记保持有效 |
| B-189/AC-06 | 删除范围能追溯到批准条目与实际消费者，紧密相关文档和历史局部接续一致；受影响检查和部署后界面交互有独立记录，不以旧验收代替新结果 |

### B-189 Delivery Boundary

当前批准不包含提交、推送、发布或 closeout。具体实施与验证状态见
[B-189 Tracker](../../development/active/legacy-surface-cleanup/tracker.md)。
下面保留 B-136 的原规范及历史验收：其 REQ-03/AC-03 的旧命令保留仅按 B-189/REQ-02
接续，正常保存/恢复等共享边界不随 Pagelet 专用关联退役改变；其余边界继续适用。

## Problem And Product Outcome

删除没有生产作用的代码及专用资源，减少重复维护；移除 Pagelet 中未影响实际分析的
旧范围控制。符合“安静且可信”：交互表达与实际行为一致，保留用户仍在使用的能力。

## B-136 Inherited Scope

| Requirement | 行为边界 |
| --- | --- |
| B-136/REQ-01 | 普通清理保持有效行为；只删除有完整证据的不可达实现及专用依赖，不以行数或体积为完成目标 |
| B-136/REQ-02 | 撤除旧 Panel 时间范围、逐笔记选择、Review selected 语义与专属状态，桌面/移动及相关文案同步，不提供新的范围选择器 |
| B-136/REQ-03 | 保留当前 Deep Discover 的活动笔记 anchor、合规跨笔记探索和旧命令 ID/名称/现有路由；打开面板本身不新增 provider 调用 |
| B-136/REQ-04 | 保留管理类外围功能、Statistics 展示、Share Card 导出和字体、Records Preview 与旧录记入口；不修改其产品范围或采集/保存策略 |
| B-136/REQ-05 | 保留 Data Boundary、来源查看、ContextPager、Memory、Review Queue、Maintenance、合法保存/确认/Undo，以及仍有效的历史读取、迁移和恢复 |
| B-136/REQ-06 | 复用只合并已经相同的语义；删除应覆盖专用接线、样式、文案和过时契约，不残留空壳，也不为复用新增通用框架 |

### Non-goals

- 不拆分 plugin/settings/chat/VSS 大类，不重做检索、模型、队列、存储、权限或生命周期。
- 不统一 Records 入口，不恢复多范围 Review，不整批清退 Quiet Recall/Scope Recap。
- 不清理 `test/` vault 内容，不批量重写历史设置、会话、笔记或用户数据。
- 不替换核心依赖，不升级版本，不借清理扩大产品能力或处理所有 unused 诊断。

## User Flow And States

打开旧 Panel 命令仍展示面板和现有可用内容，不显示无效范围选择，不自动开始分析。
用户显式启动 Deep Discover 时沿用当前入口，以当时的活动 Markdown 为 anchor；
允许来源内的跨笔记证据仍可返回、查看和展开。无活动笔记、来源被排除、provider
未配置、运行中、失败、取消及结果过期均沿用当前反馈与准入，不新增 fallback。

全局来源排除不是本次退役的 include/exclude 控件。来源说明、Review Queue 路径及
上下文元数据也不能仅因含 scope 命名而删除。桌面和移动的功能边界相同。

## Trust, Data And Authority

provider 及其实际发送前的来源校验、成本预算、首次通知保持原契约。
既有写入确认、来源失效检查、Undo 和历史兼容继续生效。
源笔记是事实源，不通过清理变更用户数据；回滚恢复本次代码/资源变更即可，
不以数据库清空或设置重置作为恢复方法。

## B-136 Acceptance Criteria

| Criterion | 可观察结果 |
| --- | --- |
| B-136/AC-01 | 普通死代码删除能追溯到无生产入口且无保留契约的证据；旧范围控件则按 DEC-035 退役，其下游仅删除没有其他保留消费者的专用依赖；source/Worker/build 入口分别检查，相关行为测试与构建通过 |
| B-136/AC-02 | 旧面板命令可真实打开；桌面和移动不再出现时间预设、勾选或 Review selected，相关专用状态与文案无残留 |
| B-136/AC-03 | 旧命令注册和路由保持；打开面板零新增 provider 调用；从 A 启动仍以 A 为 anchor，允许的 B 可作为证据，无效 anchor/被排除的 B 不进入不允许的发送路径 |
| B-136/AC-04 | 保留功能的入口与依赖链未被删；Statistics 与 Share Card 字体/导出契约仍通过相关既有验证，Records 与管理功能没有被合并或移除 |
| B-136/AC-05 | 当前来源、上下文、正常保存和恢复消费者仍可用；历史 reader、权限、确认、Undo 不被绕过；失败不复活退役 provider 管线 |
| B-136/AC-06 | 合并 helper 保持调用方原有复制/隐私语义；删专用 CSS 不影响当前 Pet/Bubble 的 reduced-motion；文档不再声称旧 Panel 能手选运行范围 |

## Open Decisions

无待定的本次产品选择。技术候选不满足证据门时保留，并记录有效消费者与兼容理由；
若必须改变产品、数据或兼容边界，作为新取舍单独提出，不能将技术推测记为批准。

## Retained Technical Boundaries

- `deviceMemoryReviewQueueRepository` 有安全 smoke 脚本消费者，不能仅凭 `src` 只写不读删除。
- SourceRecord 只复用完全相同的浅拷贝；context/history 的隐私裁剪差异仍须保留。
- Type C 的内存分析/viewer、Type A/proposal、weekly 持久化兼容保留；不恢复无生产入口的 Type C 文件写入或旧 generic preload producer。
- ScopeResolver、来源准入、当前调用预算及正常 findings 保存保留。B-136 当时保留的
  PreloadBudget 和旧 Quiet Recall/Scope Recap 链已由 B-189 第二批显式接续退役。
- 大类拆分、Statistics 历史整理、Weekly Review 兼容与未来 preload adapter 分别遵循 [Backlog](../../backlog.md) 的 B-105/B-110/B-116/B-122；Records 统一仍需独立产品决定。

## Implementation And Evidence

- Historical validation: [B-136 验证记录](../../archive/2026/b136-bounded-cleanup-validation.md)
- Current implementation: [B-189 Feature Home](../../development/active/legacy-surface-cleanup/README.md) / [Tracker](../../development/active/legacy-surface-cleanup/tracker.md)
- Current Pagelet contract: [Pagelet Product Design](../pagelet-product-design.md#foreground-scope)
- Release / rollout boundary: 本规范不授予新的实现、Git 或发布权限；完成清理不等于已发布新版本。
