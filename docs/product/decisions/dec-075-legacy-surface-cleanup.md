# DEC-075 — 第一批旧入口与保留代码清理

Decision ID: DEC-075
Status: Accepted
Updated: 2026-10-25
Work item: B-189
Authority: Owner 于 2026-10-25 在只读盘点后明确批准本记录列出的第一批实施，并接受所列旧命令 ID 删除后需重新绑定快捷键。批准不包含其他旧功能退役、历史数据清理、Git 提交、推送或发布。

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
