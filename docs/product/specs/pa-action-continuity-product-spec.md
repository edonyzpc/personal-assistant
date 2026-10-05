# PA 执行事实连续性 Product Spec

Document status: Approved
Updated: 2026-10-03
Work item: B-157
Decision: [DEC-048](../decisions/dec-048-action-facts-and-context-continuity.md)
Authority: Owner 于 2026-10-02 明确要求按照 B-157 方案及开发计划完成全部任务；恢复既有 Context/Agent 契约，不扩大权限。

本规格已吸收 B-157 Discovery 的产品范围，补充 [Context 契约](./pa-context-management-product-spec.md) 与 [Agent 契约](./pa-agent-runtime-evolution-product-spec.md)。实现设计由 [Context architecture](../../architecture/pa-agent-architecture-plan.md#action-state-continuity-and-summary-ownership) 维护，实际验收见 [最终证据](../../archive/2026/b157-context-action-continuity-validation.md)，不由批准状态推定交付。

## Requirements

- B-157/REQ-01：已获准历史动作与真实结果关联；accepted、ready、saved、pending、partial、unknown 区分，旧要求不因回执遗漏变成待办。
- B-157/REQ-02：来源依赖 unknown、混合不可拆分、篡改、撤销和过期仍拒绝；最小安全状态必须由领域 owner 证明且单独重新准入，不借空 sources 洗白。
- B-157/REQ-03：确认、取消、后台完成、部分失败、核实及 Undo 的最新合法阶段进入下一请求；重开以可信回执恢复，读取不重放。
- B-157/REQ-04：压缩不以工具 success 认定领域完成；关键编号、必要证据及未决身份保留或有合法摘要承接；必要信息放不下则明确 overflow。
- B-157/REQ-05：当前轮、历史、native/compat、摘要和降级共享获准事实；无双份观察，当前 user 恰好一次；仅最小安全状态持久化。
- B-157/REQ-06：用实际请求与模型行为证明解释不重做、明确新任务正常、未知先核实；真实 test-vault 交互与模型状态一致。

## Acceptance Criteria

- B-157/AC-01：下一实际 provider 请求含合法 accepted/ready/saved/pending/partial/unknown 与动作身份；accepted 不冒充完成。
- B-157/AC-02：排除资料、路径、参数、错误回显及授权不经状态或摘要恢复；来源合法的领域 unknown 保留。实际 dispatch 重验。
- B-157/AC-03：领域事件→现有 conversation 存储→下一请求正确，保存重开不重放；部分 Undo 按 action/receipt，落盘失败不恢复可确认 pending。
- B-157/AC-04：预算前后保住必要编号与阶段；三次摘要更新不复活旧目标、不填补未知；超限不静默发送不完整上下文。
- B-157/AC-05：serializer/请求/存储/native/compat/fallback 使用同一获准表示；Host-only 原对象、凭据、raw canonical 和 Undo before/after 不落盘/出境。
- B-157/AC-06：四域×三类续问×两臂的真实模型对照、三次摘要 episode、desktop 与适用 mobile simulator、清理及独立审查完成。

### Owner 验收澄清（2026-10-03）

历史动作的解释或讨论后，仅以文字询问是否继续／重做，且没有实际执行相应动作，归为后续体验优化，不阻塞 B-157。Owner 后续明确将原 Writing 裁定扩展至 Image、Writing、Ghost、Operations 四域；不能把这种提示记为明确新任务未交付。实际调用、历史事实判断与当前请求交付须分别判定，旧严格 NoOffer verdict 保留为历史记录，当前分类以最新裁定为准。

实际重放旧动作、把未知结果确定说成已成功或未发生、错报有证据的核心执行状态、未完成当前明确新任务，以及成品违反用户明确要求，仍按既有契约验收；普通讨论或澄清不要求作品交付。Owner 允许验证优化并要求按实际影响判断，避免过严验证和实现。无据过程细节与核心结果错报分别记录，不能仅以过程词句或内部字段形式判为执行失败；“当前没有读到效果”支持当前观察，不支持确定否定历史 unknown。作品与解释可由既有分离呈现载体交付，不要求解释必须位于特定内部字段。

Owner 随后进一步明确：验证以产品功能和初衷是否满足为尺度，信任现有 Agent Harness 与模型能力，避免过度设计和验证。人工判读须结合完整回复、实际执行轨迹及当前请求；不能仅凭“未生效”等词句认定历史状态被反转。待确认提案没有执行、当前文件没有预期追加效果时，这一当前效果描述可接受；历史是否曾执行的表达精度另列优化。已有证据证明不自动重做、明确新任务正常交付、合法历史与当前状态能承接后，不为消除每个样本的措辞歧义新增强制自检轮、Host 文本判断或重复矩阵。实际重复执行、错误持久化、遗漏已证状态或当前明确任务未交付仍按产品结果处理。

## Boundaries

无新 ledger/Agent SDK/Host 自然语言 classifier，无长期 Memory 或持久化摘要，无真实付费图片或 Ghost 发布，无私人 vault 部署、自动未知动作恢复、跨设备同步或 Git/release。

原 C01–C28 与后续任务已完成并吸收，历史失败、Owner 校准验收及剩余体验优化的触发条件见 [B-157 最终验证](../../archive/2026/b157-context-action-continuity-validation.md) 和 Backlog；不保留待执行的重复计划。
