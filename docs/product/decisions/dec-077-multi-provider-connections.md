# DEC-077 — 多服务连接、默认继承与可复用的 Memory

Decision ID: DEC-077
Status: Accepted
Updated: 2026-10-30
Authority: Owner 在本次多 provider 讨论中逐项选择并最终同意的产品边界；本文整理这些决定，不代表实现、技术验收或发布批准。
Work item: B-192

## Context

当前聊天和笔记检索共用一组 provider、地址、模型设置及 vault 级凭据。切换预设
不会为各服务分别保存 Key；图片另有继承聊天或独立 Wan 的配置。用户需要在 OpenAI、
DashScope 之间切换，并允许以后通过代码适配其他服务，但不希望承担三套配置的负担。

另一项确定需求是保留已经准备的笔记检索数据：为 OpenAI 准备 Memory 不得覆盖
DashScope 数据；切回兼容配置时复用，不能每次全量重建。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 一份全局 Key，切服务时替换 | 字段少 | 原配置丢失、Key 与服务身份可能错配 | Rejected |
| 每项功能必须独立配置 | 灵活 | 首次使用及日常管理负担高 | Rejected |
| 保存多个连接，一项默认服务，按功能覆盖 | 通常只配一次，例外可见 | 需要有效配置解析、迁移和状态隔离 | Selected |
| 切换后立即重新准备 Memory | 自动完成 | 仅试用服务也产生笔记外发和费用 | Rejected；Owner 选择 A |
| 切换只更新配置，用户按需准备 | 聊天可先用，费用有明确触发 | 未准备的笔记检索暂不可用 | Selected |
| Memory 独立覆盖全部记忆 AI 处理 | 统一记忆服务 | 超出 chat/embedding/image 分工 | Rejected；Owner 选择方案 1 |
| 仅独立笔记准备和检索 | 范围清楚，保留现有文字处理归属 | 必须准确说明数据仍可能用于聊天回答 | Selected |
| 所有模型共用一份检索数据 | 占用较少 | 切换重建，无法保留原服务成果 | Rejected |

## Decision

1. 保存多个有稳定身份的连接，每条连接保留自己的凭据引用、服务身份、地址和模型选择。
   支持同一服务商的多条连接；改名与 Key 轮换不改变连接身份。
2. 当前 vault 选择一个“默认 AI 服务”。聊天、笔记检索、图片分别默认继承该连接的
   对应模型和 Key；三项都可显式独立指定连接。聊天的独立选择不改变另两项的默认来源。
3. 首次常用服务配置保持“选择服务及必要地区、填写 Key、保存”。预设模型自动填入，
   模型和地址按需调整。独立选择可以恢复默认；已生效的例外在概览中可见。
4. 独立 Memory 项称为“笔记检索（Memory）”，仅覆盖笔记准备与检索。从对话中学习
   记忆仍使用聊天连接；检索结果参与回答时，相关内容仍交给聊天服务。
5. 切换到没有兼容数据的配置仅进入待准备，不自动开始付费准备。用户主动准备时沿用
   数据、成本说明和确认。真正首次使用的 DEC-028 例外保留，但新增连接不是再次首次使用。
6. 各有效 embedding 配置的数据、准备状态、待更新状态分别保留。切换不清理，准备
   另一份或其失败不损坏已有份；切回检查兼容性和笔记变化后复用。未变化部分不因切换
   重算，删除、排除或已失效的旧内容不能继续返回。非当前配置不后台付费维护。
7. OpenAI 图片纳入本轮，覆盖文字生成、参考图创作和编辑已有图片，复用现有图片
   展示、下载、保存及版本关系。已有 Wan 能力保留；不得以“PA 尚未接入”冒充服务不支持。
8. 功能可用性区分服务能力、PA 适配、模型能力及凭据/账户/网络错误。不静默替换
   服务、Key、模型，不因未知图片受理而自动重新付费提交。
9. 在途操作保持真实连接与结果归属，不中途转交另一服务；配置变更、撤销和取消继续
   遵守既有生命周期。连接删除不默认连带删除 Memory；仍有引用时在该操作中处理。
10. 迁移保留旧 Key、模型、独立图片配置和已有 Memory；未知归属不猜测、不破坏。
    沿用现有设置同步边界，凭据状态按当前设备事实显示，Memory 仍为本设备数据。
11. 以后通过新增服务定义和必要协议适配扩展；不建设动态插件加载、自动路由、负载均衡、
    费用择优或单独的多索引管理平台。
12. 根据 Owner 2026-10-30 对 Key 管理和长 SecretStorage 名称的明确简化要求，用户
    通过可读连接名称管理 Key，不操作内部 ID；同服务多连接用名称/序号区分。新存储
    名称须简短且能辨认服务，防重及引用由系统维护，具体格式属连接owner工程设计。旧
    凭据保持安全兼容，不能为改名破坏引用、读取其他密钥或清理已有 Memory。

## Consequences

- Product behavior: 默认只选一次服务；用户能看清例外和当前使用的服务。切回恢复配置与兼容 Memory。
- Architecture / data / safety: 需要共享连接解析与按配置隔离的本地索引/状态；模型接口兼容不等于向量可混用。
- Compatibility / migration: 旧配置及旧存储必须先识别、保留再关联；不能仅根据当前下拉框推断旧 Key 或旧索引归属。
- Work created or removed: 新增 OpenAI 图片协议适配和多配置 Memory；复用现有 Agent、图片任务、资产、设置与维护 owner。
- Key management: 普通设置隐藏内部标识，明确填写/替换/移除；实际新存储名也缩短。SDK没有独立标签/重命名接口，旧长名逐步替换且可保留；不承诺仅改UI就能整理宿主密钥列表。

## Revisit Trigger

- 官方接口变化使三类图片目标无法实现；携具体证据讨论偏差，不自行缩减。
- 真实存储压力需要自动回收旧 Memory，或确有设备独立服务选择需求时，另行决定。
- 新服务需要新增外发目的地、存储/鉴权方式或产品能力，超出已支持协议时重新界定。

## Traceability

- Source: Owner 本次会话要求多 provider 可扩展；选择“默认继承、按需独立”；选择 Memory A 和方案 1；明确不得清理 DashScope Memory；最终同意 OpenAI 三类图片和整体边界。2026-10-30 要求完成详细设计文档，随后要求简化 Key 管理及带长 ID 的 SecretStorage 名称；自动命名/安全兼容细节为 GPT 在该要求内的工程设计，不冒称 Owner 指定了具体格式。
- Product Spec: [Multi-provider Connections](../specs/pa-multi-provider-connections-product-spec.md)
- Current architecture: [Settings与连接](../../architecture/settings-status.md)、[Memory](../../architecture/vss-sqlite-wasm-architecture.md)、[图片](../../architecture/chat-image-generation-architecture.md)
- Final validation: [B-192验收与边界](../../archive/2026/b192-multi-provider-validation.md)
- Scoped successors: 对 [DEC-029](./dec-029-inline-ai-setup-and-settings-focus.md) 的单连接配置、[DEC-038](./dec-038-chat-image-generation.md) 的 Wan-only/provider 连接范围及 [DEC-076](./dec-076-settings-ux-and-adaptive-graph.md) 的 AI 分组内容作目标行为接续；其余入口、来源、图片、费用、状态及可访问性规则保留。
- Memory: 接续单 active profile 的存储行为；[DEC-028](./dec-028-silent-memory-auto-prepare.md) 与 [DEC-054](./dec-054-memory-marker-recovery.md) 的确认、marker truth 和恢复边界保留。Current Architecture已核对吸收实现，历史验收不替代当前源码事实。
