# DEC-070 — Chat 渲染复用与生命周期性能优化

Decision ID: DEC-070
Status: Accepted
Updated: 2026-10-18
Authority: Owner 在 B-179 后续讨论中确认四项 PA 侧问题需要优化，暂不展开表格流式更新；随后授权按修订后的 B-180 完成开发测试及真实 P2 定向修复，避免过度设计/测试。2026-10-18 明确要求收尾 B-180 并提交本地 master；本记录持有稳定决定，验证结果见历史证据，发布另行授权。
Work item: B-180

## Context

B-179 已处理 Markdown 表格的显示兼容。后续真实 test vault 定向测量确认：删除一轮
历史会重建其余未变化消息；恢复历史会连续发起多次原生渲染。PA 还在状态栏观察中处理
无关正文变更，并为 Mermaid 持续执行布局稳定循环。前两项有明确工作量证据；状态栏
回调在基线样本中成本很小；后续 Mermaid 对照证实主动滚动调用减少，未换算为 CPU 收益。
基线、结果及测量限制见[最终验证](../../archive/2026/b180-chat-rendering-performance-validation.md)。

这些问题可以在保留 Obsidian 原生渲染能力、完整消息、原文与现有权限的前提下处理。
单次原生全文构建仍有不可拆分的同步成本，DOM 改动后的浏览器布局也不会因此全部消失。

## Options Considered

| Option | Benefits | Costs / risks | Conclusion |
| --- | --- | --- | --- |
| PA 复用未变整轮视图，分批恢复，收窄无关观察与稳定轮询 | 直接减少已证实的重复工作，复用既有原生能力 | 必须明确 owner、异步失效、附属卡片及滚动生命周期 | 采用；依次落地与验证四项优化 |
| 替换 renderer、自建 Markdown DOM 或调用 Obsidian 私有增量接口 | 可能改变单次构建方式 | 扩大内容、后处理和版本兼容责任；当前没有必须替换的证据 | 不采用；继续既有原生入口 |
| 表格流式子树复用、尾部解析或通用 DOM diff | 可能减少单条大消息的重复构建或发布成本 | 与本轮历史复用不同，仍需独立证明结构、依赖及 owner 安全 | 留在 B-179 后续候选边界，本轮不实施 |
| 虚拟列表、隐藏旧消息或限制内容 | 可以减少同时存在的节点 | 改变完整阅读、查找、交互与内容能力 | 不纳入本轮 |

## Decision

1. 删除一轮历史时，只移除该轮视图与资源，保留其他轮的原生 DOM 和 owner；按现有
   业务语义更新上下文、持久历史、Operations 及图片/Writing/Ghost 附属状态。
2. 恢复会话时先完整恢复数据，再按有界批次发布历史视图；批次之间让出主线程，
   保持完整内容、消息顺序及继续发送能力。不会以显示进度裁剪 Agent 上下文。
3. 状态栏观察只增加针对 PA 自有正文变更的快速排除，保留真实状态栏迟到挂载、替换、
   移除和尺寸变化处理。当前证据不支持为它引入通用观察框架。
4. Mermaid 布局稳定后停止主动逐帧尝试；在原有有界窗口内保留尺寸变化响应和必要
   fallback，继续尊重用户暂停自动滚动及视图销毁。
5. 保留原生 `MarkdownRenderer`、显示兼容入口、原文、媒体和后处理能力；保持现有
   流式最新内容合并与 32ms 冷却。无新 provider 请求、持久缓存、设置、权限或迁移。
6. 批次时间预算与稳定检测参数属于实施校准。先以实际响应机会和正确性验收，不承诺
   单次调用变快、固定帧率、固定提速比例或总恢复时间一定缩短。

## Consequences

- Product behavior: 阅读和操作能力保持；历史显示允许逐批就绪，输入与新回复可继续使用。
- Architecture / data / safety: 复用以现有轮对象和 view 生命周期为界，不建立跨会话 DOM
  缓存；显示取消不能替代领域业务取消，原文继续是存储与上下文事实。
- Compatibility / migration: 无持久格式变更；桌面和官方 mobile 模拟共用路径，保留
  全量重建用于真正的会话重置，以及原生失败回退和无 ResizeObserver 时的有界 fallback。
- Work created: B-180 独立承接四项优化；B-179 的已交付兼容范围与历史验收不变。
  已完成范围由 Product Spec 和回归测试持有；独有性能及最终验收证据紧凑保留，过程包
  吸收后删除，不以历史记录替代当前实现契约。

## Revisit Trigger

保留原生能力无法满足正确性、需要改变内容/媒体/权限/持久化边界，或完成本轮后实际
仍由单条原生构建与发布主导卡顿时，再讨论对应方案。常规预算调参不要求新的产品决策；
不得以性能目标为由静默减少内容、禁止发送或取消仍有效的后台任务。

## Traceability

- [Product Spec](../specs/pa-chat-rendering-performance-product-spec.md)
- [当前实现与生命周期约束](../specs/pa-chat-rendering-performance-product-spec.md#implementation-and-lifecycle-contract)
- [B-180 验证与性能边界](../../archive/2026/b180-chat-rendering-performance-validation.md)
- Related: [DEC-069](./dec-069-chat-markdown-table-display-compatibility.md)；本决定不替代其显示兼容契约，也不批准表格流式增量方案。
