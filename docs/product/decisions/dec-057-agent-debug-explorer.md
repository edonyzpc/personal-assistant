# DEC-057 — Agent Debug 完整轨迹与双端查看

Decision ID: DEC-057
Status: Accepted
Updated: 2026-10-09
Authority: Owner 在本次会话确认桌面与移动 HTML 预览符合预期，并明确“接受推荐的组合聚焦展开＋节点定位搜索”，要求编写方案与 SDD 开发测试任务；本次授权到文档，不包含产品代码实施。
Work item: B-167

## Context

Owner 无法在当前 Debug 中方便地看到所有 Turns/stages；节点与详情上下分布、执行方块的表达也不便于理解全过程。希望达到 AgentPrism 示例的浏览体验，但明确不强制复用 LangChain 生态。

源码基线 `1ff0c648` 中，`AgentDebugPanel` 以 200 条事件窗口投影当前树，翻页替换事件；轨迹在详情上方，子节点以网格卡片排列。现有本地历史与观察端口可以复用，但只改 CSS 不能满足完整 Run 浏览。当前实现事实见 [Debug architecture](../../architecture/pa-agent-debug-view.md)，设计依据见 [SDD](../../development/active/agent-debug-explorer/sdd.md)。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 沿用卡片、分页和上下详情，仅调整样式 | 改动少 | 全程结构仍受事件窗口限制，选择节点后反复上下找详情 | 不满足已确认体验 |
| 整个 Run 默认全部展开、全文搜索 | 初看信息多 | 长任务噪声大；全文搜索增加正文读取、索引与内存工作 | 首版不采用默认全展开或全文搜索；保留手动展开全部 |
| 完整大纲、聚焦展开、节点定位搜索，宽屏右侧详情、窄屏详情页 | 全过程可达，当前路径清晰，适合双端 | 需要正确的全 Run 投影及稳定视图状态 | Owner 接受的组合 |

## Decision

1. 完整展示所选 Run 中已记录的轮次、阶段、逻辑模型调用、实际请求尝试和工具执行；所有 Turn 可达，分页只属于内部读取。真实采集缺口须可见；补齐当前 Chat Agent 关键路径的必要观察点，不用“已有数据只能如此”缩窄目标。
2. 宽 Debug 容器采用树形行与统一时间轴，所选节点详情固定在右侧，两个区域独立滚动，分隔可调整；运行历史可收起。并发由真实时间重叠表达。
3. 窄容器/移动端采用完整轨迹页与独立详情页，历史和轮次使用弹层；返回恢复阅读上下文，前后节点使用进入详情时的当前可见序列。适配以实际 leaf 宽度为准。
4. 默认聚焦展开当前执行路径或选中路径；保留全部 Turn 及无 Turn 阶段入口，折叠项仍提示失败、重试与缺口。用户手动调整优先，不随新事件重置；提供展开全部。
5. 首版搜索仅定位当前 Run 的节点名称、阶段、工具名与已记录错误摘要；保留匹配祖先，清空后恢复原展开状态。不搜索完整 Prompt、reasoning、工具正文或跨 Run 内容。
6. 实时跟随可暂停/恢复；用户阅读、搜索、折叠和手动滚动不被新事件抢走位置。查看行为不改变 Agent 执行。
7. 沿用 PA 的 React/ItemView、观察端口与本地存储。AgentPrism 是交互参考，不是强制依赖；不将 LangChain tracing、外部观测平台或框架迁移设为前提。

## Consequences

- Product behavior: 本决定接续 DEC-041 的上下布局、网格执行方块及事件窗口导航目标；具体行为由 [B-167 Product Spec](../specs/pa-agent-debug-explorer-product-spec.md) 持有。
- Architecture / data / safety: 保留 [DEC-055](./dec-055-agent-snapshot-execution-and-debug-history.md) 的完整文本本地历史、实际 provider reasoning、工具 IO、凭据过滤、媒体仅引用，以及既有容量/期限/显式清理规则；不增加请求、重放、上传或同步。
- Compatibility / migration: 旧记录可读，未知时间/类型/未采集内容如实显示；不回填历史，不清空数据库来升级 UI。Agent 结果、采集完整性、内容可用性分开。
- Work created: B-167 的产品规格、SDD 与 Tracker；当前 Architecture 继续描述已实现行为，不以新设计替换事实。无强制第三方组件引入，无产品代码修改授权。

## Revisit Trigger

若实际长任务在既有预算内仍不能流畅定位、必要阶段无法从现有执行边界观察，或需要全文/跨 Run 搜索、独立后台任务、媒体副本、导出/上传，再讨论对应范围；不默认列入本次。

## Traceability

- Product Spec: [Agent Debug Explorer](../specs/pa-agent-debug-explorer-product-spec.md)
- Architecture / SDD: [current architecture](../../architecture/pa-agent-debug-view.md)、[proposed SDD](../../development/active/agent-debug-explorer/sdd.md)
- Execution: [Tracker](../../development/active/agent-debug-explorer/tracker.md)
- Supersedes: [DEC-041](./dec-041-agent-debug-view-and-local-history.md) 的查看布局与导航条款；其余有效约束及 DEC-055 保持。
- Reference: [AgentPrism repository](https://github.com/evilmartians/agent-prism)、[demo](https://agent-prism.evilmartians.io/)；外部示例提供设计输入，不提供 PA 产品或实现授权。
