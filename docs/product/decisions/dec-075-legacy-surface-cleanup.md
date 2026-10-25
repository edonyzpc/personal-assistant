# DEC-075 — 旧入口与保留代码分批清理

Decision ID: DEC-075
Status: Accepted
Updated: 2026-10-25
Work item: B-189
Authority: Owner 于 2026-10-25 在只读盘点和逐项讨论后，分别明确批准本记录的三批实施，并接受所列旧命令退役。第三批不包含范围外功能退役、历史数据清理或新的 Git 提交、推送、发布授权。

## 第三批决定 — 2026-10-25

Owner 逐项确认以下范围后，明确要求实施并完成必要验证；实施开始后又明确允许恢复
GPT + GLM 工作流，GPT 负责设计与独立验收，GLM 接续开发和测试。

1. 删除“拾页：显示后台审阅准备状态”命令及专用接线，保留设置页用量和真实调用预算。
2. 删除“一键更新 metadata”命令、自动更新器及专用设置；保留已有属性、Quick Capture
   模板、Agent 属性操作和共用状态栏。
3. 删除无效旧 Pagelet 设置及兼容恢复：ribbonPosition、四个 preload 调优字段、四个
   scopeRecap 准备/授权/提示字段、quietRecall 配置及其旧 mode 迁移、quietRecallExplained、
   quietAcknowledged。Owner 明确放弃这些旧设置值的兼容恢复；历史 suppression、attempt、
   diagnostics、acceptedCount、savedInsights 和已有结果保留。
4. 删除无生产消费者的旧请求合并/短期缓存模块、导出及专用测试；现行调度、缓存、取消和预算保留。
5. 删除旧追加专用预览、样式、类型和 content-hash 复核分支；保留当前创建文件预览、确认/取消、
   目标/路径/来源复核、Chat/Agent 追加和 Undo、Quick Capture 共享路径检查。
6. 删除主动提示旧 pending 标记、三个旧接口及专用断言；保留当前提示准入、实际展示计时、
   冷却、安静时段、当前提示队列及显示效果。
7. 删除 shouldUseFullCurrentNoteContext、combineDebugObservers、旧合并 renderPageletSection
   辅助入口及专用残留；当前全文读取、范围约束、日志、分开的设置入口及有效测试保留。

明确保留 AI 摘要、局部图谱增强、Callout 快捷插入、Records Preview、模拟权益、当前 Pagelet
和 PA Agent 全部能力。旧 provider/凭据迁移、统计导入等有效历史兼容不属于本批。
上述决定局部接续前两批对已退役设置与实现的保留约定；不重写历史事实，也不授权清理用户数据。

## Context

当前自主发现已统一到显式 Deep Discover；若干旧命令仍是真实注册的重复入口，
不能称作从未生效的死代码。DEC-035、DEC-052、DEC-065、DEC-066 曾明确保留这些
兼容入口，本次以新的用户决定局部接续，原批准与历史验收保留。

两个旧回顾设置已不控制当前发现路由；Maintenance Review 的每周扫描按钮指向
不存在的设置入口。`operationsAgentEnabled` 旧设置不再承担 live capability 或
权限准入。Pagelet 的 `directAction` 已无生产生成方，仍有专用关联 UI 与
Operations 会话接线。删除这些残留不授权缩减共享 Chat Operations 或历史读取。

## Options Considered

| Option | Benefits | Costs / risks | Decision |
| --- | --- | --- | --- |
| 保留全部旧入口与设置 | 维持全部快捷键与界面外观 | 继续表达无效设置，保留重复入口及专用维护负担 | 不采用 |
| 明确退役所列入口与专用接线，保留数据和共享能力 | 缩小当前界面与维护范围，边界可核验 | 删除的命令 ID 需用户重绑快捷键 | Owner 已选择 |
| 整体删除 Quiet Recall、Scope Recap、Weekly Review 或 Operations | 可进一步缩减代码 | 会涉及历史数据、评估工具和当前能力；不在本次批准内 | 不采用 |

## Decision

1. 移除 Pagelet 设置中的“高价值回顾提示”和“相关回顾”两个控制；保留
   `scopeRecapHighValueHints`、`quietRecallMode` 的旧值读取、归一化及兼容，不批量改写。
2. 删除 `pa-pagelet:open-prepared-review`、`pa-pagelet:review-current`、
   `pa-pagelet:quick-review`、`pa-pagelet:quiet-recall`、`pa-pagelet:scope-recap`、
   `pa-pagelet:preload-status`、`pa-pagelet:clear-scope-recap-cache` 的注册及无其他消费者的
   专用回调、文案、测试契约。保留 `pa-pagelet:discover-connections` 和
   `pa-pagelet:open-panel`；后者打开已有内容，不发起 provider 调用。其他当前命令保留。
3. 撤掉 Maintenance Review 的 `weeklyDisabled` 设置跳转按钮。手动维护扫描、
   `weeklyReview` / `weeklyScanEnabled` 历史值、action log 与评估工具消费者保留；
   不建立每周自动扫描，不做 Weekly Review 数据迁移。
4. 清理 `operationsAgentEnabled` 的设置声明、默认值、归一化和传递链。保留真实
   Operations 可用性判断、写权限与来源检查、`operationsProactiveSaveSuggestionsEnabled`
   以及历史读取；同名 live 方法不能因为旧设置退役而一并删除。
5. 移除无生产 `directAction` 生成方的 Pagelet 专用自动关联链：专用呈现、
   stage/confirm/cancel/undo、独立 Operations 会话和仅为此存在的接线。共享 Chat
   Operations、完整成果继续讨论、阅读与保存、既有笔记的 `pa-related` 元数据保留。
6. 专用资源随对应链一起清理；有其他当前调用、历史读取或工具消费者时保留。
   不重做 provider、Memory、权限、存储或其他旧功能。

## Consequences

### 第二批接续决定 — 2026-10-25

Owner 逐项确认后明确授权实施以下第二批；本节接续第一批与 DEC-035 中对应的保留
约定，不将旧决定改写成当时已经批准。设计、开发与验证全部由 GPT 完成。

- 删除旧 Quiet Recall / Scope Recap 生成链及其专用查看、保存、手动关联；保留当前
  Deep Discover、阅读与保存、成果交接、共享 SavedInsightStore 和已有笔记/结果数据。
- 取消双击 Ctrl 发现入口，保留发现命令和 Pet 入口。
- 删除匿名能力使用情况开关及专用事件记录链；保留调试日志、运行记录和统计同步。
- 删除 startup-recording、update-plugins、update-themes、单个/批量插件启停命令及
  PA 图标右键插件管理入口和专用实现；保留 Quick Capture、Records Preview、共用
  设置、已安装插件/主题及当前启用状态，不改 Obsidian 的插件状态或快捷键文件。
- 删除 weeklyReview.enabled、weeklyReview.preparedReviewEnabled 和
  maintenanceReview.weeklyScanEnabled 三个无效设置；保留手动维护、action log、
  已有笔记和回顾内容。被清退的开关值不保证降级恢复。
- 删除旧 append-action 实现及专用测试；保留 Agent/Chat 的 vault_append、撤销、
  Quick Capture、当前保存执行器和共享路径检查。
- 删除旧 StatsStore 类及专用测试；保留同文件共享工具、当前统计采集/存储/界面、
  同步、历史导入，不删除任何统计数据。
- 删除旧 Pagelet 气泡、预加载预算残留、无消费者导出及专用测试；保留当前
  Pet/AgentInsight/Pattern/Onboarding、共用渲染与样式、有效调用预算、阅读/保存及
  PA Agent 能力。混合测试只移除旧用例，不整套删除。
- Records Preview 与 free/paid mock tier 本轮明确保留。不增加新机制、数据清理或
  兼容转发；提交、推送、发布和 closeout 仍须另行授权。

源码已核实旧链与现行显示入口分离，但 provider 身份、共享保存、气泡呈现与类型
仍有当前消费者，实施须保留或原语义提取。实际验证结论只由 Tracker 记录。

### 第一批影响（历史边界）

- 删除的命令不会自动重定向；已有快捷键需在 Obsidian 中绑定到保留命令。
  这项兼容变化已获批准，不再以旧 ID 保留条款阻挡实施。
- Pagelet 继续生成和阅读发现、保存成果、向 Chat 交接完整上下文；需要关联或其他
  笔记修改时沿既有 Chat 能力处理，交接本身不自动发送或授予写权限。
- 不删除笔记、历史记录、旧每周回顾数据或 `pa-related`，也不清空设置。旧的两个
  回顾设置仍可读取；退役 Operations 设置不再是产品开关或许可依据。
- 回滚恢复本次代码、注册及界面即可，不依赖数据重置；不会替用户改写快捷键文件。
- 本记录是已批准目标；实际实现、检查及 app 证据仅由
  [B-189 Tracker](../../development/active/legacy-surface-cleanup/tracker.md) 记录，不在此宣称完成。

## Revisit Trigger

发现所列专用链存在尚未识别的生产调用或有效数据消费者，或用户需要恢复某个具体
旧入口时重新评估；不借新发现扩大本批清理或静默改变历史数据兼容。

## Traceability

- [Bounded Cleanup Product Spec](../specs/pa-bounded-code-cleanup-product-spec.md)
- [Feature Home](../../development/active/legacy-surface-cleanup/README.md)
- [SDD](../../development/active/legacy-surface-cleanup/sdd.md)
- 局部接续 [DEC-035](./dec-035-bounded-cleanup-and-pagelet-scope-retirement.md)、
  [DEC-052](./dec-052-prepared-review-deep-discover-route.md)、
  [DEC-065](./dec-065-pagelet-autonomous-discovery.md)、
  [DEC-066](./dec-066-pagelet-reading-loop.md) 的所列旧命令保留约定，
  [DEC-018](./dec-018-quality-gated-scope-recap-hints.md)、
  [DEC-021](./dec-021-evidence-led-pagelet-ui-ux-hardening.md) 的两个旧设置呈现，
  及 [DEC-014](./dec-014-defer-operations-agent.md) 的退役设置和 Pagelet 专用关联接线；
  其余产品、来源、权限与历史证据边界保持。
