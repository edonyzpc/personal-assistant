# B-135 Unified Agent Task Execution Validation

Document status: Archived
Delivery status: Closed
Updated: 2026-09-12
Work item: B-135
Authority: B-135最终实现、验证与closeout的历史证据；不承担当前产品行为、开发状态或发布授权。
Current contracts: [DEC-034](../../product/decisions/dec-034-unified-agent-task-execution.md) / [Product Spec](../../product/specs/pa-unified-task-execution-product-spec.md) / [PA Agent Architecture](../../architecture/pa-agent-architecture-plan.md) / [Multimodal Chat Architecture](../../architecture/multimodal-chat-architecture.md) / [Settings](../../architecture/settings-status.md)
Selected raw evidence: [SHA-256 manifest](./b135-unified-task-execution-evidence/manifest.sha256)

## Final Outcome

B-135在closeout前以22/22项任务、17/17项AC和零未处置P0–P2 finding完成适用验收。
稳定行为已吸收到DEC-034、B-135 Product Spec、Settings、PA Agent与Multimodal Chat
当前契约及回归测试。没有未完成项转入Backlog；F-20/F-23作为已接受的模型质量限制
保留，不代表协议传输失败或需要运行时双协议。

完整Active Package、SDD、Tracker、Discovery Brief和42份原始过程回执可从Git提交
`6e23c2a49260c1d86e8e6f142678645e400c77ba`恢复。closeout仅保留本报告与28份能证明
真实provider、Desktop、兼容迁移、恢复和移动呈现的最终回执；逐轮探针、重复截图、
中间失败转录和大体积原始模型帧由Git历史保留。

## Original Incident

用户询问“我好久好久没有写博客了，你有什么文章话题的建议吗？”时，旧本地关键词
分类因“写博客”把普通建议固定成写作任务，并要求最终文本JSON协议。原run在多轮取材
与准备后接近硬期限，provider正文已经部分到达但JSON没有闭合；旧Chat把可读内容替换
成恢复提示，且缺少足够靠前的provider完成、transport和结构诊断来区分原因。

该事故说明任务语义、取材准入、作品表达、provider完成事实和Chat恢复必须分层处理；
它本身不证明native协议、具体provider质量或默认学习策略。B-135据此采用同一主Agent
语义选择、宿主物理发送准入、专用作品输出和独立完成诊断，并保留legacy reader。

## Delivered Behavior

- 同一主Agent理解咨询、取材、创作、续写和Operations提议；不再由关键词分类或独立
  分类模型强制任务路径。Operations仍受原vault opt-in、四个核心工具、逐次确认、
  stale检查、Undo和审计约束。
- “只用当前笔记”限制任务事实来源，同时保留有效Personal、既有Memory、已授权风格
  和获准历史。宿主在每个物理provider发送前重验来源、排除、撤销、用途和权限，覆盖
  retry、summary、query rewrite、rerank、旧工具结果及派生摘要。
- 生产Chat默认通过宿主专用`present_writing`通道交付作品。普通回答仍为文本；一次
  响应至多一个作品，完整身份、provider完成、结构、来源和生成快照均有效才成版，
  不增加完成确认模型轮。旧JSON/recovery reader继续可读。
- 单一绝对期限覆盖准备、取材、思考和交付。已开始的正文可在原hard deadline内继续，
  取消和late tool仍失败关闭；provider完成、transport结束、结构校验和宿主中断分开记录。
- 长期记忆提取与本地习惯学习分别默认开启并可独立关闭、暂停和管理。无明确用户关闭
  证据的旧`false`迁移为开启，明确关闭或有效暂停保留；不伪造consent/confirmedAt，
  迁移本身不触发历史回填、整库重建或额外模型调用。
- 关闭新提取只停止新学习；已有有效Personal仍受Memory主开关、来源、治理、排除、
  Forget和预算后可继续使用。生成、局部编辑、保存和一次性要求不会自动成为长期风格。
- 新来源凭据使用明确格式版本。旧2.9.2对新治理库安全拒绝读取、确认和恢复但保留数据，
  普通保存和legacy Profile仍可用；重新升级后恢复新库使用。来源记录不足的旧作品仅在
  用户明确点击后恢复为AI草稿，已确认撤销或失效的来源继续拒绝。

## Validation Evidence

| Scope | Final evidence and result |
| --- | --- |
| Source and complete gate | `npm run lint`、production build、`npm run test:all -- --runInBand`均自然退出；276 suites / 7621 tests通过。Community source scan无匹配，`git diff --check`通过。最终构建SHA-256：`main.js`=`54cd8cd97b77dc38885557f965339e9594a56429bfd40610abc97a37c0cb8b37`，manifest=`f12e21b0cceb42e7392d21589564725372e95348288774bff8e64e6a704fec5d`，styles=`c530221f6769b7613088d858489302e2020146b3f0d9f539459258b4a295decd`。 |
| 默认学习与退出 | [实际scheduler/collector矩阵](./b135-unified-task-execution-evidence/2026-09-12-default-learning-host-matrix.json)及[Desktop关闭/Forget](./b135-unified-task-execution-evidence/2026-09-12-p2-desktop-exit-and-forget.json)：缺失值、未知旧false、明确关闭、暂停、11/10/01/00、load/save/reload、零启动回填、关闭后零新增及Personal/style解耦通过。 |
| 语义、来源与Operations | [主Agent与Operations](./b135-unified-task-execution-evidence/2026-09-12-p3-semantic-and-operations.json)、[跨轮只取第二张图](./b135-unified-task-execution-evidence/2026-09-12-p3-cross-turn-second-image.json)及[待确认卡片](./b135-unified-task-execution-evidence/2026-09-12-p3-operations-pending-card.png)：咨询不成版，明确保存只产生pending create，取消零写入；后续更正覆盖旧选择且不复活排除图片。 |
| Native作品、续写与保存 | [当前Qwen默认native](./b135-unified-task-execution-evidence/2026-09-12-p4-default-native-desktop.json)、[自然语言续写](./b135-unified-task-execution-evidence/2026-09-12-t16-natural-continuation.json)及[保存预览](./b135-unified-task-execution-evidence/2026-09-12-p4-default-native-save-preview.png)：唯一作品、动态handle、父子版身份、17次增量preview、正文/hash、版本与显式保存精确，无额外ack或动作。 |
| 中断与恢复 | [Qwen native中断/恢复](./b135-unified-task-execution-evidence/2026-09-12-qwen-native-interrupt-recovery.json)、[legacy完成/中断](./b135-unified-task-execution-evidence/2026-09-12-legacy-desktop-completion-interruption.json)及[恢复窗口](./b135-unified-task-execution-evidence/2026-09-12-recovery-app.json)：部分正文可读，重载不冒充完成，人工恢复保留AI归属，已知失效来源零版本。 |
| 降级与重新升级 | [当前→旧2.9.2→当前矩阵](./b135-unified-task-execution-evidence/2026-09-12-d11-real-downgrade-matrix.json)：新治理库完整保留，旧版安全拒绝不支持操作，普通保存与legacy画像可用，升级后来源Queue重新可确认和投影。 |
| Provider质量与成本 | [质量/成本审计](./b135-unified-task-execution-evidence/2026-09-12-t20-quality-cost-audit.json)及[逐字对照](./b135-unified-task-execution-evidence/2026-09-12-verbatim-comparison.json)：Qwen与DeepSeek均完成native/legacy对照；provider正文到artifact逐字一致。F-20为新旧协议共有的行标签/引号遵循问题；F-23为DeepSeek native单样例弯引号转直引号。两项按D14/D15保留为模型质量限制，不增加fallback、双协议或provider特判。 |
| 适用平台 | [平台风险复核](./b135-unified-task-execution-evidence/2026-09-12-platform-evidence-reassessment.json)及[390×844恢复窗口](./b135-unified-task-execution-evidence/2026-09-12-mobile-simulator-recovery.png)：共享Linux/Desktop证据与mobile simulator覆盖B-135改动；设置可达、恢复模态完整、真实IndexedDB正反例通过。B-135未改macOS/iOS系统集成、iCloud/文件提供器、Keychain、HEIC、真实触控/软键盘、WKWebView专属生命周期或平台分支，因此无B-135专属真机门；其它功能拥有的真机门继续保留。 |

## Evidence Boundaries

- 真实provider样例证明当时Qwen/DeepSeek配置和输入下的协议能力与有限质量观察，不能
  推导所有模型、提示或网络条件均相同，也不从单次耗时推断固定性能提升。
- Desktop/App和mobile simulator证明共享宿主行为及受影响移动呈现；没有声称完成
  Keychain、iCloud、HEIC、真实触控/软键盘或WKWebView真机验证。
- 旧版矩阵证明指定2.9.2降级/升级路径，不承诺任意更老版本或未知第三方修改都兼容。
- closeout不等于master集成、Beta、BRAT安装、设备smoke或stable发布；这些由各自
  Git与release证据单独证明。

## Closeout Disposition

- 保留：DEC-034、B-135 Product Spec、当前Architecture、回归测试、本报告和精选原始回执。
- 删除：B-135 Feature Home、Tracker、Plan、SDD、Discovery Brief以及未入选的过程证据；
  Git提交`6e23c2a49260c1d86e8e6f142678645e400c77ba`保留完整恢复点。
- 索引：从Backlog、Discovery Registry和Active Registry移除B-135；没有未完成工作需要
  新增Backlog项目。
- 旧任务：B-106/B-118/B-128/B-129及Operations的既有过程包不重开；它们的当前契约
  仅链接本次稳定结果或历史验证。
