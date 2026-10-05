# B-157 Context 执行事实连续性验证

Document status: Archived
Delivery status: Closed
Work item: B-157
Closed date: 2026-10-05
Authority: Owner 于 2026-10-05 明确要求 closeout 实际已完成开发任务、清理 active；本报告保留历史验收证据，不作为当前实现或执行状态 authority。

当前范围与产品尺度见 [DEC-048](../../product/decisions/dec-048-action-facts-and-context-continuity.md)、[Product Spec](../../product/specs/pa-action-continuity-product-spec.md)；当前职责见 [PA Agent 架构](../../architecture/pa-agent-architecture-plan.md)。本包在 2026-10-03 已完成批准范围及所需本地验证，2026-10-05 进行文档收尾，不新增模型、构建或 app 实验。

## Delivered Scope And Evidence

四域 owner 的最小合法阶段与身份经来源重新准入、原 conversation/turn 持久化及下一请求承接。正文与有限状态分别准入；accepted 不等于完成，unknown 不等于未发生。历史与当前轮、代码协议与外部资料分开；仅最小状态落盘，Host-only 回执、raw canonical、Undo 正文和摘要不落盘。来源撤销、篡改、取消、删除不复活及未知副作用防重放保持。

| Requirement / AC | 最终承接与回归入口 |
| --- | --- |
| B-157/REQ-01 / B-157/AC-01 | 调用/结果关联与 owner 阶段：[action history](../../../__tests__/pa-agent-action-history.test.ts)、[domain state](../../../__tests__/domain-action-state.test.ts) |
| B-157/REQ-02 / B-157/AC-02 | 资料/状态各自准入、真实派发再验：[task source](../../../__tests__/task-source-run.test.ts)、[runtime history](../../../__tests__/pa-agent-runtime-chat-history.test.ts) |
| B-157/REQ-03 / B-157/AC-03 | 原 turn 原子条件更新、重开、晚到事件与跨实例权限：[persistence](../../../__tests__/conversation-persistence.test.ts)、[store](../../../__tests__/chat-history-store.test.ts)、[manager](../../../__tests__/chat-history-manager.test.ts) |
| B-157/REQ-04 / B-157/AC-04 | 必要原文/状态保留，合法来源摘要承接、预算不足 overflow：[summarizer](../../../__tests__/pa-agent-context-summarizer.test.ts)、[summary projection](../../../__tests__/pa-agent-context-summary-projection.test.ts) |
| B-157/REQ-05 / B-157/AC-05 | native/compat/降级共享表示、当前 user 一次、SDK 最终装配：[runtime history](../../../__tests__/pa-agent-runtime-chat-history.test.ts)、[ChatService](../../../__tests__/chat-service.test.ts) |
| B-157/REQ-06 / B-157/AC-06 | 四域实际模型矩阵、三次摘要 episode、原生状态链及适用 mobile simulator；按下列 Owner 校准验收，测试与模型/app 证据不互代 |

### 最后生产修复与测试优化

- F-39/T13–15：完整配对、成功且 Host 分类 read-only 的普通正文可经合法来源摘要释放；未决/副作用事实、最新完整轮与必要证据保留。Operations 共享 service 只读查询真实 owner，非 owner 不误写 lost，真实原回执沿最新 revision 纠正 legacy lost；confirm/Undo 仍属于原 session。有限失败原因与真实恢复范围允许异因恢复，同因抖参及 unknown/partial 重放仍受限。
- 最终生产修复 gate：lint、production build/type-check、完整 `test:all -- --runInBand` 自然 exit 0，363 suites / 8901 tests，204.095 秒。首次 358 PASS / 5 FAIL、8845/8892 tests 的失败与被结束进程保留；闭合失败原因/评测 source 接线等修正后重新冻结，未把初次失败记为 PASS。Ghost 本地监听 EPERM 属环境限制，不访问真实发布服务。
- `make deploy-current` 将该构建部署 repo test。Obsidian 1.14.4 中两个真实 ChatView 共享实际 Operations service 与 IndexedDB，18 项检查 PASS：pending 不误 lost、running 可见、原 session 确认/Undo、legacy lost r1→completed r3、唯一 append 与 undone 持久化。属于实际 app 中运行的 probe，不是人工点击或新模型语义验收。4 个 owned app 资源清除，原 3 leaf/Host、active/debug/mobile 恢复，fresh errors 无错误。
- F-40/T16 仅优化八份测试，净减 8 case。最后完整 coverage 自然 exit 0：363 suites / 8893 tests，无 failed/pending/todo；480 源路径与四项原始覆盖计数不变：statements/lines 180760/198097、functions 9217/10810、branches 49810/60204。可比位置无覆盖下降，两处 V8 包围范围映射变化独立核实；原 pendingSourceSelections 正文未覆盖，不宣称已覆盖。未据单次耗时宣称提速，也未称全仓深审。
- F-39 原始记录：`/tmp/pa-b157-review-fix.WjLu1F/`，含首次失败/最终全门、`resources.json`、`native-smoke-report.json`、`app-restored.log`。F-40 原始快照、coverage、位置比较与冻结记录：`/tmp/pa-b157-test-optimization-20261003/`。这些是当次原始证据位置，不保证临时目录永久可用。

## Historical Model Evidence And Acceptance

初始故障是旧已受理图片请求在错误解释追问中再次生成不同 taskId。源码链确认：
空 sources 的真实 owner 回执被当作 unknown lineage 过滤，跨轮又丢失 assistant 执行事实，
旧 user 要求仍在；成功工具结果被 closed 占位、摘要缺 canonical actions、Operations
确认后的下一轮旧状态是关联缺口。缺失事实构成重放诱因的归因属于推断，不宣称仅此
一处决定所有模型行为。现行修复保留独立 owner 状态与严格来源，原故障私有正文未归档。

真实评测使用当时配置的 qwen/deepseek-v4-pro；报告记录累计 944 次 physical HTTP，后续 F-38–40 未增加模型对话。次数不构成成功率或某项提示的因果证据。受控 Ghost/Wan adapter 不证明真实远端受理、付费图片或 Ghost 发布。

- F-25/26 的有限 context 归属/语义索引候选未达严格标准，未直接晋升生产。F-29 原四域矩阵与 native wire 证明当前 user/消息职责及零旧动作重提，但摘要与严格语义 FAIL 保留；原 native Writing 明确新任务仅输出普通正文、零 artifact 的交付 FAIL 不改写。
- F-31 在原 5000 测试预算下保留完整 owner 事实，分开自由摘要可引用区；真实三次非空摘要将 17→9→11 的修正正确承接，随后实际 SDK 消费组合摘要、两次无 oracle 核对保持枫树/CSV/11 与 A applied、B unknown，零重放。原 3600 预算容量 overflow、拒收摘要及不充分的短回复夹具保留，不以提高生产预算掩盖问题。
- B-157/F-24 是 Ghost needs_attention 初次真实 operation 未形成 owner seed 的事实链缺陷。匹配 Host proof 才建立保守 unknown seed，随后同原轮推进 unknown0→prepared1→completed7；真实后续解释收到 published。这项已修复，**与 B-158/F-24 的延期模型恢复提示问题是不同 finding**。
- F-33/34 补齐 Image 外部 provider 接受未知维度与既有消费指导。原 unknown 正确而补造回调原因、published 正确而猜确认点击、严格 NoOffer 失败均保留，未归为实际重放或新的权限。
- F-36 补齐当前原生产 main 的 Ghost 初次两分支；Operations 临时软指导与原 arm 共 17 HTTP，零重做，新任务独立 staged/pending。指导未整合，不称 prompt A/B 或稳定改善。原始报告在 `/tmp/pa-b157-20261003-outcome-check/`。
- F-37 按 Owner 产品尺度重读完整回答和执行轨迹：unknown 提案从未确认执行，当前文件初始化即缺行；“当前未生效”可描述当前观察，历史解释精度另列优化。历史解释零自动重做、明确新任务四域正常交付/准备、合法 owner 状态与摘要承接满足原范围；旧严格 verdict 不覆盖，不追加自检模型/Host 文本门或重复矩阵。

## Residual And Later Continuity

解释过程细节、历史效果措辞及纯文字邀请的体验精度作为已知非阻塞边界保留。只有 Owner 明确选择优化，或可复现地影响核心结果判断、动作权限、实际重放或当前明确任务交付时再启动；不将每个旧候选或单样本措辞自动变成新开发任务。

F-32 原 native 请求两次“一张”强调被旧词面计数误作两张，首轮 UI 数量 warning；当时一次 POST n1/一次 GET 成功不能掩盖该错误。后续 B-158 的 `a7d1bddd` 删除 `requestedImageCount`、`allowsSeparateImageRequests` 与词面 imageBudget，改为 Agent 结构化总计划及实际选项约束，见[当前图片架构](../../architecture/chat-image-generation-architecture.md)。原机制已退役，不把当时未实施记录变为新待办，也不宣称原 native 样本已重跑。

后续 harness 简化与容量恢复按[已有工程收尾](../../architecture/pa-agent-harness/pa-agent-harness-optimization-plan-2026-10-04.md#15-owner-校正与本地收尾)承接；2026-10-05 新合同及实现验证见 [B-161](./b161-contract-alignment-validation.md)。本报告的旧构建/计数是历史输入证据，不外推为后续版本的完整模型矩阵、真实 iPhone/Android、私人 vault 部署、CI、release 或生产证明。
