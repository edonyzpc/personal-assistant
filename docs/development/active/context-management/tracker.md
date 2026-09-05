# Context Management Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-09-05
Work item: B-128
Authority: 本 track 的唯一执行状态、finding、验证和跨会话 handoff。
Product spec: [Context Management](../../../product/specs/pa-context-management-product-spec.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: 当前实现已完成本地验证，按 core、Chat 回执、文档组织本地提交；整体 B-128 尚未 master 集成或 closeout。F-20 严格回答格式和 F-23 摘要冗余保留为非阻塞 P3，未宣称全部修复。
- Next action: 进入 master 集成的独立授权步骤；当前本地 master 已另有 `384c2470`（IME 发送修复），集成时需一并处理并验证，不能把本轮分支验证当作集成后验证。正式 closeout 按集成结果处理。多模型和真实用户样本矩阵仍不扩大，后续仅按真实失败推进。
- Blocker / decision needed: 无。Owner 已明确纠正 LLM 排除不是决策，应按需求技术选型、成本后优化；先前 Agent 自行设置的成本批准门已撤回。
- Last verified behavior: 分支基于本地 master（c51c481e）。全量 218 suites / 5677 tests 通过；最终源码 lint/build/type-check、相关 focused、独立 review 和实际部署通过。当前构建以 6000 字符历史预算完成原 9 项语义场景，8 项历史全部确认摘要实际入模，连续覆盖 28→48→68 条消息；默认预算三项回归仍零摘要调用。早期无损路径的 58→0 调用、20.60→3.13s 为独立旧构建对照，不与本次不同预算混算。当前与失败证据已入库；未 push/合入 master/closeout。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-128/REQ-01 / B-128/AC-01; B-128/REQ-02 / B-128/AC-02 | 工具 cycle 和 fit-first history | [x] | reducer/history tests；canonical 不变；有界 call/source/error/original-size marker |
| T-02 | B-128/REQ-03 / B-128/AC-03; B-128/REQ-04 / B-128/AC-04 | 最终 request guard 与 local overflow | [x] | template/schema measurement、early guard、最终 Memory 变化和 fallback 集成测试；app overflow |
| T-03 | B-128/REQ-05 / B-128/AC-05; B-128/REQ-06 / B-128/AC-06 | 单一 reduction 回执和持久化 | [x] | live/save/reload/old-data 白名单测试；app zero-source receipt 保存重载 |
| T-04 | B-128/REQ-07 / B-128/AC-07; B-128/REQ-08 / B-128/AC-08 | 长会话连续性与权限/Memory 边界 | [x] | 当前模型 5 类历史场景、3 次增量及工具证据对照；原始 Chat 与 Memory 所有权不变 |
| T-05 | B-128/REQ-01 / B-128/AC-01; B-128/REQ-08 / B-128/AC-08 | 本轮集成验证、独立 review 和 Obsidian smoke | [x] | focused → make deploy（types/lint/build/full tests）→ source scan → app smoke；后续 runtime 变更重新验证 |
| T-06 | B-128/REQ-09 / B-128/AC-09; B-128/REQ-10 / B-128/AC-10 | 语义摘要、纯覆盖计划、工具发现承接 | [x] | 源前缀/工具快照精确校验、完整 JSON 投影、真实摘要与回答对照 |
| T-07 | B-128/REQ-11 / B-128/AC-11 | 会话缓存生命周期、取消、超时、非法输出回退 | [x] | ChatService ownership、删改/切换/关闭/配置改变失效；12s 迟到校验和 fallback 无污染 |
| T-08 | B-128/REQ-12 / B-128/AC-12 | 新状态集成验证、独立 review 和真实模型矩阵 | [x] | 217 suites / 5648 tests；最终提示 focused + build/lint；Obsidian test-vault 9 项语义场景，见下表 |
| T-09 | B-128/REQ-09 / B-128/AC-09; B-128/REQ-11 / B-128/AC-11; B-128/REQ-12 / B-128/AC-12 | 摘要延迟优化，保留当前验证范围 | [x] | 完整原文→完整可逆表示→语义/规则 fallback；共享 fit、真实预算、源回还及零摘要调用测试；当前模型原 9 场景语义通过，见 Latency Evidence |
| T-10 | B-128/REQ-12 / B-128/AC-12 | 当前版本语义路径定向验收与本地提交收口 | [x] | 同模型/原 9 场景的源、摘要、实际入模和续答通过独立核对；三组本地提交，真实 Git 记录为准；P3 格式未完全解决，不代表 master 集成或发布 |

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | 真实单 user transcript 无法软压缩旧工具结果 | model cycle grouping | T-01 | Closed |
| F-02 | P1 | 总预算不准入，格式化开销遗漏 | final request guard | T-02 | Closed |
| F-03 | P2 | 固定十轮摘要且先丢近期原文 | fit-first / recent-first | T-01 | Closed |
| F-04 | P2 | Context 回执缺失实际 reduction | 三布尔 OR 聚合 | T-03 | Closed |
| F-05 | P2 | 占位文本错误声称 metadata 可恢复 | truthful bounded marker | T-01 | Closed |
| F-06 | P2 | 初稿超限提示可能误称整轮未发送，实际此前 stream 已发送 | 改为中性“上下文过长，无法继续” EN/ZH 文案 | earlierInvocation + early overflow Chat 测试、app screenshot | Closed |
| F-07 | P2 | 合法空首批摘要导致后续历史未被读取 | 空中间态继续，最终全空回退；既有有效摘要防擦除 | summarizer 跨批 SQLite 要求回归 | Closed |
| F-08 | P1 | Memory revalidation 原地更新被比较的 live source，旧摘要 payload 可通过校验发送 | 独立 payload 源快照；发前 registry 使用第二份 clone | 修复前 invoke=1、修复后 invoke=0 的真实 ChatService 回归 | Closed |
| F-09 | P2 | 可选摘要 preflight 等待可能越过摘要期限并迟到污染共享 retry input | 移除冗余 Loop preflight；单源 registry 校验服从摘要 signal/generation | 12s 非协作等待、正式 fresh Memory、迟到结果及 fallback、timer=0 | Closed |
| F-10 | P2 | 真实模型在约 48k 摘要请求中忽略重复背景中部的要求，返回空结构 | 完整摘要请求改为 16k 分批；明确状态类别、源角色优先级及具体信息提取 | 同一 fixture 复测，5 类历史均保留关键语义；原始失败记录保留 | Closed |
| F-11 | P2 | 答案正确但滚动摘要仍把已替代代号并列为有效约束 | 摘要明确为当前工作状态；用户后续修正替换旧值，必要历史必须标明失效 | 3 次真实摘要和回答均为最新代号；离线约束持续保留，覆盖 14→34→54 条源消息 | Closed |
| F-12 | P2 | 延迟优化首轮：局部提取将历史明确选择和修正返回为合法空摘要，续答丢失当前决定 | 撤回并行提取/合并及段落呈现实验；最终完整历史优先路径保留全部源 | first 至 fourth 失败记录保留；最终原场景当前决定正确 | Closed — experiment withdrawn |
| F-13 | P2 | 实验合并后 facts 保留未标失效的旧选择，冗余与助手应答又进入 completed | 撤回合并路径；最终三次增量均完整投影，不生成可能漂移的中间摘要 | 原实验摘要保留；琥珀→银杏→海棠与离线约束均正确 | Closed — experiment withdrawn |
| F-14 | P2 | 1639 字符短提示将单批增至两轮后，完成/待办、未知假设及工具证据均返回全空 | 撤回短提示及增加单批材料量的候选 | `/private/tmp/pa-b128-latency-fifth-eval.json`，12:57:39–12:58:56 UTC；该候选提速不计验收 | Closed — experiment withdrawn |
| F-15 | P2 | 仅紧凑 JSON 的候选累积无状态背景，失败/未开始进入 completed，第 7 批触发 30s 期限 | 仅压缩格式不足以解决；最终完整历史能 fit 时不摘要，仍需摘要时保留状态分类和去冗余规则 | `/private/tmp/pa-b128-latency-sixth-eval.json`，13:02:47–13:05:19 UTC；最终完成场景三类正确、无摘要等待；不宣称所有 fallback 稳定 | Closed — sampled path resolved |
| F-16 | P2 | 去重提示候选将历史选择和工具证据误读为全空 | 历史优先完整可逆表示；工具用同一编码承接完整源，保留材料清单与空摘要规则 | `/private/tmp/pa-b128-latency-seventh-eval.json`，13:06:55–13:08:59 UTC；最终历史选择正确，工具摘要与回答均保留 C-731/0/13 | Closed — sampled path resolved |
| F-17 | P2 | 问答关键值正确，但撤权摘要未保留“过去许可已撤销” | 最终不摘要该历史，原撤权依据完整保留；当前仍不允许写入/发布，需新授权 | `/private/tmp/pa-b128-latency-eighth-eval.json` 保留为部分通过记录；最终完整源投影与答案通过，不能从答案倒推摘要完整 | Closed — sampled path resolved |
| F-18 | P2 | 仅调整撤权说明后，原完成场景再次返回全空 | 不以提示调整声称稳定；使用完整可逆历史路径，逐字符回还加实际回答验证 | `/private/tmp/pa-b128-latency-ninth-b-eval.json` 保留；最终完成状态通过，仍超限的 fallback 质量不作新增结论 | Closed — sampled path resolved |
| F-19 | P2 | 可逆编码已将摘要调用降至 1 次，但额外有损摘要仍丢失完成/未知/首轮增量 | 完整原文或完整可逆表示 fit 时直接发送，优先于旧摘要；两者仍超限才语义摘要 | `/private/tmp/pa-b128-latency-tenth-eval.json`，13:34:14–13:34:56 UTC 保留为失败；最终原 8 历史场景零摘要调用、无遗漏、回答正确 | Closed — sampled path resolved |
| F-20 | P3 | 回答附加解释/代码围栏，曾暴露 `count=1` | 主提示要求遵循请求格式且隐藏内部表示；当前样本不再泄漏编码，6000 预算九项均可直接解析 JSON，但默认预算 completed/unknown 仍带说明与围栏 | 入库 `formatAtDefaultBudget`；部分缓解，严格格式未通过，不引入 JSON 猜测/截取器 | Deferred — partial mitigation |
| F-21 | P2 | 当前 6000 字符历史预算下，摘要丢失完成/未知/首次增量状态，旧无损路径通过不足以验收语义 fallback | 源 JSON 保留结构化排版，明确无新增信息只描述所在段落；完整源和 16k 实际请求上限不变 | 首次失败入库 `rejectedSemanticBudgetProbe`；当前九项语义和三次更新通过，见下节 | Closed |
| F-22 | P2 | smoke runner 后附 callbacks 在真实 ChatOpenAI 工具绑定创建新实例后丢失，不能证明主回答收到摘要 | 包装公开 bindTools 并沿用 observer；真实安装的 ChatOpenAI 和离线传输覆盖绑定、重复绑定及 stream/invoke | 原 SyntheticChatModel 结论撤回；9 项 tooling tests、实际入模块及源 SHA 核对通过 | Closed |
| F-23 | P3 | early/tool 摘要存在 goals/constraints 或 open_questions/facts 的同义重复，首次增量将离线约束与代号放同一条 | 不矛盾、未遗漏、预算内；不将模型分类和去重提示当作强制 schema 保证，后续按实际容量影响处理 | `targetedSemantic` 保留原始摘要，不声称最小化或完美分类 | Deferred |
| F-24 | P2 | 进一步强调输出简短/格式的候选将 early 答案缩为 csv，遗漏 UTF-8，且仍未稳定消除围栏 | 撤回该候选，恢复已通过语义核对的精确构建 2c51d5bf；不以格式换取关键细节丢失 | `rejectedStrictFormatCandidate` 保留；恢复后 dist 与 test-vault SHA 一致，当前证据为原通过构建 | Closed — experiment withdrawn |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-05 | B-128/REQ-08 / B-128/AC-08 | 设计前 source inspection | Complete | Memory 是独立输入，Context 无持久化 Memory 写入调用；尚未执行当前实现测试 |
| 2026-09-05 | B-128/REQ-01 / B-128/AC-01; B-128/REQ-08 / B-128/AC-08 | focused suites、make deploy、source scan | PASS | 215 suites / 5596 tests；lint、build/type-check、platform guard、diff check 通过；社区源码扫描无匹配。Jest 短暂 open-handle 提示后正常退出，make deploy exit 0 |
| 2026-09-05 | B-128/REQ-03 / B-128/AC-03; B-128/REQ-06 / B-128/AC-06 | 独立 review | PASS after fix | reducer/Manager lane、receipt/lifecycle lane、final guard/retry lane；F-06 已修复，无遗留 P1/P2 |
| 2026-09-05 | B-128/REQ-05 / B-128/AC-05; B-128/REQ-06 / B-128/AC-06 | Obsidian 1.14.0 / test / full-ui | PASS | 16 轮合成对话（约 144k raw chars），Qwen 配置的 deepseek-v4-flash 回答最新约定“周四”。真实点击展开状态为 `Context was limited to fit this request`，source/Memory count 均 0，保存和 reload 后 reduction 为 true/false/true；证据 `/private/tmp/pa-b128-context-receipt.png` |
| 2026-09-05 | B-128/REQ-04 / B-128/AC-04 | Obsidian local overflow | PASS | 一次性测试夹具将 UI 简短 prompt 替换为 120000 chars，真实 Runtime 抛出 early overflow；模型创建次数 0；中性错误说明可见、composer 可用。证据 `/private/tmp/pa-b128-context-overflow.png`；fixture 即时恢复 |
| 2026-09-05 | B-128/REQ-07 / B-128/AC-07 | 连续性边界 | PARTIAL | 超过十轮且 fit 时保留早期/修正/决定；预算不足时早期 SQLite 要求可全部丢失。app 仅证明近期决定延续，未证明任意长会话的语义质量 |
| 2026-09-05 | B-128/REQ-08 / B-128/AC-08 | 清理与文档 | PASS | 合成 Chat 删除、原 test 会话恢复、debug/mobile off；无 fresh app error。docs:check 通过，4 个既有 episodic docs advisory 保留；Memory/VSS/提取行为未改 |
| 2026-09-05 | B-128/REQ-09 / B-128/AC-09; B-128/REQ-11 / B-128/AC-11 | 语义实现自动化与独立 review | PASS after fixes | 全量 217 suites / 5648 tests；lint/build/type-check、source scan、diff-check。F-07..F-09 修复前后回归、30 项 summarizer tests；最后提示调整后重新 lint/build/type-check、focused 和当前构建部署。Jest open-handle 提示后正常 exit 0 |
| 2026-09-05 | B-128/REQ-12 / B-128/AC-12 | 最终构建真实模型语义评测 | PASS within sampled scope | Obsidian 1.14.0 test vault，Qwen 配置的 deepseek-v4-flash，2026-09-05 09:19:59–09:22:49 UTC。9 个候选场景逐项核对源、摘要及回答；相同 fixture 的原文/裁剪基线单独保留，见下表 |
| 2026-09-05 | B-128/REQ-08 / B-128/AC-08 | 真实评测隔离与清理 | PASS | 仅 isolated ChatService/host；禁用测试服务的 Memory、skills、policy、web、actions 与持久化，无真实笔记输入。全部服务 dispose、eval handle 删除；test 会话数仍 55，active ID 不变，Chat 非 streaming。没有为本次语义评测创建或删除 Chat |
| 2026-09-05 | B-128/REQ-09 / B-128/AC-09; B-128/REQ-11 / B-128/AC-11 | 延迟实现、自动化与独立 review | PASS | 当前 `make deploy` exit 0；217 suites / 5660 tests、lint/build/type-check/platform guard/source scan；Jest open-handle 提示后正常退出。无损 roundtrip、真实 wrapper 预算、预算缩小、旧摘要优先级、raw tail、取消/cache 及真实 Runtime 零摘要调用均有测试；独立 review 无可行动 P1/P2 |
| 2026-09-05 | B-128/REQ-12 / B-128/AC-12 | 原 9 场景延迟对照 | PASS within sampled path | 13:50:21–13:50:49 UTC，同一配置模型与原 fixture；8 历史用完整无损投影，1 工具用真实摘要；见 Latency Evidence。未新增模型、真实用户数据或其他场景 |
| 2026-09-05 | B-128/REQ-08 / B-128/AC-08 | 最终隔离与清理 | PASS | eval 服务清理、handle 删除；55 个原会话及 active ID 不变，非 streaming；dev:errors 无错误，debug off、mobile off |
| 2026-09-05 | B-128/REQ-12 / B-128/AC-12 | 定向语义修复与验证 | PASS within sampled scope | 当前构建 2c51d5bf、runner b8057870；原九项分两段执行，8 历史均实际 semantic_history，工具摘要实际用于直接回答；逐源/摘要/答案独立复核；无扩大模型或真实数据 |
| 2026-09-05 | B-128/REQ-11 / B-128/AC-11; B-128/REQ-12 / B-128/AC-12 | 当前自动化与独立检查 | PASS | 全量 218 suites / 5677 tests；最终 build/type-check/lint，55 项 summarizer/projection、12 项 request/history、9 项真实 ChatOpenAI tooling；源码扫描无匹配。构建曾发现测试类型错误，已修复并重跑 tsc/tooling；不将失败命令计通过 |
| 2026-09-05 | B-128/REQ-08 / B-128/AC-08 | 定向验证清理与状态保全 | PASS | 隔离服务 dispose、handle 删除；原 55 会话、原 active ID、sidellm-view 非 streaming；dev:errors 无错误，debug off、mobile off；无 Memory/真实笔记/持久会话变化 |

## Current Targeted Semantic Evidence

当前构建 SHA-256：`2c51d5bf210b259d872e205537463e2fb184fd96072e9c58251d386071154b48`；
runner：`b8057870230959293619654931b120f4f64248cb9946b359fdc6d57bc46348f6`。
部署的 main.js 与 dist 完全一致。入库记录见
[验证证据](../../../archive/2026/b-128-context-management-validation.md) 与其中的原始 JSON。

同一构建分两段运行：15:07:27–15:07:59 UTC 为完成/未知/撤权/三次增量，
15:09:13–15:09:28 UTC 为早期约束/最新修正/工具证据。历史预算下调为 6000，
五个固定场景及首次增量各 2 次摘要调用，后两次增量各 1 次；工具 1 次。
当前历史共 14 次摘要调用和 8 次主回答，工具另 1 次摘要和 1 次直接回答。
这不是与默认 60000 预算无损路径的同条件性能对照。

独立复核重建固定夹具和真实 prior-answer 追加链，核对源 SHA、摘要前缀、实际发送块、
sourceMessages 与答案。早期完全离线/UTF-8 CSV/7、银杏/17、完成与待办、未知归因、
明确撤权及 C-731/0/13 均保留；琥珀→银杏→海棠连续更新覆盖 28→48→68 条消息，
旧决定不再并列有效。结构校验和模型调用计数本身不提供语义 PASS。

P3 格式和摘要冗余见 F-20/F-23。后续输出格式候选因遗漏 UTF-8 被撤回，
当前精确构建的通过证据没有被该失败候选替换。验收仅限当前模型和现有合成样本。

## Real Model Continuity Evidence

评测脚本：[context-continuity-smoke-runner.js](../../../../scripts/context-continuity-smoke-runner.js)。
延迟优化前已通过的生产构建 SHA-256：`7f1a48fc25d2896ece95d2d5f1765f9a736839f07dedb3673174dc528862cdaf`；
runner SHA-256：`a9df124f8dd9a1c3253454cca9ca8d7443d7c80300f0ebe0119ab464d771f1ed`。
延迟优化前候选完整记录为 `/private/tmp/pa-b128-semantic-final-eval.json`；原文/裁剪基线为
`/private/tmp/pa-b128-semantic-batch16-eval.json`。早期空摘要与旧有效状态失败分别保留在
`/private/tmp/pa-b128-semantic-initial-eval.json` 和 `/private/tmp/pa-b128-semantic-state-review.json`。

| 场景 | 原文对照 / 规则裁剪对照 | 最终语义摘要与回答 |
| --- | --- | --- |
| 早期硬约束，约 91k chars | 原文保留三项；裁剪丢失三项 | 完全离线、UTF-8 CSV、每天最多 7 个文件均保留 |
| 后续修正，约 91k chars | 原文为银杏/17天；裁剪无法确定 | 银杏/17天，旧琥珀/30天不作为有效决定 |
| 已完成/失败未完成/未开始 | 原文分清三项；裁剪返回空项 | CSV 导出已验收；加密迁移测试失败未完成；移动端未开始 |
| 未知与助手假设 | 原文保留未知及两项假设；裁剪丢失假设来源 | 负责人/发布日期仍未知，林然/11月8日明确是未确认猜测 |
| 历史许可撤销 | 原文有撤销依据；裁剪失去历史依据，当前只读边界仍有效 | 摘要明确撤销写入/发布，当前只允许分析说明，行动需要新授权 |
| 增量 1，约 91k chars | 同一 candidate service | 琥珀 + 完全离线；摘要覆盖 14 条消息 |
| 增量 2，约 144k chars | 同一 candidate service，追加修正和容量压力 | 银杏 + 完全离线；旧代号失效；摘要覆盖 34 条消息 |
| 增量 3，约 196k chars | 同一 candidate service，继续追加修正 | 海棠 + 完全离线；旧值不再并列有效；摘要覆盖 54 条消息 |
| 工具中段证据，约 23k chars | 原文保留 C-731/0/13；固定前缀裁剪全丢失 | 真实 Summarizer 保留错误码 C-731、未迁移文件、重试上限 13 |

验收是 Agent 对照源材料逐项判读语义，未使用关键字命中自动判 PASS，也没有额外模型评委调用。
普通回答的测试 JSON 字段名不计为语义验收项：权限案例重命名了两个字段，但值与撤销说明正确；
这不等于摘要的严格 JSON schema 校验放宽。工具场景验证真实 Summarizer 和模型回答，
其固定前缀裁剪对照不是 Manager 投影；完整工具 Loop 接线、currentness 和 wrapper 由集成测试覆盖。

当前局限：仅一个已配置模型与合成样本，不能推出所有模型或任意长会话无漂移。
本组延迟优化前历史摘要准备耗时 13.2–28.2s，部分输出仍保留冗余背景；当前优化结果另见下节。
旧语义基线只代表当时构建，不能作为修改后语义 fallback 的新增质量证明。

## Latency Evidence

当前构建 SHA-256：`1ced23eef69c6e9a1a582a84c45ac7c0ac85c5b1b0950c8dc5da5866774f687e`，dist 与 test-vault 部署一致；
runner SHA-256：`106ebc6559157898e56104718915debbb6c3fdc61d4c6ab54876b8032aeaf55a`。
Obsidian 1.14.0 / test，Qwen 配置的 `deepseek-v4-flash`，2026-09-05 13:50:21–13:50:49 UTC。
完整记录 `/private/tmp/pa-b128-latency-final-eval.json`；逐源/耗时比较
`/private/tmp/pa-b128-latency-comparison.json`。对照脚本验证同一 case、question、expected、源 SHA/字符数；
三次增量按实际前一轮回答独立重建，本次全部输入 SHA 亦相同。报告未记录私有 endpoint，不能据此独立证明 endpoint 一致。

| 场景 | 优化前总耗时 → 当前总耗时 | 摘要调用数 | 实际结果 |
| --- | --- | --- | --- |
| 早期硬约束 | 17.999 → 3.177s | 7 → 0 | 完全离线、UTF-8 CSV、每天 7 个文件 |
| 后续修正 | 16.934 → 2.867s | 7 → 0 | 银杏、17 天 |
| 已完成/失败未完成/未开始 | 31.809 → 4.285s | 7 → 0 | CSV 导出完成；加密迁移测试失败未完成；移动端未开始 |
| 未知与助手假设 | 20.994 → 4.079s | 7 → 0 | 负责人/日期未知，林然/11月8日明确是助手未确认猜测 |
| 历史许可撤销 | 17.810 → 3.473s | 7 → 0 | 原撤权源完整；答案禁止当前写入/发布，行动需新授权 |
| 增量 1 | 16.827 → 2.122s | 7 → 0 | 琥珀、完全离线 |
| 增量 2 | 20.445 → 2.395s | 8 → 0 | 银杏、完全离线 |
| 增量 3 | 21.979 → 2.631s | 8 → 0 | 海棠、完全离线 |
| 工具中段证据 | 5.638 → 2.875s | 3 → 1 | 摘要与答案均保留失败 C-731、未迁移文件、重试 13 |

8 个历史场景平均总耗时 **20.599625→3.128625s（本次降低 84.8%）**，历史摘要调用合计 **58→0**。
历史准备 metric 从平均 17.4745s 降至 1.5ms；后者是跳过模型的本地准备检查，不是摘要模型加速。
全部历史投影 `historyCompressed=true`、`budgetLimited=false`，省略/摘录/语义摘要字符数均为 0，
`semanticSummaryUsed=false`；完整请求约 14.0–24.0k chars。实际 Runtime 请求 roundtrip 测试验证源 role/content 不变。
工具仍调用一次摘要模型（1711ms，完整请求 6955+512 chars 余量，低于 16k），不是完整工具 Loop app smoke。

本轮逐源核对经独立 review 复核通过，验收为完整无损历史路径的源保留与续答语义，以及工具摘要语义；没有把空 `summaries` 或
`historyReady=false` 当失败，也没有把它们伪称为摘要成功。普通回答附加 Markdown/说明不计为结构化输出验证；
completed 回答提及编码实现细节（F-20），工具摘要仍有少量跨字段重复，未以进一步提示调优扩大本轮工作。
报告顶层 `modelCalls` 只计被评测 hook 截获的调用，不是全局模型调用总数；这里比较的是逐场景实际摘要调用记录。
收益适用于这些重复较多的合成输入，单次计时不代表 p50/p95 或所有真实长会话。
完整无损表示仍超限时继续语义/规则降级；其生命周期/预算有自动化覆盖，但本轮未重新证明该历史语义路径的模型质量。
更广模型、非重复长历史和真实使用样本按 Owner 要求延后。

## Closeout Readiness

- [x] Owning contract 与实际行为一致。
- [x] Review、连续性评测和 app smoke 已记录。
- [x] 后续优化与验证范围限制有明确 disposition。
- [x] 稳定结论吸收到 current architecture/tests。
- [ ] 过程 artifacts 在获批 closeout 后 delete-after-absorption。
