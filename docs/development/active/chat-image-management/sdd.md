# Chat Image Management Software Design

Document status: Approved
Updated: 2026-09-08
Work item: B-129
Authority: 已确认产品范围内的 source-verified implementation design。
Product spec: [Multimodal Chat](../../../product/specs/pa-multimodal-chat-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Current Source Baseline

- ImageAssetService.importFile/addVaultReference 在登记前读 bytes，inspect 异常被吞以保留动画等原件。
- ImageRef 为 asset ID + hash；历史和文案不冻结路径；多个资产可指同一文件。
- WritingSaveAction.prepare/run/verifySources 冻结源路径并复制，SaveReceipt 严格验证不可变字段。
- 图片服务已有队列及 rename 事件；imported 来源仍授予清理权。
- processor 本地及 macOS 转换 HEIC；resolveVariant 读取用途隔离的缓存。

## Design And Data Flow

1. Proposed assertNewChatImageSupported(bytes) 按容器 brand 在导入登记/写入及处理器解码前拒绝 HEIC/HEIF，不信后缀/MIME。其他格式边界不变，系统交付 JPEG 直接接受。
2. 处理器停止生产转换调用。保留旧枚举与可读缓存；缓存缺失提示 JPEG，不生成新转换结果。所有新交付统一 acquisition，旧 unverified_import 仅供兼容读取，不产生警告任务。
3. SaveAttachment 新增可选 transfer: move/reference；undefined 严格继承旧复制。新 prepare 拒绝 HEIC，按实际同路径/hash 去重，普通附件直接引用。
4. images.promoteToNote(ref,{sourcePath,targetPath,operationId,signal}) 在图片队列中处理持久移动意图，返回真实 path。targetPath 可为延迟 resolver，仅首次迁出调用。意图冻结 source/target/hash/operation，并先于移动落盘；保存 receipt 在返回后冻结 actual plannedPath。失败重试使用同一 operationId。
5. 移动前源 hash/size 正确、目标不存在。源和目标同时存在即冲突，即使同 hash；源消失且目标内容正确，只在已有移动意图下认领。登记失败按意图恢复，绝不删除冲突文件。
6. 同一文件所有资产定位同步更新并转为 vault_reference；保留 importDirectory 作为来源证据。read/verify 先恢复相关意图，再核验字节。多预览后执行者凭 PA 晋升记录复用已迁出的真实位置，不能把任意外部 relocate 当同一已批准计划。
7. 路径来自实际目标笔记及 Obsidian 公共附件 API。普通附件及已迁出的图片不随再次保存/设置变更移动；清理同时要求仍在聊天目录且具备管理权，不仅检查 imported。

## Interfaces And Ownership

沿用 store 的 image setting 和 asset/save 接口，不新增数据库或通用事务平台。
图片服务封装串行迁出与恢复；保存服务拥有固定文字、选图和结果记录。
每个写入点检查源/目标数据边界，取消预览零写入。

## Compatibility, Migration And Rollback

旧记录不批量重写。旧 HEIC 已生成正式 JPEG 可按 frozen hash 恢复，缺输出明确失败并保留原件/文字/记录，不调用旧转换器。已完成旧复制结果保留。
迁出资产写为旧版可读 vault_reference，阻断旧清理入口；新 receipt 旧版无法解析时拒绝恢复，不搬回文件。
源/目标与本地元数据非原子，依靠先记意图与幂等核验恢复；不承诺无法证明所有权的外部同 hash 文件归属。显式重新定位保存旧意图为历史并退出读取路径，不伪造旧操作完成。单项恢复失败不隐藏其他资产；pending 迁出阻止聊天清理。
不监听手动笔记引用，不批量转换或清理旧文件。

## Data, Privacy And Cleanup

迁出保持原字节及元数据，遵循普通附件同步设置。未选图片不动，删除聊天/清缓存不删原件。provider 仅收到去除源敏感元数据的处理副本；缓存不掩盖原件缺失或替换。

## Test Matrix

| Requirement / AC | Scope |
| --- | --- |
| B-129/REQ-01 / B-129/AC-01 | 本次输入、迁出、兼容与同步验证 |
| B-129/REQ-02 / B-129/AC-02 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-03 / B-129/AC-03 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-04 / B-129/AC-04 | 本次输入、迁出、兼容与同步验证 |
| B-129/REQ-05 / B-129/AC-05 | 本次输入、迁出、兼容与同步验证 |
| B-129/REQ-06 / B-129/AC-06 | 本次输入、迁出、兼容与同步验证 |
| B-129/REQ-07 / B-129/AC-07 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-08 / B-129/AC-08 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-09 / B-129/AC-09 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-10 / B-129/AC-10 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-11 / B-129/AC-11 | 本次输入、迁出、兼容与同步验证 |
| B-129/REQ-12 / B-129/AC-12 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-13 / B-129/AC-13 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-14 / B-129/AC-14 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-15 / B-129/AC-15 | 本次输入、迁出、兼容与同步验证 |

覆盖字节检测、各入口、旧枚举/缓存/receipt、移动前后登记失败、共享资产、两个预览、同名冲突、四类附件路径、取消与排除。
自动验证与 Desktop/iOS 实际证据按 Tracker 分别报告，不复用旧 HEIC 转换 PASS。

## Approval

- Design authority: 用户于 2026-09-08 确认产品规则并明确要求开发；本文记录兼容实施选择，不制造新的产品批准。
- Approved on: 2026-09-08
- Authorized implementation scope: 输入、迁出/复用和兼容恢复；无批量清理或 Git/发布动作。
