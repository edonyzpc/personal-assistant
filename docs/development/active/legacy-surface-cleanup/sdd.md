# Legacy Surface Cleanup Software Design Document

Document status: Approved
Updated: 2026-10-25
Work item: B-189
Authority: GPT 在 Owner 已批准的 DEC-075 范围内负责的 source-verified 清理设计；Owner 的批准针对产品范围，不表示逐项审核本文实现方法。
Product spec: [Bounded Cleanup Product Spec](../../../product/specs/pa-bounded-code-cleanup-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Current Source Baseline

只读基线 `058dd3dd`，下列为实施前事实；修改后结果由 Tracker 记录。

- `src/settings/pagelet/index.ts` 定义并读取 `scopeRecapHighValueHints`、`quietRecallMode`，
  同时呈现两个旧控制；删除呈现，不删除兼容读取。
- `src/pagelet/commands.ts` 注册七个待退役 ID；`src/pagelet/orchestrator.ts` 接入其回调。
  发现别名仍可触发 Deep Discover；`open-panel` 走已有阅读打开路径。
- `src/pagelet/tab/sections/MaintenanceReviewSection.ts` 显示 `weeklyDisabled` 跳转。
  历史 `weeklyReview`、`weeklyScanEnabled` 与评估工具不是该按钮的同义依赖。
- `src/settings.ts`、`src/plugin/settings-persistence.ts`、`src/ai-services/AiServiceHost.ts`、
  `src/chat/ChatHost.ts` 保留旧 `operationsAgentEnabled` 设置链；live Operations
  controller、policy/permission 与 proactive save suggestion 是独立职责。
- `src/pagelet/orchestrator.ts` 的 `pageletAgent.directAction` 消费分支与
  `src/pagelet/plugin-operations-integration.ts` 负责专用 link staging/确认/取消/撤销及会话。
  当前自主发现无该 directAction 生产生成方；Chat 共享 Operations 仍有生产调用。

## Design And Ownership

遵守 [Command Architecture Contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)。
不创建替代 pipeline、通用兼容路由或新的设置迁移。

| Decision / transition | Owner and factual basis | Required effect |
| --- | --- | --- |
| 退役七个已注册入口 | Command registration；DEC-075 的显式兼容选择 | 删除注册及专用回调；不替用户修改 Obsidian 快捷键 |
| 保留主动发现 | 既有 Deep Discover controller 与来源/模型准入 | `discover-connections` 仍按活动笔记启动；自动发现设置与预算不变 |
| 仅打开已有阅读 | 既有 Pagelet 阅读 owner | `open-panel` 不启动 provider；阅读、来源与继续讨论保持 |
| 删除无效设置 UI | Settings renderer / Maintenance section | 只撤控件与无其他消费者的文案，旧值及手动维护能力保留 |
| 退役旧 Operations 设置 | Settings type/default/normalization/persistence host 链 | 去除旧门控字段；真实 live capability 和独立写权限仍决定可用性 |
| 退役 Pagelet 专用关联 | Pagelet action/UI/session owner；无生产生成方 | 移除仅服务该链的状态、生命周期和插件接线，保留共享 Chat 执行与恢复 |

## Lifecycle, Data And Compatibility

- 两个回顾字段保留读取与归一化；不能由“UI 已删”推导持久化值可删。
- 不清理 Weekly Review、维护 action log、历史 Operations 或笔记 `pa-related`。
  shared/评估消费者独立核对，保留不再生成但仍有效的历史 reader。
- 删除 `operationsAgentEnabled` 设置链不等于删除 `isOperationsAgentEnabled()` 等
  live availability 方法，也不改变 `operationsProactiveSaveSuggestionsEnabled`。
- 历史配置读取时若由 deprecated projection 剔除旧 Operations key，现有规范化持久化
  可以单独触发一次保存；必须保留其他已知/兼容数据，不能整批重置或清理历史。
- 只有确认专用于关联的 listener、timer、session、回调、CSS、locale 可随链移除；
  React owner、正常保存、discuss handoff、来源复核和 Chat Undo 保留。handoff 共用的
  action token / AbortController 是保留链的有效性与取消机制，不能随关联清理删除。
- 桌面和移动边界一致；reload 不重置其他值或启动 provider 工作。回滚只恢复代码、
  注册与 UI，不重写用户数据或快捷键。不声明体积或性能收益，除非另有测量。

## Requirement And Evidence Mapping

| Requirement / AC | Deterministic / integration evidence | App interaction / boundary |
| --- | --- | --- |
| B-189/REQ-01 / B-189/AC-01 | 设置 UI 无两个控制，旧值归一化与读取保留 | 桌面实际设置检查；本轮无移动特有改动，不要求重复双端证明 |
| B-189/REQ-02 / B-189/AC-02 | 七 ID 不注册；保留发现路由与 open-panel 零 provider | 命令面板检查并实际打开面板；不为删除别名新发 provider 请求 |
| B-189/REQ-03 / B-189/AC-03 | Maintenance 无假设置跳转；手动 scan、旧数据/工具消费者保留 | 手动维护可进入，界面不承诺每周配置 |
| B-189/REQ-04 / B-189/AC-04 | 旧字段链退出；规范化仅剔除该字段且保留其他数据；live 可用/不可用、写权限、proactive save 仍独立 | 复用有效 Chat Operations 证据；实际变化有交互未知时补验 |
| B-189/REQ-05 / B-189/AC-05 | 专用 directAction/link 链退出；保留共享 token/AbortController；focused 覆盖 handoff 取消、重复点击和失效 | 必要时用已有阅读继续讨论但不发送；保存链未变，不要求再写笔记 |
| B-189/REQ-06 / B-189/AC-06 | 定向调用/依赖检索、文档与必需仓库检查 | 不将 harness、模型、桌面、模拟器与真机证据互相替代 |

继承规范的旧 ID 全量映射如下，避免把本批变更当作重做整个 B-136：

| Requirement / AC | Inherited scope |
| --- | --- |
| B-136/REQ-01 / B-136/AC-01 | 仅已证实专用链与已批准入口退役，不按 unused 数量扩大 |
| B-136/REQ-02 / B-136/AC-02 | 旧范围 UI 继续退役，不恢复手选范围 |
| B-136/REQ-03 / B-136/AC-03 | 命令兼容仅按 B-189/REQ-02 接续；anchor/source/provider 边界保持 |
| B-136/REQ-04 / B-136/AC-04 | 外围管理、Statistics、Share Card、Records 保留，不要求无变化重复验收 |
| B-136/REQ-05 / B-136/AC-05 | 保留共享来源、写权限、正常保存/恢复和历史读取；专用关联另按 B-189/REQ-05 |
| B-136/REQ-06 / B-136/AC-06 | 清理配套资源，不改变共享复制/隐私语义或引入框架 |

验证的精确范围、执行者、源输入与结果由 Tracker 收口，实施前不虚记通过。
移动、真实 provider 生成或实际保存只有出现对应新变化/失败时再增加，不由本次删入口推导。

## Open Design Findings And Approval

- 当前限定范围无未决产品选择。新发现有效消费者则保留并反馈，不擅自删除或扩大范围。
- Product authority: Owner 2026-10-25 的第一批实施批准，见 DEC-075。
- Design responsibility: GPT 对批准边界内的具体接线与验证设计负责；本文不把实现方法记为 Owner 的逐项批准。
- Design adopted on: 2026-10-25。
- Authorized scope: 本 SDD 列出的有界实施和相应验证；不包含 Git、发布或 closeout。
