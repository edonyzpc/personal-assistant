# B-129 Multimodal Chat Validation Evidence

Document status: Archived
Updated: 2026-09-06
Work item: B-129
Authority: 构建绑定的历史验证、失败与修复证据；不提供当前交付状态或发布授权。
Current contract: [Product Spec](../../product/specs/pa-multimodal-chat-product-spec.md) / [Architecture](../../architecture/multimodal-chat-architecture.md)
Raw identity: [逐文件来源与 SHA-256](./b129-multimodal-chat-evidence/manifest.json)

## 范围与来源

首版为图片输入、图片聊天、文案版本、显式图文保存和类似场景风格参考。
原验收按 P0 可行性与 P1–P5 生产集成分别记录；这里吸收最终结论，保留必要原始
回执、重要失败/修正配对和真实平台限制。54 份 JSON 从原目录逐字节复制并核对，
没有重排、删除字段或改写失败结果。

完整旧过程可从 Git `7c712924d7a2f8760ad92c83f879b2f887eea245` 的
`docs/development/active/multimodal-chat/` 恢复。该提交由运行时 `b6c67987`、
测试/探针 `f8e683c8`、文档/证据 `7c712924` 构成；提交动作复用此前验证，
没有新增一次全量运行。探针源码继续保留在 `scripts/prototypes/`，不从归档回执
推导新的执行、联网、模型调用、部署或发布权限。

## 最终构建与检查

- 最后生产 `main.js` SHA-256：
  `327f06e05c89e7997c826a70cc6b6d97876c993cc908f4312644bd9a35521d0b`。
- styles SHA-256：
  `a5998eba0c6fd0f027eb1e68f2d2d132f955a0daa6c9ad94d642fd7b863c50b2`。
- 完整自动化基线：aa9cb 构建 **238 suites / 6202 tests**。
  随后 I-09 比较对象修复与 I-15 不可读 Blob 恢复分别通过 25 项直接/相关测试、
  TypeScript、scoped lint 和独立 review；I-14 为 CSS 布局修复。
  最后构建及双目标部署通过，Community 源码扫描无匹配。
  **没有在最后 327f 构建重新跑完整 238/6202**，不把窄修检查冒充全量。
- iOS 实际加载于 `2026-09-06T14:40:44.977Z`，最终重载于 `14:43:44.871Z`；
  [Desktop 加载](./b129-multimodal-chat-evidence/p5/cache-recovery-desktop-loaded.json)
  为 `14:41:10.958Z`。文件部署一致性与实际加载身份分别核对。

## 生产保存与恢复

| 证据 | 已观察结果与限制 |
| --- | --- |
| [iOS 最终保存](./b129-multimodal-chat-evidence/p5/ios-ui-save-final.json) | 真实 Chat → Writing versions → 双图默认全选 → Preview → Save exact → 打开笔记；8 项检查通过：沿用版本、精确正文、两图、正式 PNG/JPEG、原件及附件 hash、正常附件位置、移除草稿仍保留原件。文件核对来自同步后的 iCloud，不冒充设备 IDB 检查 |
| [iOS 最终重载预览](./b129-multimodal-chat-evidence/p5/cache-recovery-ios-preview-final.json) | `14:44:20.951Z` 同会话 PNG 320×180、HEIC 640×480 均解码可见；无新模型调用 |
| [Desktop 服务初次失败](./b129-multimodal-chat-evidence/p5/desktop-services-01.json) / [复核通过](./b129-multimodal-chat-evidence/p5/desktop-services-02.json) | 初次 `retry_not_idempotent` 是 runner 按键顺序比较的误报；改为字段语义核对后 11 项通过，未以此改生产代码 |
| [Desktop 四种附件规则](./b129-multimodal-chat-evidence/p5/desktop-attachment-rules-01.json) / [iOS 相对规则](./b129-multimodal-chat-evidence/p5/ios-relative-01.json) | Desktop 根目录、指定目录、同目录、相对子目录 4/4；iOS 相对规则 1/1。目标笔记独立于活动 leaf，测试设置已恢复 |
| [Desktop 中断准备](./b129-multimodal-chat-evidence/p5/desktop-reopen-prepare-01.json) / [真实重载恢复](./b129-multimodal-chat-evidence/p5/desktop-reopen-resume-01.json) | 原件写后 finalize 失败及 note-create 后取消，重载后恢复登记和 partial 保存；属于受控故障加真实重载，不是 OS 崩溃 |
| [iOS 综合身份](./b129-multimodal-chat-evidence/p5/ios-combined-result-01.json) / [生产 wrapper](./b129-multimodal-chat-evidence/p5/ios-production-01.json) / [11 项服务](./b129-multimodal-chat-evidence/p5/ios-services-01.json) | 2f0f 在真实 WKWebView 加载并执行；覆盖 PNG/HEIC、版本/历史、正式附件、取消重试和原件缺失拒绝。服务调用不等同 Files 或保存 UI 点击 |
| [清缓存](./b129-multimodal-chat-evidence/p5/final-ui-cache-cleared.json) / [重新预览](./b129-multimodal-chat-evidence/p5/final-ui-cache-rebuilt.json) | 清理后副本为 0，再次预览重建两项；原件与正式文件 hash 不变，不外推其他用途/格式 |
| [删除聊天前](./b129-multimodal-chat-evidence/p5/final-ui-cleanup-before.json) / [删除后](./b129-multimodal-chat-evidence/p5/final-ui-cleanup-after.json) | 按删除前清单核对 9 个笔记/附件/原件仍在且 hash 不变；后回执绑定前回执 SHA，不从删除后的空记录推导安全 |
| [原图显式清理](./b129-multimodal-chat-evidence/p5/original-cleanup-ui.json) | 仅选定的无 PA 已知引用合成 HEIC 被明确移入回收站，其他受核对文件未变；不是导入或移除草稿丢原件，已知引用也不是全库无引用保证 |

## 文案、模型与风格证据

真实 Qwen 合成图曾返回与图像相符的颜色描述，但当时使用 JSON 代码围栏，
按旧严格规则进入人工恢复。这是单个样例的有限观察，不是整体图片理解质量保证。
后经用户批准支持单个完整 `json` 围栏；混杂、截断和终态不完整仍需恢复。
原 fetch-entry 观测只证明请求尝试，不是 provider 收到或逐项使用图片的回执，
故未将这些 wire 快照提升为最终模型效果证据。

| 证据 | 已观察结果与限制 |
| --- | --- |
| [恢复漏关联图片](./b129-multimodal-chat-evidence/p5/recovered-missing-materials.json) / [修后加载](./b129-multimodal-chat-evidence/p5/i10-loaded-identity.json) | 旧人工恢复曾出现 Associated images (0)，I-10 修复关联素材及新话题隔离；旧失败保留，不能再当作修后结果 |
| [旧图重看](./b129-multimodal-chat-evidence/p5/i10-reresolve-recovery.json) / [双图恢复](./b129-multimodal-chat-evidence/p5/i10-multi-recovery.json) | 真实 `resolve_chat_images` 及当前双图进入恢复素材，实际 UI 分别显示 1/2 张；请求入口观察仍不等于完整响应证据 |
| [双图保存原检查](./b129-multimodal-chat-evidence/p5/i10-multi-save.json) / [检查器修正](./b129-multimodal-chat-evidence/p5/i10-multi-save-verified.json) / [真实重载](./b129-multimodal-chat-evidence/p5/i10-multi-reload.json) | 原 checker 错按 frontmatter 长度跳过正文首字；修正检查后确认笔记未改、正文及各层 hash 一致，重载仍保留版本与 completed receipt |
| [不支持图片错误](./b129-multimodal-chat-evidence/p5/capability-offline-desktop-01.json) | 真实 SDK 接收本地 HTTP 400，matching response 1 次、远程转发 0 次；前后相同文字/hash/图片/ready 状态保留。顶层早期说明与内层响应不一致，结合实际 UI 确认已提交；不证明配置的 Qwen 不支持图片 |
| [自动 V1](./b129-multimodal-chat-evidence/p5/style-ui-01-before.json) | 真实 Chat UI 发送后，由本地 SDK 完整回复自动形成持久 V1，正文/hash/AI 来源正确，无 recovery，未自动建立风格；不证明远程 provider 质量 |
| [最小风格闭环](./b129-multimodal-chat-evidence/p5/style-final-loop.json) | 对现有版本调用生产 remember；同场景请求包含确切 revision/样例 hash，pause 后相同场景不再注入。共 2 次本地 ChatService/SDK 调用，远程转发 0，正常 stop 并自动 artifact；remember/pause 不是 UI 点击，固定夹具回复不能证明文风改变 |

异场景、当前要求优先、恢复、更正、Forget、来源排除、共享预算、自动提取双准入
复用源码回归，没有穷举对应实机治理 UI。自动提取关闭、consent paused；不能将
宿主没有新增风格记录误当开启自动提取的完整隔离实测。探针 fetch/设置已恢复，
独立夹具卸载；当时用户指定的 Chat/Policy `qwen3.8-max` 保留。
这些历史回执也不证明文案版本详情已经展示全部背景来源和风格样例。

## 兼容升级与移动修复

| 证据 | 已观察结果与限制 |
| --- | --- |
| [升级预检首次阻塞](./b129-multimodal-chat-evidence/p5/compat-upgrade-desktop-01.json) | Settings 关闭后临时 realm 的 IndexedDB factory 失效，未调用升级动作；I-13 改用稳定 realm，两库真实 initialize 通过 |
| [Desktop 02](./b129-multimodal-chat-evidence/p5/compat-upgrade-desktop-02.json) | 比较错误对象导致 `legacy_projection_mismatch` 安全拒绝，旧资料未改；这不是资料损坏证据，随后窄修 |
| [Desktop 03](./b129-multimodal-chat-evidence/p5/compat-upgrade-desktop-03.json) / [iOS 01](./b129-multimodal-chat-evidence/p5/compat-upgrade-ios-01.json) | 修后均为 `safely_refused / profile_evidence_unsupported`；完整 Profile、兼容字段、治理状态、迁移身份和原回滚期限保留。未发生升级提交，不声称当前旧库升级成功 |
| [移动布局修前](./b129-multimodal-chat-evidence/p5/b129-ios-layout-before.json) / [修后](./b129-multimodal-chat-evidence/p5/b129-ios-layout-after.json) | hidden 按钮由仍占 44px 修为 display=none、高度 0，文件名/状态/移除按钮实际可操作；该改动只涉及 CSS |
| [iOS 缓存诊断](./b129-multimodal-chat-evidence/p5/ios-preview-diagnostic.json) / [最终重载](./b129-multimodal-chat-evidence/p5/cache-recovery-ios-preview-final.json) | Blob 元数据仍在但读取字节抛 NotFoundError；I-15 按缓存未命中从已校验原件重建，最后两图解码可见，原件未受影响 |
| [动画失败项](./b129-multimodal-chat-evidence/p5/final-ui-animation-before-remove.json) / [移除后](./b129-multimodal-chat-evidence/p5/final-ui-animation-after-remove.json) | 真实 GIF 选择后提示静态恢复；移除失败项后文字保留、Ask 恢复可用、原件 hash 不变。早期采集器没取 textarea，不能拿缺失字段推断草稿丢失 |

## P0 平台与资源依据

P0 使用既有宿主插件做独立合成探针，没有部署 B-129；Desktop Obsidian 1.14.0
（installer 1.12.7），iPhone 15 / iOS 26.6.1。以下是可行性与参数依据，不能
代替上述生产集成、真实 UI 或模型效果。

| 依据 | 结论与边界 |
| --- | --- |
| [Desktop 取得原件](./b129-multimodal-chat-evidence/p0/desktop-acquisition-01.json) / [iOS 取得原件](./b129-multimodal-chat-evidence/p0/ios-acquisition-01.json) | Files 两端及 Desktop Finder 粘贴交付相同 HEIC hash；iOS Photos 交付已转换 JPEG，按 unverified_import 恢复。iOS 粘贴未取得可靠事件，不推导所有剪贴板均不支持 |
| [Desktop 格式初测](./b129-multimodal-chat-evidence/p0/desktop-formats-01.json) / [SVG 补测](./b129-multimodal-chat-evidence/p0/desktop-formats-02.json) / [iOS 格式](./b129-multimodal-chat-evidence/p0/ios-formats-01.json) | 各 22 个有效输入案例，区分静态/动画、HEIF 序列、外部/坏内嵌 SVG；原件保留及失败恢复不等同完整动画支持 |
| [像素与元数据](./b129-multimodal-chat-evidence/p0/pixel-metadata-analysis.json) | 方向、颜色、透明度、小字与源敏感元数据独立核对；iOS 输出仍可带新生尺寸/色彩信息，不写成所有 metadata 为空 |
| [Desktop 锚点](./b129-multimodal-chat-evidence/p0/desktop-anchors-01.json) / [iOS 锚点](./b129-multimodal-chat-evidence/p0/ios-anchors-01.json) | 固定会话锚点、活动 leaf 切换、rename、设置变化与旧原件 hash；同步指南不是已完成外部排除 |
| [最低 API](./b129-multimodal-chat-evidence/p0/minimum-api-receipt.json) / [治理预算](./b129-multimodal-chat-evidence/p0/governance-budget-validation.json) | 最低 1.11.4 的官方声明/实现/导出依据；未安装旧版。治理原型 43 项与 SDK 原型 19 项是各自原型证据，不是生产迁移验收 |
| [Desktop 资源初测](./b129-multimodal-chat-evidence/p0/desktop-resources-01.json) / [缓存与迟到回调补测](./b129-multimodal-chat-evidence/p0/desktop-resources-02.json) / [iOS 资源](./b129-multimodal-chat-evidence/p0/ios-resources-01.json) | 12/24/48 MP、字节梯度、真实 IDB/LRU/lease/重开、取消/超时/迟到、注入 quota；没有主动耗尽设备配额 |
| [最终 Desktop](./b129-multimodal-chat-evidence/p0/desktop-final-resources-01.json) / [最终 iOS](./b129-multimodal-chat-evidence/p0/ios-final-resources-01.json) / [综合判读](./b129-multimodal-chat-evidence/p0/resource-host-analysis.json) | 3200/.9 的单张及 8 张 48 MP 串行转换通过，资源所有权释放且原 hash 不变；8 图复用一份合成图，不等同八份高熵照片或所有大 HEIC |
| [首段 iOS 数值时间线](./b129-multimodal-chat-evidence/p0/ios-timeline-numeric.json) / [最终时间线](./b129-multimodal-chat-evidence/p0/ios-final-timeline-numeric.json) | 第二段基线中位 757.43 MB、实采最大 962.68 MB、最后 GC 后中位 825.40 MB；不是全设备精确峰值，不宣称内存全部返还。两段不同宿主状态不互作增量基准 |

资源时间线的真实 critical 事件发生在运行结束后、切到后台附近；它与 WebKit
后台主动清理路径一致，但回执无原因，不能断言为 OOM，也不能隐去事件。
完整动画理解、外部资源 SVG、图片生成及跨设备续聊属于另行设计的后续方向；
不从静态恢复、原件入 vault 或标准附件同步推导这些能力已经交付。
