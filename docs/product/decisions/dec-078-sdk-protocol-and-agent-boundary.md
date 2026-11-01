# DEC-078 — SDK 协议复用与 PA Agent 边界

Decision ID: DEC-078
Status: Accepted
Updated: 2026-11-01
Authority: Owner 在本会话确认 OpenAI 统一 Responses、其它服务尽量复用 SDK、PA 负责 Agent 数据与 harness；随后确认上述分析并补充 Custom 保持 OpenAI-compatible Chat Completions，授权形成设计文档。
Work item: B-194

## Context

`4160763b` 的连接架构已统一身份、凭据、用途和发送准入，但 `7dfd1777` 的 Responses
兼容处理仍限定于官方 Terra。普通 `ChatOpenAI` 已可由 SDK 自动选择 Responses，
却未经过相同的文字和完成状态处理。把旧模型规则冻结，或把 Terra wrapper 原样
改名为通用实现，都不能同时兑现 SDK 复用与 PA 自身执行契约。

Custom 原有产品入口是 OpenAI-compatible；当前 SDK 可能按模型名自动选择 Responses。
Owner 本次补充明确其目标为 Chat Completions，因而本决定将其协议固定下来；
不是声称此前源码已经保证固定协议。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 保留 Terra 专属实现，冻结旧 SDK 模型规则 | 变化较少 | 持续复制模型知识，其他 Responses 路径仍不一致 | 不采用 |
| 所有连接无条件跟随 SDK 自动路由 | 最大程度采用 SDK 默认 | 不满足 OpenAI 固定 Responses、Custom 固定 Chat Completions 的明确选择 | 不采用 |
| 明确连接协议策略，SDK 承担协议实现，PA 统一结果与执行契约 | 模型扩展复用 SDK；连接行为可解释；减少重复实现 | Custom 的固定协议需一个局部 SDK 扩展接缝 | 采用 |

## Decision

1. OpenAI 聊天用途统一 Responses，覆盖 Chat、Agent、Policy、Pagelet 与文字辅助调用；
   不再以 `gpt-6.1-terra` 精确匹配决定适配是否生效。Terra 仍是已选定的新建默认模型。
2. Custom 固定 OpenAI-compatible Chat Completions。模型名、SDK 模型资料及地址恰好
   指向官方 OpenAI，都不使 Custom 自动迁往 Responses；确需 OpenAI Responses 时选择
   OpenAI 连接。DashScope 继续使用 SDK 适配及必要的服务参数，不强制改为 Responses。
3. SDK 负责请求、协议格式、消息转换、流式解析和模型参数支持。PA 负责连接身份、
   输入来源、Agent 历史、结果消费、完成／失败、工具执行、取消及既有恢复边界。
   协议选择不构成换 provider／Key／模型的许可，也不构成工具执行许可。
4. 纯文本消费者优先读取 SDK 的文本投影，保留原消息的内容块、工具、usage 和拒绝信息。
   PA 在共同结果入口解释完成语义；只有 SDK 未暴露必要事实时保留最小补充接缝。
   不复制一套 SDK 请求循环，不以通用框架替代现有 owner。
5. OpenAI Responses 延续现有 PA 的无远端会话方式：显式 `store:false`，由 PA 重建
   当前允许使用的历史，不新增 `previous_response_id` 链、Conversations 或推理缓存。
   这是协议统一时的数据策略，不代表服务商零日志或获得 ZDR 资格。其它服务不因 SDK
   升级获得新的外发范围、远端存储或工具能力。
6. `gpt-4o-mini` 退出当前默认推荐和专门维护路径。统一新建聊天默认及相关展示，
   保留显式保存的模型值、历史记录及必要的迁移证据；不静默改成 Terra、不建模型黑名单。
   当前 embedding／图片默认、Memory profiles、独立用途和凭据不随本次聊天路线迁移。
7. 先完成 SDK 升级和相应验收，再准备正式发布。初始授权为设计文档；2026-11-01
   Owner 后续授权按 B-194 完成全部开发测试，并于同日明确授权收尾及本地 master
   提交。Accepted 表示产品选择已确定；升级验收已完成，推送及发布仍分别授权。

## Consequences

- Product behavior: OpenAI 与 Custom 的协议由所选连接表达，用户无需维护模型路由名单。
  Custom 中之前恰好触发 SDK Responses 的模型将按 Chat Completions 请求；服务不支持时
  如实报错，不暗中换协议或模型。迁移提示写入现有手册／发布说明，不新增通用确认弹窗。
- Architecture / data / safety: 结果格式与 harness 的公共处理替代 Terra 特供语义；
  保留来源、权限、取消、请求身份和实际效果归属，provider 完成不等于业务目标完成。
- Compatibility / migration: 不修改连接 schema、已保存模型、Key、历史或索引；无数据回填。
- Work created or removed: B-194 承接 SDK 升级及窄兼容设计；不重开 B-192/B-193，
  不接入新 provider，不改图片／语音能力，不新增动态注册、自动择价或 provider fallback。

## Revisit Trigger

- 当前 SDK 扩展点无法兑现固定协议或必要终态，且最小修正会改变已选 API／数据边界。
- 用户实际需要 Custom Responses、非兼容协议 provider、远端会话或新的媒体／工具能力。
- 真实升级证据表明现有平台、权限或来源契约无法保持；不得通过放宽断言宣布通过。

## Traceability

- Source: User request 2026-11-01，本会话对统一边界、SDK 复用、OpenAI Responses、Custom Chat Completions、旧模型维护及发布顺序的连续确认。
- Product Spec: [SDK Protocol And Agent Boundary](../specs/pa-sdk-protocol-agent-boundary-product-spec.md)
- Architecture: [连接架构与 SDK 接缝](../../architecture/settings-status.md#sdk-接缝与恢复职责)
- Validation: [B-194 最终验收](../../archive/2026/b194-sdk-protocol-validation.md)
- Scoped successor: 接续 [DEC-077](./dec-077-multi-provider-connections.md) 及其 Spec 中 Terra-only 聊天协议限制；其它连接、图片、Memory 和数据保留选择继续有效。
