# PA Bounded Code Cleanup Product Spec

Document status: Approved
Updated: 2026-09-13
Work item: B-136
Decision: [DEC-035](../decisions/dec-035-bounded-cleanup-and-pagelet-scope-retirement.md)
Authority: 此次清理的产品边界与行为验收；批准依据为 Owner 已确认的取舍，不代表工程交付完成。

## Problem And Product Outcome

删除没有生产作用的代码及专用资源，减少重复维护；移除 Pagelet 中未影响实际分析的
旧范围控制。符合“安静且可信”：交互表达与实际行为一致，保留用户仍在使用的能力。

## Scope

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

## Acceptance Criteria

| Criterion | 可观察结果 |
| --- | --- |
| B-136/AC-01 | 普通死代码删除能追溯到无生产入口且无保留契约的证据；旧范围控件则按 DEC-035 退役，其下游仅删除没有其他保留消费者的专用依赖；source/Worker/build 入口分别检查，相关行为测试与构建通过 |
| B-136/AC-02 | 旧面板命令可真实打开；桌面和移动不再出现时间预设、勾选或 Review selected，相关专用状态与文案无残留 |
| B-136/AC-03 | 旧命令注册和路由保持；打开面板零新增 provider 调用；从 A 启动仍以 A 为 anchor，允许的 B 可作为证据，无效 anchor/被排除的 B 不进入不允许的发送路径 |
| B-136/AC-04 | 保留功能的入口与依赖链未被删；Statistics 与 Share Card 字体/导出契约仍通过相关既有验证，Records 与管理功能没有被合并或移除 |
| B-136/AC-05 | 当前来源、上下文、正常保存和恢复消费者仍可用；历史 reader、权限、确认、Undo 不被绕过；失败不复活退役 provider 管线 |
| B-136/AC-06 | 合并 helper 保持调用方原有复制/隐私语义；删专用 CSS 不影响当前 Pet/Bubble 的 reduced-motion；文档不再声称旧 Panel 能手选运行范围 |

## Open Decisions

无待定的本次产品选择。技术候选不满足证据门时保留，并在 Tracker 记录原因；
若必须改变产品、数据或兼容边界，作为新取舍单独提出，不能将技术推测记为批准。

## Delivery Handoff

- Active Package: [Bounded Cleanup](../../development/active/bounded-code-cleanup/README.md)
- Current Pagelet contract: [Pagelet Product Design](../pagelet-product-design.md#foreground-scope)
- Release / rollout boundary: 本规范不授予实现、提交、推送或发布权限；执行状态只见 Tracker。
