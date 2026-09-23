# DEC-041 — PA Agent 可视化调试与本机历史

Decision ID: DEC-041
Status: Accepted
Updated: 2026-09-22
Authority: Owner 在本次 Debug 设计讨论中确认两层数据保留，要求历史包含正文和 Prompt、保留 30 天，随后明确选择容量满时删除最旧记录，并接受删除联动与附件仅保留引用的边界；本次明确要求写成设计文档。Accepted 指产品决定，不表示已实现、验证或授权发布。
Work item: B-145

## Context

[Discussion #382](https://github.com/edonyzpc/personal-assistant/discussions/382)
提出记录 stopReason、provider completion、diagnostics 和 token usage。Owner 随后
明确：界面应按 PA Agent 的实际运行阶段组织，便于理解状态、每轮结果、参数、
模型消耗、错误与实际观察到的思考规划，不以一组 provider 字段作为固定信息架构。

当前 Chat 历史保存对话及部分结果摘要，Debug 主要提供内容无关的控制台观察；
它们不能提供完整的历史运行轨迹。纯会话内调试也不能满足重启后的历史诊断。
本决定为显式 Debug 建立有界本机历史，保留普通 Chat 的安静体验及既有数据边界。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 所有 Debug 数据只在插件会话内 | 存储负担低 | 重载后无法查看执行历史 | 被两层保留方案替代 |
| 历史仅保存无内容元数据 | 较小的内容暴露面 | 缺少实际输入，难诊断上下文或 Prompt 问题 | Owner 明确要求同时保存正文与 Prompt |
| 历史保存过滤后的正文与 Prompt，reasoning 留在会话内 | 支持跨重启诊断，并限制额外内容副本 | 需要保留期限、容量、删除联动与性能保护 | Owner 接受 |
| 容量满时暂停记录，或淘汰最旧记录 | 前者保住已有历史；后者持续保留最新运行 | 无法同时保证固定容量、完整 30 天和无限新数据 | Owner 选择淘汰最旧记录 |
| Debug 内容独立于用户删除长期保留，或联动清除 | 独立保留利于取证；联动避免已删内容从 Debug 找回 | 联动会降低部分旧记录的诊断能力 | Owner 接受删除联动 |
| 复制附件本体，或仅保存引用与指纹 | 复制有利于完整还原；引用降低存储负担 | 引用不能保证原文件变化后仍可还原 | Owner 接受仅保存引用、类型和内容指纹 |

## Decision

1. **入口和组织**：Debug 开启时，在 Chat 发送按钮旁提供 Debug 按钮，在 Obsidian
   tab 打开运行检查器；上方显示可视化轨迹，下方展示所选节点的细节。按
   Run → Turn → 阶段/调用/工具组织，支持当前运行和历史运行。
2. **采集授权**：Debug 开关本身允许本机查看工具参数与 provider 实际返回的
   reasoning，无第二个敏感内容开关。关闭后停止新内容采集，已保存历史仍可查看。
   当前范围为 Chat Agent 及其关联调用，不自动扩展为所有后台 Agent 的记录器。
3. **持久历史**：本设备、当前 vault 隔离保存轨迹、状态、参数摘要、调用消耗、
   错误，以及实际使用的正文和经过过滤的 Prompt 快照。最多保留 30 天，容量满时
   优先按完整 Run 淘汰最旧已结束记录，持续采集最新运行；实际保留期可短于 30 天。
   不写入 Markdown vault 或同步目录。
4. **内容交叉边界**：已进入 Prompt 的工具参数、工具结果和附件提取文本随快照
   保存。未入模的完整工具数据、provider reasoning 和底层响应细节仅在当前
   插件会话保留。持久快照排除 reasoning 专用字段，明确展示过滤标记，不承诺
   原始请求字节级一致。凭据、认证头和 Cookie 从采集入口排除，不能进入会话缓存。
5. **删除联动**：删除对话同步删除对应 Debug 历史。Forget 或明确撤销来源时，
   清除关联正文、Prompt 与派生快照，仅保留不含相关内容的运行统计。待写队列、
   内存、视图和数据库共同遵守删除，迟到写入不得恢复已删除内容。
6. **媒体**：记录图片/附件的引用、类型和内容指纹，不额外复制文件本体，也不
   把内联 base64 当作文本绕过这一边界。原件变化或不可用时如实提示；Debug
   清理不删除原始附件或修改现有 Chat 媒体管理行为。
7. **性能与真实性**：Debug 不新增模型调用，不改变 Agent 调度、来源、权限、
   工具执行和结果语义。采集、持久化与渲染解耦且有界；采集失败或资源不足时
   Agent 继续，并如实标明记录缺失。性能参数由工程设计和对照验证确定。
8. **回看边界**：历史只读，查看轨迹不触发模型/工具，不自动继续或重放任务。
   记录只能说明观察到的执行过程，不证明相同输入一定得到相同结果。

### 与既有契约的关系

本决定是 [B-144 观测边界](../specs/pa-recoverable-agent-execution-product-spec.md)
和 [Data Boundary 的文本保留规则](../specs/pa-data-boundary-product-spec.md#101-text-retention-boundary)
之上的显式 Debug 目标修订：允许本机有界正文/Prompt 历史，并要求相应过滤、
清理与安全验证。实施前当前 runtime 仍是原有内容无关观察器。

Debug 关闭不采集原始内容、观察失败不影响执行、真实来源授权、排除/Forget、
opaque bridge 不可识别、持久动作确认及重载后用户继续等规则保持有效。
本次不授权向外部服务上传调试数据，也不授权自动导出、同步或新增 provider 请求。

## Consequences

- Product behavior: 开发/诊断入口可忽略；按执行阶段理解实时状态与近期历史。
- Architecture / data / safety: 新增本机有界内容存储；删除、内容分类和采集失败必须有回归证据。
- Compatibility / migration: 保留现有 Chat 历史，不伪造旧运行轨迹；旧记录显示未采集。媒体仍由现有模块拥有。
- Work created or removed: B-145 承接独立调试能力，不重开已交付 B-144；Owner 随后要求最后设计复核与开发方案，由独立开发入口接续，尚未授权实现。

## Revisit Trigger

- 已测容量或性能无法同时满足最新运行持续采集与正常 Chat 体验。
- 需要持久 reasoning、附件本体、跨设备历史、导出、全后台覆盖或任务重放。
- 内容过滤、来源删除联动或本机隔离出现不能按现有边界处理的缺口。

## Traceability

- Product Spec / design: [PA Agent Debug View 设计](../specs/pa-agent-debug-view-product-spec.md)
- Existing execution decision: [DEC-040](./dec-040-recoverable-agent-execution.md)
- Development entry: [B-145 Feature Home](../../development/active/agent-debug-view/README.md)
- Source discussion: [GitHub #382](https://github.com/edonyzpc/personal-assistant/discussions/382)；后续选择以本次用户逐项确认为依据，未将其伪称为 GitHub 原讨论内容。
