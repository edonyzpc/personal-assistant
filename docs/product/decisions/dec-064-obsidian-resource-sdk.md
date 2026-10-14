# DEC-064 — Obsidian 内部通用执行与资源 SDK

Decision ID: DEC-064
Status: Accepted
Updated: 2026-10-14
Authority: Owner确认QuickJS Worker、广泛资源SDK、Agent自主性及范围A（核心SDK，第三方插件仅保留接入方式），最初要求方案且先不改代码；2026-10-13随后明确授权按方案完成开发测试，2026-10-14授权完整复核、closeout及本地master提交。各授权按实际发生日期记录，不含推送或发布。
Work item: B-174

## Context

PA 的基础工具应支持日常笔记管理，代码执行则让 Agent 能自行组合读取、算法和操作。
泛化范围是 Obsidian 内部；Pi/Terminal 是技术参考，不是扩大为操作系统 Agent 的依据。
[B-173](./dec-063-direct-operations-and-native-move.md) 已提供单次 Operations、原生 Markdown move、结果连续性和能力不足收尾，不能重复建设。
[DEC-061](./dec-061-independent-agent-computation.md) 的独立计算已存在，但没有宿主桥接。

Owner 已明确：稳定性和真实资源保护必要；桥接不增加任务语义限制、固定步骤或常规确认。
临时验证支持 Worker/RPC 与纯库路线，同时暴露 schema 不等于校验、取消不等于效果撤销、缓存/编辑器/保存内容不一致等接线要求；最终证据与限制见 [B-174 验证记录](../../archive/2026/b174-obsidian-resource-sdk-validation.md)。

## Options Considered

| 方案 | 能力与代价 | 选择 |
| --- | --- | --- |
| 仅继续增加专用工具 | 能补基础任务，不能承载任意组合算法 | 作为日常便利入口保留，不作为全部方案 |
| Agent JS 直接在 Obsidian 主线程执行 | 可直接调用宿主对象；同步计算无法由同线程 timeout 抢占 | 不采用 |
| QuickJS/WASM Worker + 数据 RPC + 资源 SDK | 自定义计算可隔离，宿主操作由既有 owner 执行；需要正确桥接身份、资源与结果 | 已选择 |
| 同时交付通用第三方插件调用 | 覆盖更多生态服务，需明确目标插件及其真实服务边界 | Owner 选择 A：本轮不以此验收，仅说明扩展接入方式 |

## Decision

1. Agent 任意算法、循环、兼容纯 JS 库运行在一次性 QuickJS Worker；只有必须操作 Obsidian 的具体请求进入宿主。不开 raw app、DOM、任意宿主 eval、函数回调、OS shell 或任意模块安装。
2. 核心 SDK 覆盖文件/目录枚举、文本/二进制读取、metadata/链接、文本创建/替换、mkdir/move/trash、workspace context/open/editor edits、Operations status/Undo，以及既有获准能力的组合。完整职责清单见 [Architecture](../../architecture/obsidian-resource-sdk.md#工具与-sdk-职责)。
3. 泛化资源包括 Markdown、Canvas、Bases 等文本，以及目录与附件的相应操作；不能悄悄缩回 Markdown-only。二进制写入、PDF/OCR/媒体理解和第三方插件服务另属扩展；读取字节不等于理解媒体。
4. Agent 自主选择目标、算法、顺序、合理并发、读取/预览与恢复。Host 只根据真实权限、来源、身份/版本、协议、资源和生命周期判断准入。无累计文件数/调用数配额，无关键词意图裁决、强制 Skill 或新的常规确认。
5. 复用现有最终执行链、TaskSourceRun、领域 owner、Operations、review、Undo 与历史事实。不建第二套注册、计划、交易、权限或操作账本。脚本失败/停止不抹去已发生的效果，不自动重放整段脚本或自动回滚。
6. preview 读取真实宿主状态，效果调用只产生明确的预览/未执行结果；不承诺完整虚拟 vault 或预览写后读。需要真实执行时重新检查当前事实。
7. 恢复能力按 owner 的真实回执表达，保留既有操作的恢复合同。目录撤回等未验证项先工程调查；若确实不能兑现原定行为，再提供具体降级/延期/补充实现选项，不以本决定预先批准降级。
8. 本轮选择 A：完整方案以核心 SDK 为交付范围；插件扩展复用同一服务桥接方式，但不新增插件管理平台、实例反射或首批第三方适配承诺。

### 2026-10-13 Owner 批准的桌面 mkdir Undo 限制

Obsidian 1.14.4 桌面实测 `Vault.delete(folder, false)` 与 `adapter.rmdir(path, false)` 对空目录均返回 EISDIR；先检查为空后递归删除不能保护后来加入的内容，Node/fs 超出本决定边界。Owner 对“仅将桌面端 mkdir 的 Undo 暂记为不可用，保留创建、review 和准确失败说明，其余能力完整交付”明确回复：“接受这项明确限制，继续完成其余开发测试”。

因此本轮桌面 mkdir 保留真实创建、预览、审阅及效果记录，但不得声称安全 Undo 可用或生成可执行的撤回承诺。其余效果/恢复合同保持；移动端公共非递归路径仍按原 owner 检查并如实报告实际结果，不以桌面证据声称真机通过。恢复桌面 mkdir Undo 需先有可用、安全的公开 API 证据。此项批准仅解决 Tracker U3，不批准递归删除、Node/fs、其他降级或发布。

### 2026-10-14 Owner 批准的容量不足回收行为

Owner 在要求进一步减少过度约束后，对“当操作已获授权、原生安全回收可用，但文件太大或 PA 备份容量不足”的选择明确回复：“允许移入原生回收站，并明确说明本次 PA Undo 不可用（推荐）”。这取代此场景必须先具备 PA 会话恢复快照才能回收的限制。

仅文件或会话备份容量不足允许此分支；范围、目标身份、目录完整性与安全原生回收检查保持，读取错误或权限失效不按容量不足处理。结果须为真实回收事实、`undoAvailable=false`、容量原因且无可执行 receipt；不得永久删除或声称原生恢复已得到验证。可容纳的快照仍提供原 PA Undo。恢复原行为只需将容量分支恢复为未执行拒绝，不改变已发生的回收事实。

## Consequences

- 本决定在新 Obsidian 执行入口中扩展“独立计算之外的脚本 I/O”；不改变现有 `execute_code` 的纯计算合同。两个入口共享沙箱实现，不重复 VM。
- [DEC-062](./dec-062-agent-hybrid-tool-disclosure.md) 的披露与权限分离保持；合法未披露调用不因未加载而拒绝。没有第二个 loader 或工具安装器。
- 本轮比 B-173 的 Markdown move 扩大了资源类型，但复用其效果/审阅职责；原生 move 的引用维护仍交 Obsidian。
- 保持最低 App 版本、desktop/mobile 目标和三文件安装布局；新桥接的平台验证单独完成，不挪用旧纯计算证据声称通过。
- 不新增用户设置、后台常驻执行、持久脚本状态、长期 Undo 或通用网络目标访问。已有能力的网络/成本/确认约束继续由原 owner 决定。

## Revisit Trigger

已确认接口无法在目标平台兑现、真实资源限制迫使用户可见能力降级、需要二进制写入/媒体理解、出现明确第三方插件场景，或涉及权限/数据/兼容性范围变化时，提交具体证据与选项。方法命名、消息编码和模块内实现可在既有约束内细化。

## Traceability

- 用户依据：依次确认“清单与设计”“稳定、资源相关保护之外保持自主性”，选择“A”，并要求“完整细致的方案……先不改代码”。
- [Product Spec](../specs/pa-obsidian-resource-sdk-product-spec.md)
- [Current Architecture](../../architecture/obsidian-resource-sdk.md)
- [B-174 验证与边界](../../archive/2026/b174-obsidian-resource-sdk-validation.md)
- [统一 Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
