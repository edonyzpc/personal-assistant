# B-128 Context Management Validation Evidence

Document status: Archived
Updated: 2026-09-05
Work item: B-128
Authority: 构建绑定的历史验证证据，不提供当前交付状态或发布授权。
Current contract: [Context Management](../../product/specs/pa-context-management-product-spec.md)
Raw evidence: [Synthetic model records](./b-128-context-management-validation.json)
Reproduction source: [Context continuity runner](../../../scripts/context-continuity-smoke-runner.js)

## Scope

记录均来自 Obsidian test vault 的隔离 ChatService，Qwen 配置的 `deepseek-v4-flash`。
输入为合成历史和工具文本，未使用真实用户笔记、Memory、写入/发布工具或会话持久化。
JSON 保留场景、问题、预期、源 SHA、实际摘要/回答和计时；移除私有 endpoint 与无关应用状态。
原历史夹具由 runner 重建，增量历史使用各自前一轮的实际回答追加。

## Historical Comparisons

| JSON record | Evidence | Meaning |
| --- | --- | --- |
| `semanticBeforeLatency` | 09:19:59–09:22:49 UTC，9 场景 | 延迟优化前语义摘要与实际回答的通过基线，只对应当时构建 |
| `rejectedEncodedSummaryCandidate` | 13:34:14–13:34:56 UTC，3 个代表性失败 | 请求编码可逆，但额外生成的有损摘要仍丢失完成状态、未知归因和首轮决定；不能凭编码正确判摘要通过 |
| `losslessLatency` | 13:50:21–13:50:49 UTC，9 场景 | 8 历史完整无损投影、1 工具真实摘要；关键语义通过，历史平均总耗时 20.600→3.129s、摘要调用合计 58→0 |
| `rejectedSemanticBudgetProbe` | 14:36:21–14:36:51 UTC，6 场景 | 完成/未知/首次增量摘要为空；后附 callbacks 未跨真实 ChatOpenAI 绑定继承，主回答输入漏采集 |
| `targetedSemantic.segments` | 15:07:27–15:07:59 和 15:09:13–15:09:28 UTC，共原 9 场景 | 相同构建/runner，6000 历史预算；源、摘要、实际入模与续答独立复核通过，28→48→68 连续更新 |
| `formatAtDefaultBudget` | 当前通过语义构建，默认 60000 历史预算，3 场景 | 关键语义和零摘要调用保留，无编码细节外露；completed/unknown 仍附说明与围栏，严格 JSON 格式不通过 |
| `rejectedStrictFormatCandidate` / `rejectedStrictFormatDefault` | 后续更强格式提示候选的代表性失败 | early 答案遗漏 UTF-8，格式也未稳定；已撤回，保留为失败证据 |

`losslessLatency` 的构建 SHA 为
`1ced23eef69c6e9a1a582a84c45ac7c0ac85c5b1b0950c8dc5da5866774f687e`。
原摘要基线构建 SHA 为
`7f1a48fc25d2896ece95d2d5f1765f9a736839f07dedb3673174dc528862cdaf`。
上述旧 runner 的主模型计数没有覆盖 LangChain 内部 `transform` 路径；
延迟表只使用逐场景时间、实际摘要调用和投影诊断，不将顶层模型计数解释为请求总数。

## Limits

历史数据重复度较高，单次计时不是 p50/p95，不能推广至所有模型或任意长会话。
摘要是有损模型输出，JSON 合法与来源下标有效不能替代语义对照。
旧无损路径通过不能验收当前版本的语义摘要回退；定向语义证据须单独记录其真实入模路径。
工具场景是 `prepareTool` 加直接回答；完整工具 Loop 接线、取消和来源失效另由集成测试覆盖。

## Targeted Semantic Reproduction

在当前插件构建部署并重载到 test vault 后，加载 runner，然后运行：

```javascript
await __b128ContextEval.start({
  arms: ["candidate"],
  historyBudgetChars: 6000,
  requireSemanticHistory: true,
});
```

预算仅下调当前 isolated service 的每轮历史分配，不改设置、源夹具或压缩算法。
必须先确认每个历史场景的 `pathEvidence.status` 为 `observed_requires_semantic_review`，
再逐源核对摘要与回答。路径证据同时检查真实模型输入中的 `conversation_summary` 和最终投影诊断；
`path_not_observed`、全空/非法摘要、摘要生成但未入模都不能算通过。
新 runner 使用正式模型 callback 覆盖 LangChain `prompt.pipe(...).stream` 的内部 `transform` 调用，
并通过公开 `bindTools` 给其返回的新实例补上 observer；实际 ChatOpenAI 会克隆实例，
不能用仅返回 Core RunnableBinding 的替身证明回调传播。
安装版本真实 ChatOpenAI 配合离线 JSON/SSE 传输的 9 项回归覆盖原回调、重复绑定、stream 和 invoke 回退。

`targetedSemantic` 的已验收构建为
`2c51d5bf210b259d872e205537463e2fb184fd96072e9c58251d386071154b48`，
runner 为 `b8057870230959293619654931b120f4f64248cb9946b359fdc6d57bc46348f6`。
源 JSON 采用缩进，排版占用计入 16k 请求上限；模型需读取所有片段，局部“没有新增”不擦除其他事实。
固定历史及首次增量每项 2 次摘要调用，后两次更新每项 1 次；工具 1 次。
早期三约束、最新决定、完成/待办、未知归因、撤权与工具失败证据均保留。
源和实际入模 SHA 经独立重建核对；这组不同预算的计时不与旧无损路径混算。

全量自动化为 218 suites / 5677 tests；最终类型修复后 tsc、tooling 和 build 通过。
恢复上述精确构建并部署后 SHA 一致；测试服务已清理，原 55 会话和活动会话不变，
Chat 非 streaming、无捕获错误、debug/mobile off。
遗留限制为模型格式遵循和少量跨字段摘要冗余，不宣称所有模型、所有会话均无漂移。
