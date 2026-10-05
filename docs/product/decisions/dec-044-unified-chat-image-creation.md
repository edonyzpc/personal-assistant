# DEC-044 — 统一 Chat 生图入口与内容配图

Decision ID: DEC-044
Status: Accepted
Updated: 2026-10-05
Authority: Owner 确认单一 @CreateImage、明确来源、统一提交顺序，要求保留 Featured 专用提示词能力，并同意原 command 改为 Chat 快捷入口；随后授权落地设计文档。
Work item: B-152

## 2026-10-05 Scoped Successor

[DEC-051](./dec-051-proportionate-confirmation-and-contract-alignment.md) 允许Agent依据明确
自然语言笔记指代查找并绑定真实来源，不再强制先点全文/选区控件。来源身份、专用提炼、
实际提交及回执边界保持；代码对齐和验收见 [B-161 Tracker](../../development/active/contract-alignment/tracker.md)。

## Context

显式 CreateImage 单目标路径在主 Agent 启动前以原问题创建图片任务。同 operationId
后续提交复用原任务，因此 Agent 后来读取笔记、构思画面也不能改变实际图片输入。
原 Featured command 已有独立的「全文 → 专用提示词生成描述 → 生图」步骤；仅调整
Chat 的调用顺序不能替代它。源码依据见 [SDD](../../development/active/unified-chat-image-creation/sdd.md#current-source-baseline)。
主动为自己的文字配图服务于笔记复用，符合[北极星](../pa-product-north-star.md)，不扩展为主动配图推荐。

## Options Considered

| Option | Benefit | Cost / conclusion |
| --- | --- | --- |
| 增加 @FeaturedImage | 明确内容配图意图 | 用户需理解两个生图入口，Owner 改选统一入口 |
| 单入口，仅让主 Agent 自行优化 | 接线较少 | 没有保留现有专用提示词步骤，不采用 |
| 单入口、明确来源、保留专用提炼 | 交互统一且保留既有能力 | 需要来源绑定与编排改造，Owner 接受 |
| command 继续独立生成 | 维持原操作习惯 | 执行、参数和保存容易分叉，改为 Chat 快捷入口 |

## Decision

1. 只保留 `@CreateImage` 生图动作；来源为不附加笔记、当前全文或选中文字。
   有选区时默认携带可预览/移除的选区；普通 Chat 入口无选区时不自动附加全文。
   用户明确选定的范围控件是确定依据；未选控件时，Agent 可依据自然语言查找并绑定
   实际笔记来源。真实歧义或文字与既有选择冲突才澄清，不猜测当前页或静默换源。
2. 全文/选区配图沿用现有 Featured 专用提示词，首版保留独立图片描述生成调用。
   同一提示词基线接收不同内容范围及补充要求；普通完整画面描述不强制经过此额外调用。
3. 主 Agent 处理请求并调用生图工具；宿主完成必要的专用描述准备后才创建图片任务。
   取消 Agent 启动前的原问题提交；不以助手自由回复冒充提交描述，准备失败不改发原问题。
4. 保留 `ai-assistant-featured-images` ID/快捷键；改为打开 Chat、选择 CreateImage、
   绑定选区优先/否则全文的草稿。命令不直接生成或发送，不覆盖已有草稿。
5. 结果统一进入 Chat；每次保存由用户选择目标笔记后插入正式附件，替代旧 command
   自动插图。已有有效模型、数量、路径配置及原图片不能静默丢失，兼容细节见 Spec/SDD。
6. 不新增第二个 Agent、独立 prompt 编辑器、通用编排平台或第二套持久图片任务。
   GPT 负责设计、任务及独立验收，GLM 负责限定实现和验证。决策批准时仅授权文档；
   后续实施授权与验收事实由 Tracker 记录，不由本决策推定。

## Consequences

- Product: 来源可见，文章提炼真正影响图片输入；来源充分时补充文字可留空。
- Data / lifecycle: 两次模型外发均检查来源、取消和连接；图片任务受理后仍不可变。
- Compatibility: 局部接续 DEC-038 D10、B-133/REQ-06 与 B-133/AC-06 的独立 Featured
  编排/插入约定，以及显式入口提前提交的技术选择；其余图片参考/编辑、数量费用、
  透明输入、复制下载、恢复和删除边界继续适用。
- Work removed: 原 command 的独立生图、下载、自动插入链在无消费者后退役。
- 生效边界：以上是已批准目标行为；交付状态只在 Tracker，当前 Architecture 仍描述已实现代码。

## Revisit Trigger

有真实质量和成本证据后，才评估把专用步骤并入主 Agent，不能预先认定等价。
新增来源、默认费用变化、自动插图或删减旧有效选项须重新讨论。

## Traceability

- [Product Spec](../specs/pa-unified-chat-image-creation-product-spec.md)
- [Feature Home](../../development/active/unified-chat-image-creation/README.md)
- 继承 [DEC-038](./dec-038-chat-image-generation.md)、[DEC-043](./dec-043-agent-runtime-evolution-and-source-scope.md)。
- Supersedes: 上述局部约定，不撤销 DEC-038 其余契约或改写历史验收。
