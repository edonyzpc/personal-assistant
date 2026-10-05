# B-158 Agent Command 契约验证

Document status: Archived
Delivery status: Closed
Work item: B-158
Closed date: 2026-10-05
Authority: Owner 于 2026-10-05 明确要求 closeout 实际已完成开发任务、清理 active；本报告保留已完成工程范围与延期边界，不作为当前实现或执行状态 authority。

当前职责由 [DEC-049](../../product/decisions/dec-049-command-agent-host-tool-contract.md)、[Product Spec](../../product/specs/pa-agent-command-contract-product-spec.md)与[唯一架构契约](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)维护。本包完成架构→流程→公共框架→Ghost/Writing/Image 迁移；2026-10-04 Owner 将 F-24 恢复提示问题延期至 B-159 后，批准工程范围已完成所需独立 review、集中 gate 与代表性模型/app 验收。

## Requirement Evidence

| Requirement / AC | 已完成范围与持久承接 |
| --- | --- |
| B-158/REQ-01 / B-158/AC-01 | command 是领域契约/指引，Agent 理解规划，Host 处理真实上下文/明确权限/资源/事实，tool/domain owner 持 operation 与业务阶段；定义只在架构契约 |
| B-158/REQ-02 / B-158/AC-02 | 语义/否定/目标/计划归 Agent，程序默认不冒充用户选择；来源、真实选项、回执与结构化准入归 owner；[command](../../../__tests__/pa-agent-command.test.ts)、[host policy](../../../__tests__/pa-agent-host-policy.test.ts) |
| B-158/REQ-03 / B-158/AC-03 | run/attempt/operation 分离，确定未执行可修正，已受理复用，partial/unknown 核实且防重放；[batch preflight](../../../__tests__/pa-agent-batch-preflight.test.ts)、[Loop](../../../__tests__/pa-agent-loop.test.ts)、[image service](../../../__tests__/image-generation-service.test.ts) |
| B-158/REQ-04 / B-158/AC-04 | 方案/SDD/派工/review 引同一职责，确定性、真实模型与 app 证据分开；[GPT/GLM workflow](../../development/workflows/gpt6-glm-delivery-workflow.md)、[Refactor workflow](../../development/workflows/refactor-workflow.md) |
| B-158/REQ-05 / B-158/AC-05 | 复用 Loop/registry/policy/来源/回执；独立协议指导与完整用户原文、首次 unknown 事实和实际 bound schema 一致；集中 source/test review 与 P2 broad/app gate |
| B-158/REQ-06 / B-158/AC-06 | 公共退出后逐领域迁移，必要阶段/来源/预算/确认与历史兼容；[Writing runtime](../../../__tests__/writing-context-runtime.test.ts)、[Chat](../../../__tests__/chat-view.test.ts)、[Ghost 设计](../../development/ghost-blog-publishing-design.md)、[Image 架构](../../architecture/chat-image-generation-architecture.md) |

## Final Engineering And App Evidence

- 公共 P2 使用配置的 `pa-glm` / ZAI Responses / glm-5.3，由独立 GPT 审实际 diff/原始结果验收；P3 worker 触发五小时额度，停止原 writer 后 GPT 仅接管既定范围，不改路由或重复模型试跑。原日志位置 `/private/tmp/pa-b158-framework-rKNwzO/`。
- P2 最后中央 `make deploy` 自然 exit 0，364 suites / 8894 tests；真实 test Chat 原文、作用域、后续与恢复通过。P3 Ghost 闭合观察、Writing 来源/预算/parent、Image 原槽 unknown/Retry/剩余计划由非作者独立审查，最终 focused 470 tests 与增量接线通过。
- 最终原 B-158 `make deploy` 自然 exit 0：lint、production build、完整 364 suites / 8900 tests 与 test copy 全通过，未 forceExit；日志 `p3-final-owner-facts-deploy.log`。此前 fixture/EPERM、INT130 与部分失败 gate 保留，未把未部署候选记为完整通过。
- Writing 真实 A2 选择→Agent B/context/artifact/lineage/persisted 版本 24 项 PASS，零 Save；Ghost 否定目标、移动目标各一次正确定位后 prepare，不称 prepare 错误恢复；Image 公开 512×256 夹具两 edit/total2、实际 Edit、Regenerate count1/new task 完成。Ghost/Wan 效果边界受控合成，无真实远端服务、付费生成、provider wire/VQA 证明。
- 原生资源恢复：native fetch/model/domain 方法恢复，owned active/timers 为 0，globals 清空；原 main leaf/conversation、Notes、空草稿及 Debug/mobile/Memory off 恢复。4 篇公开 Ghost 夹具核内容后进 Obsidian 可恢复垃圾箱；公开 Image 6 个任务/产物与测试会话留作证据。worker dependency symlink 清除，managed worktree 可恢复归档。恢复记录 `p3-app-final-restored.txt`。
- 最后原 docs/diff gate 自然 0：274 Markdown / 3226 本地链接，4 项既有 advisory；既有 docs contracts 2 suites / 58 tests 按未变输入复用。DOM scan 无匹配，exit 1 为 PASS。只部署 repo test，不外推私人 anthelion、iOS 硬件、CI、release 或生产结果。

## F-24: Deferred, Not Fixed

**原模型首次回复 FAIL；Host 防重放 PASS。** 四次实际 physical dispatch 均有 persistent/noResend System，unknown header 含有限 recovery 与真实槽 ID，首次仍建议条件重发。实际 Retry 无明确重发建议，不能冲销首次 FAIL，也不能归因丢失 guidance。

同 `stableMessageId` `chat-1-3-1791077238899` / 同 operationId，Retry 改描述后仍 domainSubmit1、transport0、tasks[]；未发生实际重复提交。原证据 `image-f24-owner-final-before-retry.txt`、`image-f24-owner-final-after-retry.txt`、`image-f24-owner-final-after-retry-dispatch.txt`；使用当时 qwen/deepseek-v4-pro/DashScope 配置，服务端型号未知。合成 put 不证明真实远端受理。

Owner 于 2026-10-04 明确将该问题延期至 [B-159](../../backlog.md#已延期的产品与工程工作)。重新启动须用户明确选择 B-159；交互按“先刷新/查询原操作状态，确认确实失败后再重新提交”，unknown、缺任务 ID 或暂未看到结果不能视为确定失败。关闭 B-158 工程包不关闭 B-159，也不恢复其 runtime/model 验证。

## Later Work And Evidence Limits

Owner 后续授权的 harness 简化、历史读回、完整 Skill、容量恢复及评分校正已本地完成，证据和工程边界见[后续收尾](../../architecture/pa-agent-harness/pa-agent-harness-optimization-plan-2026-10-04.md#15-owner-校正与本地收尾)。全量与定向补验组合不冒称最后整套全量 PASS：该后续首次 373 suites 为 362 PASS / 11 FAIL，8860 tests PASS / 67 FAIL；按新行为修订后采用受影响定向补验。5 项摘要规划补验的原日志归档不足，`final-recovery-checks` 中 2 个 FAIL 不替代为 PASS。

后续 R1/E-M3 与 R3 的合理澄清按 Owner 校准撤销过严评分；R4 核心状态功能通过；R2 原解释依据不足/建议矛盾及零实际重提保留。最终未新增 critic/Host 语义门或重采样到通过，不证明普遍语义正确。

2026-10-05 最初仅撤销 Host 关键词读取与 Operations 任意容量规则，原 B-158 Snapshot 当时“源码尚未移除”属于真实阶段事实；随后 [B-161 契约对齐验证](./b161-contract-alignment-validation.md)承接新行为实现与本地验收，不改写 B-158 原验收日期或计数。B-161/F-15 定向 unknown 回复重放不等于重启/通过 B-158/F-24 的旧模型专项；B-159 Deferred 及首次模型 FAIL 保持。整体移除 Host 尚无批准实现，不由本 closeout 决定。

历史本地 Git 保存包括 `a7d1bddd` 的框架/领域迁移与后续 `18a5ec1d` 工程变化，Git/发布证据独立于上述本地验收。本次 closeout 仅处置文档；用户未跟踪 `DESIGN.md` / `design-samples/` 保留。
