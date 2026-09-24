# B-146 PA Agent Task Source Boundary — Validation

Document status: Archived
Updated: 2026-09-24
Work item: B-146
Authority: 已完成交付的证据与限制；当前行为以 [DEC-042](../../product/decisions/dec-042-agent-task-source-boundary.md)、[Product Spec](../../product/specs/pa-agent-task-source-boundary-product-spec.md) 和[架构](../../architecture/pa-agent-architecture-plan.md#task-source-and-writing-output)为准。

## Delivered Scope

- 主 Agent 直接选择普通笔记读取、Memory/Vault 检索和已开启的 WebSearch；普通取材不调用 `declare_source_scope` 或 `request_source_decision`。用户自由语言来源要求由 Agent 遵循，不再成为 Host 关键词或模型自报的硬门。
- Host 继续按真实目标、Data Boundary、能力开关、取消及来源有效性准入。混合无效读取批次零新增读取；普通 Chat 已读来源在最终交付前被排除或撤销时，不交付派生正文。当前笔记的链接别名不再冒充目标笔记身份。
- `@Writing` 与明确继续已有版本才绑定作品上下文。运行轮次保存显式操作与所选父版本供重载后由用户主动继续；空文本操作也算草稿，防止 Pagelet/外部预填串入普通新会话。
- Agent 可用可选结构化纯输出报告无法完成，Chat 显示并持久化说明且终态为 `incomplete`；来源拒绝本身不替 Agent 判断任务终态。运行中关闭 WebSearch 后，已加载能力在物理请求前复查开关。
- 旧来源声明与来源决定的可执行协议已移除；旧历史仅只读解释或取消，不自动重放。

## Original Closeout Verification And Limits

The following evidence belongs to the original B-146 closeout. The later review fixes and their separate validation are recorded below; the original `8133` tests are not evidence for those fixes.

| Evidence | Result and scope |
| --- | --- |
| 最终源码门 | 2026-09-24 closeout 冻结输入上重跑 `make deploy`：平台 guard、lint、生产 build、323/323 套件、8133/8133 测试正常退出，并核对构建身份部署到 `test/`；Community DOM 本地扫描无匹配，diff check 通过。8133 测试数是删除旧协议专属测试后的最终输入，不与此前 8214 直接比较覆盖质量。 |
| 文档门 | closeout 后 `npm run docs:check` 检查 230 Markdown / 2044 local links，通过；`npm run test:docs -- --runInBand` 为 58/58。既有架构建议项不属于 B-146 错误。 |
| 当前方案源码回归 | 来源真实身份、Data Boundary 排除、混合批次、发送前撤销、WebSearch 实时开关、旧调用拒绝、普通 Chat 与 Writing 交付、running→reload→resume、空操作草稿及显式未完成标记均有定向测试。源码测试证明对应构造，不替代每条应用操作实测。 |
| Obsidian test vault | Obsidian 1.14.2 / 插件 2.9.2；DeepSeek `deepseek-v4.1-flash` 的中文引号 AGI/coding 普通咨询完成并实际 WebSearch，未调用 Writing 工具或产生作品。Qwen `qwen3.8-max` 的组合限定任务仅读指定两篇测试笔记，未读排除的第三篇、未搜索网页。DeepSeek 的排除来源负例无正文进入模型；显式未完成说明在 Chat 可见并持久化。`@Writing` 操作可选择、移除且可生成作品。两模型同用百炼服务入口，只证明模型差异，不证明服务故障隔离。 |
| 本次应用加载 | 2026-09-24 部署后对 `test/` 执行插件 reload；Obsidian 1.14.2 中插件 2.9.2 已启用，打开 Chat 后视图、容器与输入框均各有 1 个节点，开发错误缓冲无错误。这是加载与挂载检查，不是下述中途操作的 UI 验收。 |
| 应用证据边界 | 最终部署未在应用中逐项重演“最终请求中途排除来源”“Writing 运行中重载后继续”“运行中关闭 WebSearch”；对应保护由上述源码回归验证。未做真 iOS/Android 设备验证。新会话按钮的 CLI 合成点击受本机 Obsidian 沙盒 EROFS/GPU 噪声干扰，未作为可见交互通过；普通提问在既有 Chat 中实测。Chat `completed` 不代表答案事实质量通过。 |

## Findings And Follow-up

- 原 review 的两条 P1（普通回答最终来源撤销、链接别名来源）与两条 P2（Writing 重载继续、空操作跨会话）已修复并有源码回归；旧可执行来源协议已移除。后续审查发现 WebSearch 物理发送前仍有一道屏障时序缺口，追补结果见下节。应用中途操作的剩余验证范围如上，不伪称真机或全路径实测。
- Data Boundary 产品规格中的“排除来源本次例外”尚无 Chat UI/运行时接线，维持排除硬门；后续独立见 [B-147](../../backlog.md)。
- 排除来源后模型曾错误建议“提供路径或重新打开笔记”，虽然 Host 明确返回 `source_excluded` 且未泄露正文。模型漏用结构化未完成标记也仍可能把无法完成的任务标为 `completed`；两者是 Agent 遵循/报告风险，不反推 Host 来源准入失效。
- 普通 AGI/coding 回答引用二手网页后的事实核查 **FAIL**：将 [SWE-RPG](https://arxiv.org/abs/2608.09072) 的 31.5% 受测组合平均值外推给未受测的 Mythos/Astra；把 [ARC-AGI-3](https://arcprize.org/blog/astra) 的非编码任务及不同 harness 分数用于 coding 结论；遗漏 [Mythos 5.1](https://www.anthropic.com/claude/mythos)、[Astra 直接编码评测](https://openai.com/index/gpt-6-astra/)和 [DeepSWE 独立审计](https://epoch.ai/benchmarks/deepswe/review)。这不改变 B-146 的运行时来源保护验收；泛化的 Agent 自主事实核实另见 [B-148](../../backlog.md)。

本记录是本地验收与 closeout 证据，不是 CI、远程合入、beta 发布或设备安装证明。原 Feature Home、Plan、SDD 与逐轮 Tracker 在稳定结论吸收后按文档流程删除。

## Post-Closeout Review Fixes (2026-09-24)

本轮对已合入的 B-146 继续修复四处执行接缝，不改变 DEC-042 的产品边界；以下记录本地验证，远程 master 的交付以实际 Git ref 为准。

| Review risk | Fix and direct evidence |
| --- | --- |
| 运行中关闭 WebSearch 后，等待旧请求屏障仍会外发查询 | 在 `obsidianFetch.onProviderRequestStart` 中、物理发送前复查实时开关。真实 `ProviderRequestScope` 屏障回归确认禁用后请求数为零；见 `builtin-web-search-provider.test.ts`。 |
| 普通 Chat 来源撤销后，兼容 answer 输出仍交付正文 | `message_end` 不再独立生成普通答复快照；仅 Loop 通过来源有效性检查后提交的正文进入兼容输出。有效与已撤销来源对照见 `pa-agent-stream-bridge.test.ts`。 |
| Writing 无合法未完成报告出口 | 显式 Writing 也可独立调用纯输出 `report_task_incomplete`；说明进入 Chat，终态为 `incomplete`，不建立作品或恢复稿。见 `writing-context-runtime.test.ts`。 |
| 未完成报告参数错误即空白结束 | 严格拒绝非法或混合批次，其他工具零执行；在既有轮次和时间预算内反馈格式错误供 Agent 修正。见 `pa-agent-loop.test.ts`。 |

验证：定向 8 套件、329 测试通过；原 B-129 的保留收尾断言调整为仅允许未完成纯输出后，该套件 94/94 通过。当前输入上 `npm run test:all -- --runInBand` 为 **323/323 套件、8138/8138 测试，退出码 0**；lint 与生产 build 通过，测试断言调整后另跑 `npx tsc -noEmit -skipLibCheck` 通过。`npm run docs:check` 为 230 Markdown、2045 local links 通过，4 条既有 advisory；文档测试 58/58；Community DOM 本地扫描无匹配，diff check 通过。构建身份核对后使用 `make deploy-current` 部署到 `test/`；Obsidian 1.14.2 重载插件 2.9.2 并打开 Chat，视图、容器、输入框均各 1 个节点，fresh error buffer 为空。Jest 在退出码 0 后显示通用的异步句柄退出延迟提示，未作为额外 PASS 或 FAIL。

本轮应用证据仅证明部署、重载与 Chat 挂载；四条时序和结果语义由源码回归验证，未在真实 provider 的运行中逐项重演。未进行真机验证。
