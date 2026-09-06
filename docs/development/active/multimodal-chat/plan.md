# Multimodal Chat Delivery Plan

Document status: Approved
Updated: 2026-09-06
Work item: B-129
Authority: B-129 的交付顺序、依赖、风险、验证策略及实施边界。
Product spec: [Multimodal Chat Product Spec](../../../product/specs/pa-multimodal-chat-product-spec.md)
Tracker: [Development Tracker](./tracker.md)
SDD: [Software Design](./sdd.md)

## Goal And Non-goals

交付图片输入 → 图片理解/文案修改 → 固定版本图文保存的完整链路；显式风格参考
独立接入现有 Memory 治理。所有关联图片保留，不按参考/主题用途筛除。
不交付图片生成、跨设备聊天、视觉索引、社交发布或权限体系重构。
用户于 2026-09-06 明确确认完整动画理解和依赖外部资源的 SVG 渲染后续推进；
本版交付它们的原件保留、清楚提示与静态 PNG/JPEG 恢复入口。静态自包含 SVG
仍可本地处理，不能把这项决定扩大为所有 GIF 或所有 SVG 均不支持。

本计划把需要实测的技术选择放在最前面的工程验证阶段，并规定成功证据和失败
处理。阶段任务不是已通过的证明；执行情况只写 Tracker。2026-09-06 用户回复
“开始”，本轮从 P0 工程验证执行；后续生产 slice 仍须满足对应 P0 出口。

## Dependencies And Source Surface

- Source prerequisite: B-129 使用 master `42859863` 的 B-128 完整实现作为 P0
  基线，整合保留本包及已有修改，并重核请求组装接点。
  设计基线见 [SDD Current Source Baseline](./sdd.md#current-source-baseline)。
- UI / assets: `src/chat/chat-view.ts`、`src/ai-services/chat-types.ts`、
  `src/chat/chat-history-store.ts`、`chat-history-manager.ts`、
  `ConversationPersistence.ts`，以及 Obsidian 公共附件 API。
- Model / context: `src/ai-services/chat-service.ts`、`pa-agent-runtime.ts`、
  `src/ai-services/context/`；复用 Chat/LangChain，不创建第二个视觉 Agent。
- Save: `src/ai-services/operations/` 的预览、结果和顺序失败语义；二进制附件由
  host action 处理，现有 `vault_create` 文本 schema 不代表已有图文事务能力。
- Memory: Type A 提取/调度、legacy adoption、`src/pa/memory-use-projection.ts`、
  `memory-governance-persistence.ts` 和共享 Data Boundary。
- Public attachment API 的最低版本声明/发布实现、当前双端调用及实际选图入口
  证据见 [P0 技术可行性证据](./p0-evidence/technical-feasibility-20260906/README.md)。
  Photos 可能交付系统转码副本，按既有 `unverified_import` 提示从 Files
  取得原件；最低 API 核查不等于旧版 runtime smoke，生产入口仍按 P1/T-14 验收。
- P0 实测与用户批准细化：新笔记先登记 receipt、创建确切正文，再按真实 note
  解析附件路径，补齐图片和链接；未完成状态可恢复。用户随后明确确认 HEIC
  使用设备已有能力本地转 JPEG，macOS 可用固定系统转换器；无法转换时保留
  已取得原图和当前草稿并提示提供 JPEG，不保证所有设备自动处理。不引入
  libheif、不自动安装解码器、不远程转码。用户独立确认正式保存 JPEG，HEIC
  原件留在 pa-images（既有 vault 原件不移动），不另存正式 HEIC；笔记保留
  来源关联，其他设备可能只有 JPEG。当前处置见 Tracker D-14。

## Phases

2026-09-06 用户确认的生产兼容增量纳入原任务：T-08 增加单个完整 JSON
代码块的严格解析及正常/中断边界验证；T-12 增加旧兼容态显式只读预检、完整
来源映射与原子升级，验证失败保持旧资料、撤销和投影不变，成功后复核风格及
回退不复活已忘记内容。按既有队列与治理事务实现，不扩展网络、提取或重建。
两项先做聚焦回归和独立 review，冻结后复用同一构建完成 Desktop/iOS 验收。

这里的 P0–P5 是开发阶段编号，不是问题严重等级。每阶段遵循
`dev → focused test → review → fix → verify`；带用户界面或共享运行时的阶段
按实际受影响路径做 Obsidian smoke。优先使用既有测试 vault、离线 transport 和
合成图片，不扩大成全模型/全设备矩阵。

| Phase | Outcome | Scope / owner responsibility | Dependencies | Exit gate |
| --- | --- | --- | --- | --- |
| P0 | 封闭平台与基线不确定性 | 集成负责人核对 B-128；图片负责人完成导入/格式、目录锚点、资源校准；runtime/治理负责人做最小独立原型 | 明确实施/工程验证授权 | G-01–G-03 的平台/处理探针、G-04a 的消息与文案 envelope 原型、G-05a 的 schema/静态治理资格与动态场景原型有证据或明确产品裁决；不依赖后续生产 slice；未证明的格式不标支持；SDD 按结果更新后进入相应生产 slice |
| P1 | 能可靠加入、查看、保留和清理图片 | 图片负责人拥有 Proposed asset/processor 模块与 history store 扩展；UI 负责人拥有 composer/attachment UI | G-01/G-02/G-03；schema 方案确定 | 原图字节一致，四种附件目录规则有效；三类同步结果真实；pending import 先登记后写及重启恢复通过；持久引用及缓存限额、取消、配额失败通过；纯图/处理中草稿不会被 Pagelet handoff 覆盖；桌面和 iOS 各能导入/重开查看 |
| P2 | 图片完整贯穿 Chat 与 B-128 | Runtime 负责人拥有 chat-service、runtime/context 与模型能力适配；UI 接入草稿恢复和旧图入口；Memory 负责人先交付 T-11 | G-04a、P1；T-11 依赖 G-05a 与 P1 消息接口，在图片聊天启用前通过 | G-04b：真实 bound-model 离线请求验证当前/旧图、工具续轮、压缩、重试及 reserved final；不支持/未知模型恢复正确；异步导入和 next-draft 恢复不覆盖已有图文草稿；未保存聊天的 governed/legacy 提取防污染、Data Boundary 最终检查及敏感元数据测试通过 |
| P3 | 文案版本与正式图文保存 | 保存负责人拥有 writing artifact、保存 host action/receipt；UI 负责人负责正文/来源/预览；Memory 负责人交付 T-11b 生成笔记来源标记 | P1、P2 的消息与来源接口；保存启用前完成 T-08/T-11b | 文案最终答复 envelope 经 host 完整终态验证并穿过 bridge；reserved final 禁用工具时仍能产出版本，中断/格式失败不自动冻结版本；选定正文逐字一致；A 照片+B 截图及回选旧版保留全部关联图；目标笔记附件规则、部分失败、重开重试不重复/覆盖；桌面和 iOS 图文保存 smoke |
| P4 | 显式且可撤销的类似场景风格 | Memory 负责人拥有 typed style payload、静态治理资格与动态投影；UI 接入查看/取消/恢复/更正 | G-05a、P3 的版本接口与 T-11/T-11b | G-05b：保存/局部改写/当次要求的双层防污染通过；显式版本样例可查看并在不匹配的当前场景取消/恢复/更正；普通 custom 仍 fail closed；旅行和工作邮件使用隔离；Data Boundary 改变与聊天清理不造成越界或丢失授权版本 |
| P5 | 完整首版验收与实现文档对齐 | 集成负责人跑必要 full gate；独立评审分图片生命周期、runtime/Memory、产品交互三条 lane | P1–P4 | 全部 15 组 AC 有对应证据；Desktop 与真实 iOS 最小端到端路径通过；严重问题关闭或由用户明确处置；支持声明与实测一致；Tracker 才可标 Validated |

防污染分两步交付：T-11 基于 host 消息 provenance 保护聊天提取及 governed/legacy
准入，在 P2 图片聊天启用前完成，不依赖 P3 的 WritingVersion；T-11b 再基于
T-08 的固定版本接口写入生成笔记来源元数据，在 T-09 保存启用前完成。不能
因为用户尚未保存而让“这次短一点”等聊天内容成为长期风格。显式风格按钮仅
在静态治理资格、动态场景投影及完整生命周期均可用后接入。

G-04a/G-05a 使用独立合成 message/revision fixtures 验证可行性，不等待 P3 的
真实文案版本和保存流程；完整端到端证据分别在 G-04b/G-05b 取得，不能互相冒充。
G-04a 同时验证拟新增的严格 versioned JSON envelope 经过普通最终答复 text
传递的可行性，不假定已有 artifact 通道或额外 SDK 结构化能力；T-08 再覆盖
host 验证、bridge、UI 冻结版本和无效输出的完整集成。reserved final 禁用工具
时仍走该协议；中断或格式失败只保留回答并允许手动选择/编辑正文，不重发 LLM。
stream/invoke 的 provider 完成原因须传至解码器；合法 JSON 但 length、
content_filter 或缺少完成证据不能自动冻结，不能把 EOF 当成明确完成。

P0 内互不依赖的只读核对、离线 fixture 和平台小实验可以并行；生产修改按文件
归属分配，公共 `chat-view.ts` 与 persistence 由各自唯一负责人整合，避免多方互改。

## Risks And Rollback

| Risk | Prevention / detection | Rollback / fallback |
| --- | --- | --- |
| 原图被系统转码、动画被截帧或 HEIC/SVG 能力不完整 | P0 先做原字节/方向/帧/外部资源探针；失败分类独立于模型错误 | 保留已经取得的数据但诚实标注；引导取得原文件；需要新解码库或媒体缩限时提交证据和选项，不静默降级 |
| iCloud/Sync/Git 自动排除不可用或已有上传 | 每种方式分别验证；默认复用已确认的非阻塞通知和指南 | 通知可能同步后继续导入，不使用未经证明的 `.nosync`，不自动清除远程副本或 Git 跟踪 |
| 大图峰值内存、配额或 provider 上限 | 串行解码、预算预检、LRU、临时 lease；参数由 P0 校准 | 保留原图及文字，提示调整；不静默丢图、无限压缩或改发原图 |
| 原图已写但 asset 尚未登记时中断 | 先持久化 pending import 的 asset ID、目标路径与源 hash，再写原图；重启按记录核对 | 恢复登记或明确保留待处理项；不凭同名覆盖，不自动删除无法证明归属的文件 |
| B-128 文本假设丢图或误算预算 | 在 master 接点做 bound-model 请求级回归；文本与图片独立计量 | 停用新图输入，保留纯文本历史和原始文件；不退回会发送错误图片的旧路径 |
| 纯图或异步导入草稿被既有入口覆盖 | 统一草稿占用谓词覆盖文字、附件和处理中项；Pagelet handoff 在准备及实际接入前双检；异步结果绑定草稿 identity | 保留当前与待恢复草稿；不给新会话或新草稿错接旧导入结果 |
| 部分保存产生重复或覆盖 | 不变的保存计划、已写文件 hash、短 receipt、单操作串行化 | 核对后继续同一操作；失败保留已完成部分；不删除用户文件以伪装事务回滚 |
| 相对附件目录忽略尚不存在的新笔记 | P0 证实宿主只认可实际 TFile；按用户批准先写正文，再解析并登记每个附件路径 | 未完成笔记可查看；最终补齐用当前内容校验，用户编辑后停止，不覆盖 |
| 风格污染、无法取消或撤销后仍使用 | 图片聊天启用前保护提取和双准入；typed payload 的静态治理资格独立于场景匹配；最终 currentness | 不匹配场景仍可管理合法样例；停止相关样例使用并清理治理副本；保留笔记和图片；不能改用 legacy preference 绕过 |
| 存储升级或回退丢历史 | 原 DB scope 不变、加法迁移、升级中断/旧 reader 探针 | 升级失败恢复文本可用并报告持久化问题；回退关闭图片功能，不删库、不迁移原图、不承诺旧版理解新字段 |

## Validation Strategy

### Focused checks

已有入口：`__tests__/chat-history-store.test.ts`、`chat-history-manager.test.ts`、
`conversation-persistence.test.ts`、`pa-agent-runtime-chat-history.test.ts`、
`pa-agent-context.test.ts`、`memory-use-projection.test.ts`、
`legacy-type-a-adoption.test.ts`、`operations-intent-controller.test.ts`、
`operations-service.test.ts`。P0 整合后以实际文件和测试分组为准。

Proposed tests 只覆盖新增行为：图片字节/引用/缓存及每个导入登记/写入边界的
中断恢复；纯图和异步导入期间的 Pagelet handoff/next-draft 防覆盖；真实模型
请求与最终答复 envelope；固定版本与部分保存；未保存聊天的防污染及风格样例
静态治理资格/动态使用/撤销。T-08 必须覆盖普通最终答复、reserved final、分片
中断、无效/额外 envelope 字段及手动选择正文，确认不会重发 LLM 或误冻版本。
完成证据另测合法 JSON+length、content_filter 和 unknown，两条适配路径均覆盖。
各 slice 运行最接近的 source suite，再执行
  `npx tsc -noEmit -skipLibCheck`、`git diff --check` 和 AGENTS 的 Community
源代码扫描。新用例必须观察输出、磁盘或 provider 请求，不能只断言 helper 被调用。

HEIC 系统转换接入需验证：最终产物在无 Node/Electron 的移动环境正常加载、
纯文本路径不加载桌面转换器；固定命令/参数、坏输出、进程取消与迟到结果、
临时文件清理、原图/草稿保留及不支持平台的 JPEG 恢复提示。当前 `audit:bundle`
已允许并报告 Node 引用，无需改全局审计开关；平台隔离不能由外部化打包代替。
HEIC 保存另测 note-purpose 导出与原件独立 hash、JPEG 可读及原件关联持久化、
无重复正式 HEIC、缺原件设备的诚实状态，以及导出缓存失效后的固定输出恢复。

### Runtime and device evidence

- P0 使用最小 fixture 验证入口和兼容性，不先跑全套 build/device 矩阵。
- P1/P2 分别验证导入存储和真实 Chat 请求；P3/P4 验证固定版本保存和 Memory
  隔离；重复路径在 artifact 与输入未变化时复用证据。
- 涉及实际 app 的阶段按仓库 smoke skill 执行 `make deploy`；只有相同源码的
  lint/build/Jest 已过且有当前生产包时，才使用 `make deploy-current`。
- iOS 行为必须在真实设备观察：选图/文件入口、EXIF 方向、小字、多图、取消、
  同设备重开及目标笔记附件。iCloud 测试 vault 部署需对应授权；桌面模拟不代替。
- 实际视觉理解仅使用无敏感信息的测试图和当前配置的模型，覆盖一个成功模型
  与离线不支持/限额失败即可；额外付费调用按会话已有授权处理。
- P5 对共享 runtime 的最终状态运行 lint、production build 和
  `npm run test:all -- --runInBand`，以及 `npm run docs:check`、
  `git diff --check`。已由同一输入的 enclosing gate 完成时复用，不机械重复。

P0 按实际原型和宿主探针运行 focused checks；不以基线整合为理由重复完整
Build/设备矩阵。Community 远端扫描、beta/stable、提交/推送属于单独交付授权。

## Approval

- Plan authority: 用户已确认 DEC-030 的产品边界，并于 2026-09-06 要求继续补齐技术设计及分阶段开发/验证计划。
- Approved on: 2026-09-06 用户在规划确认后回复“开始”；产品选择日期见 DEC-030。
- Authorized implementation scope: 用户于 2026-09-06 在 P0 完成后明确要求按方案及 SDD 完成 B-129 全部特性开发，现覆盖首版 P1–P5 实施、验证、review 与修复；延期媒体能力仍不在首版范围。
- Stop point: 首版全部 REQ/AC 达到 Validated。若实测要求实质偏离产品边界，先记录证据、选项、影响及回退，再由用户裁决；提交/推送/发布及归档不在本轮授权内。

后续用户明确授权实施时，兼容现有产品边界的细化与设计状态更新沿用该授权，
不重复申请；只有实质偏离或新增 Git/release 操作需要相应决定。
