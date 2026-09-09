# Simple Settings Product Spec

Document status: Approved
Updated: 2026-09-09
Work item: B-106
Decision: [DEC-033 — Simple Settings And Unified Defaults](../decisions/dec-033-simple-settings-and-unified-defaults.md)
Authority: 设置简化的用户行为、功能完整性、默认策略与旧选项失效边界；不表示运行时已经交付。

## Scoped Successor — 2026-09-09

Owner在B-135讨论中将长期提取和本地习惯学习改为分别默认开启，并明确全部新增工作由B-135跟踪。新的当前默认/退出/准入/迁移目标由[DEC-034](../decisions/dec-034-unified-agent-task-execution.md)及[B-135/REQ-17、AC-17](./pa-unified-task-execution-product-spec.md)承接；以下B-106/REQ-04、AC-04中原主动开启规则只描述原交付基线，已被该有日期的选择覆盖。REQ-07/AC-05的有效偏好、权限与治理保护继续适用，不用废弃字段规则强制重开模糊旧false。

本Spec保留B-106原需求/验收身份以解释历史证据，不在旧Tracker新增任务或将新默认标为已验证。新增实现与全部组合回归只见[B-135 Tracker](../../development/active/unified-task-execution/tracker.md)。

## Problem And Product Outcome

- User problem: 普通用户面对大量设置和技术词汇，难以判断完成任务究竟需要开启什么。
- Product outcome: 完成 AI 连接即可使用完整的基础能力；用户只管理有意义的偏好、
  数据范围和权限，无须理解模型调用、检索和内部准备管线。
- North Star fit: 减少管理和预授权摩擦，以可理解、可退出和有来源的行为保持可信。

## Scope

### In Scope

- B-106/REQ-01: 普通设置围绕 AI 连接、使用偏好、笔记与隐私、高级与维护组织。
  显示可理解的状态与主要操作；子选项仅在当前选择确实需要时展示。首次配置延续
  DEC-029 的 AI 聚焦与已有 Chat inline setup，不额外建立 wizard。
- B-106/REQ-02: 完成用户主动请求的必要模型调用、内置只读格式指南、Memory 就绪
  判断等机制由系统提供，不要求用户协调多个技术开关。内部成本和可靠性保护继续
  生效；手动能力不因后台暂停而缺失。
- B-106/REQ-03: 模型温度、Token 预算、内部调用阈值等不进入普通配置。自定义
  服务商/模型保留可达入口；图谱、统计、图片生成等现场选项按对应任务组织。
- B-106/REQ-04: 长期记忆提取与本地习惯学习是两项独立主动开启的能力，新用户
  默认关闭；已有有效启用保留。普通告知、AI 连接、笔记 Memory 或主动回顾启用
  均不得替代这两项选择。保留各自暂停、清除/遗忘和来源解释边界。
- B-106/REQ-05: DEC-033 撤销清单内的旧开关，无论旧值为 true、false、缺失或非法，
  均不影响新行为。设置加载、合并、保存和重载不得复活废弃字段或引入历史用户
  分支；不得把旧关闭值映射成新后台暂停偏好。
- B-106/REQ-06: 新旧用户均采用新定义的有界后台发现默认与独立后台暂停控制；
  原 `preloadEnabled`/`deepDiscoverEnabled` 不再控制功能。已有各类主动提示偏好
  保留原义，后台准备不等于主动提醒；暂停后台不阻止用户显式请求。
- B-106/REQ-07: 内容排除、有效 Memory 选择、长期学习授权、有效提示偏好、
  provider/token、自定义模型、写入权限及内部 rollback/platform 状态不属于无效
  旧值。整理数据范围入口不能混淆全局排除与局部例外，不能扩大来源或写入能力。
- B-106/REQ-08: Memory 管理与设置分层；以真实状态提供更新、修复和清理入口。
  保留管理记录、纠正、暂停和遗忘能力，避免让普通用户选择多个含义相似的内部
  维护动作。DEC-028 的恢复/手动昂贵重建确认与 durable admission 继续有效。

### Non-goals

- NG-01: 不重新设计 AI/provider 架构、检索算法、写入框架或 Memory 存储模型。
- NG-02: 不批量清除有效配置、授权、原始笔记、对话或已保存的记忆记录。
- NG-03: 不把取消成本配置等同于无限调用；不扩大联网、同步、统计或遥测权限。
- NG-04: 不为本次设置工作重开已退役的 Pagelet provider 流程或新增专业调参框架。

## User Flow And States

1. 未连接 AI 时直接看到连接入口；完成配置后开始提问，不另行开启调用机制。
2. 使用设置时先看到状态、保存/显示偏好和权限入口；细节按任务展开，说明使用
   用户语言，技术诊断放在维护详情。
3. 用户暂停后台发现后仍可主动发现；恢复后台由当前有效控制完成。
4. 升级旧设置时按同一新规则运行，不根据废弃开关生成另一个兼容模式或确认流程。
5. 对话长期记忆与习惯学习未开启时不收集相应新信息；开启其中一个不联动另一个。
6. 页面适配桌面与移动窄屏，键盘和触摸均可完成主要设置；保存失败保留真实状态
   与可重试反馈，局部刷新不丢失正在编辑的内容。

## Trust, Data And Authority

- Source evidence: Owner 2026-09-08 的明确选择由 DEC-033 记录；旧兼容建议已被拒绝。
- Data sent / stored: 使用现有 provider、来源边界与存储；升级后默认后台工作可能
  恢复既有预算内的调用。字段清理本身不发起 AI 调用或整库重建。
- User disclosure / confirmation: 保留 provider 透明说明、有效功能退出、长期学习
  的独立主动开启和高后果操作确认；不为废弃选项再增加迁移确认。
- Reversibility / recovery: 有效偏好继续可修改；记录仍可按既有契约检查、纠正、
  暂停和遗忘。新运行时不恢复废弃字段的旧语义。

## Acceptance Criteria

- B-106/AC-01: 普通用户配置 AI 后，无需调整技术开关即可完成提问与手动发现；
  页面包含四类可达入口，父选项关闭时不展示无关必填项。
- B-106/AC-02: 后台暂停时自动发现不运行，显式发现仍正常；必要准备、内部预算、
  取消和失败恢复分别保持有效，不靠用户设置维持正确性。
- B-106/AC-03: 普通页面不出现温度、Token 预算或内部管线开关；自定义连接/模型、
  功能现场选择和维护详情仍可达。
- B-106/AC-04: 未启用、单独启用、已有有效启用、停用与重载分别证明长期提取和
  习惯学习互不授权；普通通知和无关设置保存不启动收集或推断。
- B-106/AC-05: 新安装和各废弃旧值 fixture 在等同有效配置下得到相同新行为；
  load/save/reload 后废弃字段不参与行为且不复活。有效来源排除、权限、token、
  提示偏好和治理状态保持原义。
- B-106/AC-06: Memory 真实状态对应可解释操作；管理、纠正、暂停、遗忘与昂贵
  恢复确认仍可用，字段清理不会自行 reset、调用 provider 或改写源笔记。
- B-106/AC-07: 桌面及移动窄屏主要路径可操作；键盘/触摸、局部重绘、保存失败和
  重开设置不会丢失有效选择或正在编辑的内容。

## Open Decisions

产品选择已明确。字段级映射、界面细节及最小充分验证方案属于后续实施设计，
不需要重复批准 DEC-033 的选择；超出其撤销清单或权限边界的变化须另行说明。

## Delivery Handoff

- Active Package: [B-106 Feature Home](../../development/active/simple-settings/README.md)
  与 [Tracker](../../development/active/simple-settings/tracker.md) 承接字段级设计、
  实现与验证；本规格不记录执行状态或将产品批准描述为已发布。
- Architecture contracts: [Settings status](../../architecture/settings-status.md)、
  [Memory Control Center](./pa-memory-control-center-product-spec.md)、
  [Data Boundary](./pa-data-boundary-product-spec.md)。
- Release / rollout boundary: 本决定不包含 Git commit、push、tag 或发布。
