# DEC-076 — Settings 按任务分层与图谱初始尺寸自适应

Decision ID: DEC-076
Status: Accepted
Updated: 2026-10-29
Authority: Owner 明确保留 Policy model、接受图谱初始尺寸自适应，并于 2026-10-28 确认交互预览及授权开发测试；2026-10-29 另行授权收尾、提交 master 和推送远程。版本发布仍需独立授权。
Work item: B-191

## Context

用户反馈 Settings 配置太多，难以判断哪些必须配置、哪些决定实际使用行为。
当前四组结构已由 DEC-033 确立；问题主要在内容归属、条件展示、偏好与运行状态混淆、
管理动作挤占普通设置，以及少数可以由产品承担的参数。

本轮检查了 Settings、Pagelet、Memory、Graph、图片和 Ghost 的实际入口及保存路径，
并完成独立交互预览。预览是设计证据，不是已部署 PA 的运行验证。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 只增加折叠或简单／专家模式 | 表面改动少 | 仍要求用户理解内部机制，增加模式状态 | 不采用 |
| 一次取消全部低频开关 | 设置数量明显减少 | 会丢失有效退出、来源边界和存储偏好 | 不采用 |
| 沿用四组，任务归位、准确摘要、条件展示及设置内详情 | 保留能力与控制，降低首次配置和日常查找成本 | 需要保护草稿、精确跳转和共享编辑器生命周期 | Owner 确认预览，采用 |

## Decision

1. 沿用 AI 连接、使用偏好、笔记与隐私、高级与维护。首次聚焦与折叠偏好沿用
   [DEC-029](./dec-029-inline-ai-setup-and-settings-focus.md)，不新增首次向导或自动连接探测。
2. 采用已确认预览的原生行式层级、区域摘要、条件展示和 Settings 内部详情／返回。
   Obsidian 自己的侧栏、窗口及主题由宿主管理；预览的模拟外壳和示例数据不进入产品。
3. Policy model 保留在高级连接。图片生成连接归 AI 连接；聊天图片管理归笔记与隐私；
   Ghost 保持桌面端按需配置。各功能详情保留既有有效选项及实际管理／恢复动作。
4. 只取消 `localGraph.resizeStyle` 对应的手动宽度、高度。桌面悬浮本地图谱保留，
   初始尺寸按所属窗口可用空间适配；旧尺寸不再决定行为，不新增自动开关、持续尺寸跟随
   或拖拽尺寸记忆。普通标签页继续由 Obsidian 布局负责，Hover Editor 依赖不变。
5. 快速捕获总开关、统计动画、图谱选项折叠、默认生图数量、两个图谱配色控制均保留。
   它们曾是讨论候选，已确认预览仍保留，不能据“简化”批量删除。快速捕获继续支持
   记录笔记、收件箱、当前文件；图片默认偏好与单次生成参数保持不同职责。
6. Memory 主开关、对话学习、本地学习、后台更新、拾页后台发现／角色／主动提示、
   联网及同步各自的有效控制保持。准确显示已保存偏好与当前暂停原因，不能隐式扩大
   权限或改写默认。全局排除与各功能额外排除只集中呈现，不合并其生效范围。
7. 中文与英文使用同一信息架构和交互。桌面与移动端共享内容；窄屏重排控件，不以缩小
   字体或截断关键名称代替适配。完整 Memory 管理仍归 Settings，不新增常驻 Memory Tab。

## Consequences

- Product behavior: 首屏解释当前配置与主要入口；只展开当前任务需要的细节，移除无操作的未来清理占位说明。
- Architecture / data / safety: 保留 `SettingTab`、现有保存事务和领域 owner；只抽取实际重复的编辑内容，不构建通用设置框架。
- Compatibility / migration: 新旧用户都采用图谱初始自适应；只精确清理旧尺寸字段，其他偏好、记录、凭据和来源规则保持原义。
- Work created or removed: 新建 B-191 设计与计划；既有 B-106/DEC-033 的其余契约继续适用，不重开历史交付，也不恢复 DEC-075 已退役入口。

## Revisit Trigger

实际使用出现无法找到有效设置、返回丢失草稿／焦点、来源或权限范围漂移、窄屏操作
不可达，或悬浮图谱超出窗口时，修正对应切片。取消其他有效控制须有新的明确产品选择。

## Traceability

- User source: 本轮“policy model 先保留”“接受自适应尺寸设置”及“预览符合预期，完成方案设计和 SDD 开发测试计划”三项直接确认。
- Product Spec: [Settings UX](../specs/pa-settings-ux-product-spec.md)。
- Design baseline: [已确认交互预览](../../archive/2026/b191-settings-ux-preview.html)。
- Historical validation: [B-191 最终验证](../../archive/2026/b191-settings-ux-validation.md)。
- Baselines: [DEC-033](./dec-033-simple-settings-and-unified-defaults.md)、[Settings Current Status](../../architecture/settings-status.md)、[Memory Control Center](../specs/pa-memory-control-center-product-spec.md)。
- Scoped supersession: 仅接续 Settings 的呈现／导航设计及固定图谱尺寸行为；不改变既有学习默认、准入、来源及恢复确认契约。
