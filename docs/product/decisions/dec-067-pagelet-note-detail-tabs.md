# DEC-067 — Pagelet 按笔记独立 Detail Tab 与阅读布局

Decision ID: DEC-067
Status: Accepted
Updated: 2026-10-17
Authority: 用户确认按笔记独立 Detail 的交互预览及同范围实现、验证；2026-10-17 进一步授权文档收尾和本地 master 提交，不推送或发布。
Work item: B-177

## Context

本次接续 [DEC-066](./dec-066-pagelet-reading-loop.md) 的短点当前笔记、稳定阅读和完整交接约定。
用户已确认：Pet 始终对应当前笔记；A/B 各用自己的 Detail；A 没有打开 Detail 且用户已离开 A 时，
先保留成果，等返回 A 再提示。用户随后批准预览的“顶部导航 · 推荐”方案，要求保留全部内容视图和 Discovery graph。

源码基线 `4a33eecb`：`plugin.openPageletDetailView` 选择第一个 Detail leaf 并调用 `setPayload`；
`orchestrator` 已按路径保留最近阅读和可用成果，但 Pet 的 `onReadCurrentNote` 仍转 `openPanel`。
因此按笔记独立标签是明确的行为变更，不能只靠局部 CSS 完成。上述为源码事实，不冒充本轮 Obsidian 实测。

## Options Considered

| 选项 | 收益 | 代价 / 判断 |
| --- | --- | --- |
| 保留 Pet → Panel → Detail 为默认阅读路径 | 延续旧入口 | 用户读完整内容多一步，单例 Detail 仍可能覆盖另一笔记；不采用为默认路径 |
| 共用一个 Detail，增加通知来源与目标映射 | 标签较少 | 需要额外跨笔记提示和返回机制；不采用 |
| 每篇笔记独立复用原生 Detail Tab，提示跟随笔记 | 当前笔记入口可预测，A/B 可并行保留 | 多篇笔记可产生多个原生标签，由用户关闭；采用，不自动开后台标签 |

## Decision

1. Pet 短点直接打开或定位当前 Markdown 笔记的 Detail；同一路径已有会话内容或真实空态/运行状态时只激活，
   不因短点刷新正文。重载后仅剩恢复说明的标签，点击 Pet 沿原纯读校验在同一标签重新接入内容或真实空态，
   不新增标签或正文持久化。长按快捷操作和原有显式发现能力保留；Pet 的直接读取链路不主动生成新成果。
2. A/B Detail 各自保留内容、选中成果、滚动、来源展开与图交互现场。原生标签显示真实笔记名称；
   不复制预览里的 A/B 字样或自制 Obsidian 标签栏。
3. A 新成果到达：A Detail 已打开时只在所属标签显示轻提示，阅读中可提供“查看新成果”；
   不抢焦点、不替换正文、不点亮 B 的 Pet。A Detail 未打开且用户离开 A 时静默保留。
   回到 A 仅恢复 A 的提示，不自动开 Detail；现有提示开关、Focus Mode 和来源准入继续有效。
4. 首次打开没有最近阅读的 A 时可直接读当前有效成果；曾读过 A 后重开，恢复保留的阅读，
   用“查看新成果”接纳更新。关闭不删除成果或视为忽略，更新提示与逐份 seen 仍是不同事实。
5. 采用顶部导航阅读稿：正文与标题优先，来源和动作次级；同批成果有明确选中状态，章节定位可用。
   窄容器重排导航和操作，保留完整内容及 Discovery 交互图。全部既有内容分支继续可达。
6. 复用现有缓存、阅读快照、原生 WorkspaceLeaf 和渲染模块，不建立通知中心、跨笔记路由账本、
   永久发现历史、通用会话框架或新设置体系。
7. 2026-10-17 审查跟进时，用户明确“从洞察的能力和 pagelet 的产品目标出发，允许需要的模型调用”。
   进入不同笔记的 Detail 代表阅读该笔记，可沿现有后台发现准入检查/刷新洞察；缓存未命中且原有开关、权限、
   AI 就绪与自动额度等条件满足时允许模型运行。同笔记 Markdown/Detail 转场仍避免伪 leave/open，
   不新增调度策略或独立生成链路，也不将所有阅读切换零调用作为产品目标。

## Consequences And Supersession

本决定仅局部接续 DEC-066 的默认阅读载体及 Panel → Detail 路由：Pet 不再先开 Panel；
仍有明确用途的 Panel、Bubble、非笔记级 Detail、保存、Memory、维护、来源、Agent 交接入口不删除。
这些入口显式打开同笔记新内容时可更新对应 Detail，不能复用另一笔记的 leaf。
无笔记锚点的既有视图沿原入口工作，不虚构当前笔记归属。

DEC-065 的生成、调度准入、质量、检索和费用策略不变；不同笔记 Detail 阅读活动按本决定第 7 项接入原路径。
DEC-066 的来源校验、陈旧阅读、撤权及 Chat 材料边界均不变。
最近阅读和新成果继续采用现有会话边界；不新增跨重载正文保存、跨设备未读同步或标签上限。
标签关闭不取消后台任务，来源失效处理不因保留阅读被绕过。

## Revisit Trigger

只有真实交互出现同笔记重复标签、异步结果写入错误笔记、阅读现场丢失、提示归属错误或窄容器不可操作时，
才针对对应链路修正。新通知中心、历史管理、发现能力或数据边界需另行决定。

## Traceability

- [Product Spec](../specs/pagelet-note-detail-tabs-product-spec.md)
- [历史验证与处置](../../archive/2026/b177-pagelet-note-detail-tabs-validation.md)
- 来源：本对话 2026-10-17 用户批准预览及文档阶段确认。
- 预览身份：`pagelet-detail-preview.html`，revision `2026-10-17-note-tabs`，选择“顶部导航 · 推荐”；
  本机预览位于 `/Users/eddie/.codex/visualizations/2026/10/16/01a144fc-d789-7881-9e6d-bad016493c01/`。
  预览仅为界面提案，其示例数据与模拟行为不构成产品实现。
