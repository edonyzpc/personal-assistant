# DEC-071 — PA UI 状态、局部刷新与宿主生命周期

Decision ID: DEC-071
Status: Accepted
Updated: 2026-10-20
Authority: Owner 确认共享 UI 架构、宿主生命周期、设备本地恢复及正文交互优先策略，随后授权 S1/S2/S3 开发测试；2026-10-20 审查后暂缓两项恢复策略，并授权收尾和提交至远程 master。Accepted 记录产品选择，实际交付及设备证据有明确边界。
Work item: B-181

## Context

图片任务的 Details 自动收起只是一个实例：`renderImageTaskCard` 保留外层 card，却在每次任务刷新时执行清理和 `card.empty()`，内部节点与用户状态随之消失。问题在于领域数据刷新与界面生命周期混在一起；换框架本身不会自动修复错误的 key、状态归属或原生子树替换。

目标是符合 PA「安静且可信」的界面、流畅且克制的宿主资源使用，以及桌面和移动共用组件与行为。既有 [DEC-070](./dec-070-chat-rendering-lifecycle-performance.md) 的原生 Markdown、完整内容、历史复用和流式调度继续有效。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 各处继续手动保存/恢复 DOM 状态 | 单点改动小 | 随控件增加重复维护，难统一异步、隐藏和关闭边界 | 仅可作为窄修复，不能承担整体架构 |
| React 稳定组件 + Zustand 视图状态 + 原生 Markdown bridge；Pagelet 列表按需用 TanStack Virtual | 复用项目 React，明确状态/子树所有权；同一双端实现 | 需要逐面迁移和原生生命周期适配，虚拟行仍需实际测量 | 采用；依赖按切片引入 |
| 全面替换原生 Markdown、通用 DOM diff 或重写整套 UI | 可统一渲染内部结构 | 扩大插件兼容、Markdown、媒体及后处理责任；迁移面大 | 不采用，已有证据不足以支持此成本 |
| Chat 历史虚拟化、内容截断或大型 UI 套件 | 可能减少节点或组件开发量 | 改变完整阅读与宿主适配范围，不能直接解决状态归属 | 不纳入 |

## Decision

1. 领域事实继续由现有服务管理；UI 按稳定实体身份局部更新。React 管 PA 自有交互壳，Zustand store 随视图实例创建；原生 renderer 独占 Markdown host 内部。共享能力从实际切片抽取，不建第二个任务 runtime。
2. 短暂切到其他笔记时关闭临时菜单，保留草稿、展开项、选中项和阅读现场，返回不抢焦点。真正关闭/重开以及重启后恢复未发送草稿和阅读位置，不恢复菜单、焦点、文字选区或全部展开项；阅读目标所需的最小上下文随位置保存。
3. 恢复数据仅设备本地保存，各设备独立；不新增跨设备同步。持久内容采用白名单，来源与附件重新核验，不把运行期授权序列化。
4. 用户在变化中的正文内选字、展开说明或操作控件后，暂缓替换该正文，保留当前交互；任务进度继续更新，只保留最新待显示内容。用户点「查看最新」后恢复更新，任务完成不强制解除暂停。此策略已实施并完成对应回归与实际交互验证。
5. 保留原生 Markdown 能力和 B-180 调度；同文不重建、无关更新不触发正文渲染，隐藏暂停显示工作，关闭释放资源。Pagelet 列表使用稳定 ID 和单一高度测量责任人；Chat 不虚拟化、不裁剪内容。
6. 双端共享逻辑/组件/主题语义，布局按实际容器宽度适配。保留 PA 现有视觉语言，以清晰层级、克制状态提示、触摸和键盘可用性为标准，不做同时覆盖全部页面的视觉重做。
7. 停止继续完善原型。已有算法、测试和证据直接作为迁移输入；iPhone 验证后置，iPad 未验证。正式接线后只验证变化边界和项目规定的阶段门槛。

## Consequences

- Product behavior: 刷新不再默认重置用户操作；正文可能暂时落后于任务进度，界面提供明确的「查看最新」。
- Architecture / data / safety: 原生子树拥有独立 owner；显示暂停不取消任务，不改变发送、取消、Undo、来源或权限事实。新增设备本地草稿/阅读记录。
- Compatibility / migration: 先 Chat 任务卡片与 bridge，再草稿/阅读恢复，最后 Pagelet 列表/详情；每个完整 surface 保留可回滚边界。React 已存在，新增库按使用切片引入。
- Delivery boundary: B-181 已按2026-10-20 Owner授权范围收尾，稳定实现由当前架构/Spec持有；两项恢复策略及物理设备证据后置，见下列边界。原型已吸收后移除，不作为生产入口。单次原生大段构建成本仍在，不承诺固定帧率或绝对不卡顿；发布另行授权。

## Deferred Scope

Owner 于2026-10-20明确暂缓 Pagelet 跨关闭/重启的阅读持久恢复，以及 Chat 附件/父版本异步核验期间新滚动的优先策略，分别转入 [B-182/B-183](../../backlog.md#已延期的产品与工程工作)。原恢复目标保留，不把暂缓写成已实现或永久取消。iPhone验证后置、iPad未验证，设备补验按 [T-012](../../backlog.md#触发型评估)启动。

## Revisit Trigger

实际使用中，明确暂停仍不能保护某种必要交互，或原生单次构建在减少重复工作后仍主导卡顿，再针对该场景评估稳定内容块/替代 renderer。出现真实跨设备续写需求时再讨论同步，不预建同步或通用持久状态框架。

## Traceability

- [Product Spec](../specs/pa-ui-state-rendering-product-spec.md)
- [当前实现契约](../../architecture/pa-ui-state-rendering.md)
- [最终验证与边界](../../archive/2026/b181-ui-state-rendering-validation.md)
- Related: [DEC-070](./dec-070-chat-rendering-lifecycle-performance.md)、[DEC-066](./dec-066-pagelet-reading-loop.md)、[DEC-067](./dec-067-pagelet-note-detail-tabs.md)；兼容扩展，不替代既有完成记录。
