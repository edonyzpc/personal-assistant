# Project Audit

## Scope and method

- Baseline: `d7ecf477d0357c6275f387f3af9140794bdbe5e9` on `master` after a clean fast-forward pull.
- Scope: the whole repository, with implementation candidates limited to bounded changes under the configured risk constraints.
- Independent lanes:
  - Architecture and correctness: business invariants, state transitions, concurrency, ownership, and failure recovery.
  - Tests, reliability, and observability: failure paths, timeout/retry behavior, test realism, and silent failures.
  - Performance, security, and maintainability: hot paths, unbounded work, trust boundaries, sensitive data, and duplicate responsibilities.
- Primary-agent verification: each accepted item below was re-traced against current code. Runtime reproductions were used for persistence and malformed-state findings; targeted existing tests were run by the auditors without modifying the repository.
- Pure style preferences, speculative rewrites, and findings without an executable trigger were excluded.

No P0 was found. The most serious confirmed findings are narrow P1 data, privacy, and trust-boundary defects; none was caused by this optimization run.

## Confirmed and high-confidence issues

### AUD-001

ID: AUD-001  
标题: Quick Capture 跨弹窗并发写入会覆盖一条已报告成功的捕获  
状态: CONFIRMED  
类别: correctness, reliability, data safety, testability  
严重程度: P1  
文件和位置: `src/plugin.ts:486-491,2512-2537`; `src/quick-capture.ts:239-240,323-335`; `__tests__/quick-capture.test.ts:367-387`  
触发条件: 连续打开两个 Quick Capture 弹窗，并发保存到同一 Daily、Inbox 或当前笔记。  
代码证据: 每次打开弹窗都创建新的 `QuickCaptureService`，而按路径串行化的 `appendQueues` 是实例字段；两个实例可同时读取同一旧内容后依次覆盖。现有并发测试只使用单一 service。  
运行证据: 审计时相关 6 个 suite、127 个测试通过，证明现有测试没有覆盖真实跨实例触发路径；完整基线 2319 项测试同样为绿。  
影响: 两个弹窗都可显示保存成功，但最终文件缺少其中一条用户输入。  
根因: 写入协调器的生命周期小于插件功能实例的生命周期。  
置信度: 5  
业务收益: 5  
修复成本: 2  
修改风险: 2  
建议方向: 在插件生命周期内复用一个 Quick Capture service，使既有按路径队列覆盖所有弹窗。  
验证方法: 插件级断言多次创建请求返回同一 service，并保留同 service 并发追加回归测试；运行 Quick Capture 和插件测试。  
不处理的后果: 低频但不可恢复的捕获内容丢失。

### AUD-002

ID: AUD-002  
标题: Level 2 启动和第 30 次确认会静默迁移全部历史 Memory 候选  
状态: CONFIRMED  
类别: correctness, data state, product trust boundary  
严重程度: P1  
文件和位置: `src/plugin.ts:717-724,2243-2299,2397-2409`; `docs/pa-ui-ux-optimization-plan.md:1040-1048`; `docs/pa-ui-ux-optimization-tracker.md:810-818`  
触发条件: `confirmedMemoryCount >= 30` 后启动插件，或用户手动确认第 30 条 Memory，且队列中有旧的 `suggested` 候选。  
代码证据: idle 阶段和手动确认成功后都会扫描并自动确认所有历史候选；新候选创建路径已经单独执行 Level 2 自动确认。  
运行证据: 4 个相关 suite、107 项测试通过，但没有历史候选保持不变的断言。  
影响: 未逐项批准的旧建议会成为持久 Memory，并进入未来上下文。  
根因: 将“新候选创建时自动接受”错误扩展成历史积压迁移。  
置信度: 5  
业务收益: 5  
修复成本: 1  
修改风险: 2  
建议方向: 移除 idle 和等级切换 sweep，只保留新候选创建路径。  
验证方法: 启动 Level 2 和第 30 次手动确认均不改变其他历史候选；Level 2 新候选仍自动确认。  
不处理的后果: 违反明确的无迁移产品约束和“earned trust”边界。

### AUD-003

ID: AUD-003  
标题: 移动端 Debug 劫持全局 Console 并无界写入未脱敏日志  
状态: CONFIRMED  
类别: security, privacy, performance, lifecycle  
严重程度: P1  
文件和位置: `src/plugin.ts:20,399-404,3073-3075,3195-3215`; `src/obsidian-hack/obsidian-mobile-debug.ts:7-27`  
触发条件: 移动端启用 Debug 后加载插件。  
代码证据: helper 替换五个全局 Console 方法，捕获 Obsidian 与其他插件日志；数组无上限，每条日志重写完整文件；没有 disposer；内容未经过 `redactForLog`。  
运行证据: 独立 mock 复现确认补丁持续存在，`logs.txt` 包含模拟敏感原文和其他插件输出，第二次写入包含完整历史。  
影响: 跨插件日志及潜在敏感值进入 Vault 配置目录，同时造成 O(n²) I/O、内存增长和卸载后全局污染。  
根因: 旧调试辅助绕开插件已有的作用域内、脱敏 Console logger。  
置信度: 5  
业务收益: 5  
修复成本: 1  
修改风险: 2  
建议方向: 停止注册全局 monkey patch，保留现有 `this.log -> redactForLog -> console.log` 调试路径。  
验证方法: 源码不再导入/调用 helper；移动 Debug 不改写 Console；插件测试、lint、build 通过。  
不处理的后果: Debug 用户面临隐私泄漏、跨插件干扰和持续资源消耗。

### AUD-004

ID: AUD-004  
标题: 三个 PA Store 在持久化成功前提交内存状态  
状态: CONFIRMED  
类别: correctness, reliability, state consistency, retry safety  
严重程度: P1  
文件和位置: `src/pa/review-queue-store.ts:170-229`; `src/pa/memory-governance-store.ts:164-231,256-278`; `src/pa/saved-insight-store.ts:143-200`; `src/plugin.ts:1298-1305,2197-2204,2226-2233`  
触发条件: `saveData` 或注入的 persist callback 在 create/update/confirm/lifecycle 操作中失败，随后任意设置保存或用户重试。  
代码证据: 三个 Store 先替换内部数组再 `await flush()`；插件 persist adapter 也先替换 `settings` 子树再 `saveSettings()`，没有失败回滚。  
运行证据: 基线 bundle 的故障注入输出为 `reviewQueue itemsAfterFailure=1`、`memory recordsAfterFailure=1`、`insight itemsAfterFailure=1`，三次调用均已抛出 `disk`。独立审计还复现 Memory 重试得到 `mem-2, mem-1`。  
影响: 调用方看到失败但当前会话已包含幽灵状态；后续无关保存会把它写盘，Memory 重试会产生重复记录。  
根因: mutation、persist 和 settings adapter 缺少串行化的 commit-after-persist 不变量。  
置信度: 5  
业务收益: 5  
修复成本: 3  
修改风险: 3  
建议方向: Store 使用串行 mutation queue，在持久化 next snapshot 成功后再提交；plugin adapter 在保存失败时恢复旧 settings snapshot。  
验证方法: 三个 Store 注入 reject-once；失败后 snapshot 与操作前完全相同，重试只生成一个对象；插件 adapter 集成路径不泄漏失败状态。  
不处理的后果: 间歇性存储错误可造成 Memory/Review/Saved Insight 状态分叉与重复。

### AUD-005

ID: AUD-005  
标题: malformed PA ledger 设置可在插件加载时抛 TypeError  
状态: CONFIRMED  
类别: reliability, input validation, recovery  
严重程度: P2  
文件和位置: `src/settings.ts:519-522,713-740`; `src/pa/contracts/source-ref.ts:43-59`; `src/pa/contracts/review-queue.ts:133-166`; `src/pa/memory-governance-store.ts:63-114`; `src/pa/saved-insight-store.ts:78-108`  
触发条件: 同步冲突、手工编辑、旧版本或部分写入产生形状不完整的 `reviewQueue`、`memoryGovernance` 或 `savedInsights` 记录。  
代码证据: normalize 路径把 unknown cast 成业务类型后调用 `.trim()`、`.length`、`.map()` 或解引用 `ref.path`，结构校验不足。此路径由 `mergeLoadedSettings()` 在插件启动时直接调用。  
运行证据: 基线 bundle 分别对缺失 Memory `summary`、缺失 Insight `text`、Review Queue `sourceRefs:[null]` 复现 `TypeError: Cannot read properties of undefined/null`。  
影响: 一个坏记录可阻止整个插件加载，而不是仅丢弃该记录并保留其余有效状态。  
根因: 类型系统约束被误当成不可信持久化输入的运行时保证。  
置信度: 5  
业务收益: 4  
修复成本: 2  
修改风险: 2  
建议方向: 在调用字符串、数组和 clone helper 前验证完整运行时 shape；normalize 对单条坏记录 fail closed。  
验证方法: 每个 ledger 注入多种 malformed 记录；normalize 不抛、丢弃坏记录并保留有效记录。  
不处理的后果: 本地可恢复的数据损坏升级为插件级启动故障。

### AUD-006

ID: AUD-006  
标题: Quiet Recall Bubble 一次 Link 会被记录为两次接受反馈  
状态: CONFIRMED  
类别: correctness, duplicate execution, behavior learning  
严重程度: P2  
文件和位置: `src/pagelet/orchestrator.ts:1522-1544`; `src/plugin.ts:1289-1292,2126-2173`; `src/pa/retrieval-habit-profile.ts:259-289,402-465`  
触发条件: 用户从 Quiet Recall Bubble 成功链接当前笔记与候选。  
代码证据: plugin link host 成功后记录一次合成候选 `accept`，orchestrator 收到成功后又对原候选记录一次 `accept`。  
运行证据: 相关测试通过，但 mock host 无内部副作用，未覆盖生产 wiring。  
影响: 单次动作累计双倍来源/关系权重，偏置后续召回排序。  
根因: 反馈所有权同时存在于 host 与 orchestrator。  
置信度: 5  
业务收益: 3  
修复成本: 2  
修改风险: 2  
建议方向: 明确单一反馈所有者并增加生产式 wiring 测试。  
验证方法: 成功 Link 恰好产生一次 accept，失败不产生。  
不处理的后果: 行为画像逐步偏离真实用户动作。

### AUD-007

ID: AUD-007  
标题: 真实 Discovery host 将 provider 失败折叠为合法空结果  
状态: HIGH_CONFIDENCE  
类别: reliability, observability, error semantics  
严重程度: P2  
文件和位置: `src/plugin.ts:2783-2812`; `src/pagelet/orchestrator.ts:1087-1114`; `__tests__/pagelet-orchestrator.test.ts:1921-1991`  
触发条件: 存在语义相关笔记但没有显式 wikilink，模型 invoke 或解析失败。  
代码证据: orchestrator 对 rejected host 有显式错误 UI/本地链接降级；真实 adapter 却 catch 后返回 `null`，导致普通无结果面板。  
运行证据: 测试只用会 reject 的假 host，真实 adapter 未被覆盖。  
影响: 用户无法区分“没有连接”和“provider 失败”。  
根因: 不同失败语义共用 `null`。  
置信度: 5  
业务收益: 3  
修复成本: 2  
修改风险: 3  
建议方向: provider/parse 异常向 orchestrator 传播，未配置模型的合法行为单独固定。  
验证方法: 真实 adapter reject 集成测试覆盖无链接错误和显式链接降级。  
不处理的后果: 静默失败降低可诊断性并误导用户。

### AUD-008

ID: AUD-008  
标题: 删除任意 Vault 文件触发 Stats 缓存清空和全量 Markdown 重读  
状态: CONFIRMED  
类别: performance, reliability, maintainability  
严重程度: P2  
文件和位置: `src/plugin.ts:681-686`; `src/stats/stats-manager.ts:135-145,294-305,665-843`  
触发条件: StatsManager 已初始化后删除任意文件，包括非 Markdown 文件。  
代码证据: plugin 顶层 listener 无条件 `recalcTotals()`；StatsManager 已有独立增量 delete handler；recalc 清空缓存后逐个读取 Markdown。  
运行证据: 现有测试固定了 recalc 的全量语义；缺少 plugin listener 不调用 recalc 的覆盖。没有可靠大 Vault benchmark，因此不宣称百分比收益。  
影响: 大 Vault/移动端的单文件删除退化为全库 I/O。  
根因: 遗留全量监听器与增量 StatsManager 重复。  
置信度: 5  
业务收益: 3  
修复成本: 1  
修改风险: 2  
建议方向: 移除 plugin 层重复 delete/recalc listener，保留 StatsManager 增量路径。  
验证方法: 删除事件不调用 recalc，缓存删除与最终 snapshot 保持正确。  
不处理的后果: Vault 越大，删除操作后的额外 I/O 越明显。

### AUD-009

ID: AUD-009  
标题: Pagelet 前台 timeout 只停止等待，不取消 provider 工作  
状态: HYPOTHESIS  
类别: performance, reliability, resource lifecycle  
严重程度: P2  
文件和位置: `src/pagelet/orchestrator.ts:128-133,386-406,768-779`; `src/pagelet/PageletHost.ts:156-160`; `src/plugin.ts:2783-2808`  
触发条件: Discovery provider 超过 120 秒或插件在挂起任务中卸载。  
代码证据: `Promise.race` 没有 AbortSignal；guard 会释放而底层 promise 继续；destroy 清理 timer 后永久挂起 promise 可能不 settle。  
运行证据: 尚未验证当前 LangChain/provider 组合能否可靠传播 AbortSignal，因此不能安全实施。  
影响: 潜在重复费用、悬挂资源和卸载后后台工作。  
根因: timeout 作用于等待者而非实际操作。  
置信度: 4  
业务收益: 3  
修复成本: 4  
修改风险: 4  
建议方向: VERIFY_FIRST；先建立 provider signal 传播证据。  
验证方法: 假 timer + provider signal 断言 timeout/destroy 均 abort 且前台流程 settle。  
不处理的后果: 极慢 provider 场景可能持续消耗资源。

### AUD-010

ID: AUD-010  
标题: Level 2 Auto-accepted 卡片与可逆 Remove 路径在真实数据流中不可达  
状态: CONFIRMED  
类别: correctness, product trust, maintainability  
严重程度: P1  
文件和位置: `src/pagelet/orchestrator.ts:1680-1715`; `src/pagelet/tab/review-queue-routing.ts:35-52`; `src/pagelet/tab/sections/MemoryGovernanceSection.ts:188-224,366-385`; `src/plugin.ts:2416-2455`; `docs/pa-ui-ux-optimization-tracker.md:796-825`  
触发条件: Level 2 新候选被自动确认并变为 `applied`，用户打开 Memory section 后尝试查看或移除。  
代码证据: ledger query 只读取 suggested/edited/snoozed；routing 又排除 memory candidates；因此 applied 卡片不会到 UI。即使直接注入，Remove 调用 generic dismiss，而状态机禁止 `applied -> dismissed`；bundle 复现返回 `invalid_transition_applied_to_dismissed`。queue item 也没有 confirmed Memory ID，无法安全调用 `governance.forget()`。  
运行证据: 当前 UI 测试只有不显示 Auto-accepted 的负例；没有真实 applied data-flow 正例。  
影响: 产品宣称“自动接受但可随时移除”，实际没有可达的撤销路径。  
根因: 状态 linkage、orchestrator query 与 UI action 未形成闭环。  
置信度: 5  
业务收益: 5  
修复成本: 4  
修改风险: 4  
建议方向: DEFER；先设计向后兼容的 queue-to-Memory linkage，再接通 query、确认 UI、`forget()` 和 `applied -> undone`。  
验证方法: Level 2 真实数据流显示卡片；Remove 二次确认；Memory 变 tombstone，queue 变 undone；旧数据有明确降级。  
不处理的后果: 新自动 Memory 的可逆信任承诺不成立；应在后续高优先级修复。

## Repository/process risk recorded separately

- 仓库内 CI 仅在 release tag 运行 test/lint/build；没有 PR/master workflow。状态为 HIGH_CONFIDENCE、P2 流程风险，但仓库外 branch protection/CI 在禁网条件下无法核验，本轮分类为 DOCUMENT_ONLY/DEFER。
- `AGENTS.md` 的 Chat UI 路径和 Memory context 常量表已经落后于当前代码。该漂移在本轮预检中实际造成一次无效路径读取；将在最终文档复盘中按当前代码更正，不作为独立运行时任务。

## Dismissed false positives

- VSS 精确向量搜索：已有热缓存、分批扫描和 10k 级基准；没有新的回归证据。
- VSS refresh 快照竞争：当前实现会在读取、embedding、删除和写入前后复核文件身份，并保留 dirty journal；现有恢复测试覆盖该不变量。
- VSS `dispose()` 未显式等待单一表面 promise：disposed guard、shutdown barrier 和恢复覆盖不足以支持数据损坏结论。
- Pagelet detail session cache：上限 12 且卸载清理，不是无界缓存。
- Built-in Web Search：已有 HTTPS endpoint、响应大小和每轮调用上限。
- Preload 扫描：opt-in 且有文件、token、provider 预算，未发现无界执行。
- Stats/React 生命周期：当前 `onClose`、observer/listener 清理存在，未发现可执行泄漏。
- `getVSSFiles()` 的目录前缀行为：测试明确固定为 legacy contract，不在本轮更改。
- `ChatHistoryManager.removeTurnsFromIndex()` 多事务推测：当前无调用点，不具备触发链。
- 旧审计中的 Pagelet save-target/provider-output session 问题：当前已有路径碰撞处理、会话 guard 和有界缓存，本轮未复现。

## Risk summary and top candidates

| ID | Severity | Status | Candidate disposition |
| --- | --- | --- | --- |
| AUD-002 | P1 | CONFIRMED | AUTO_IMPLEMENT |
| AUD-001 | P1 | CONFIRMED | AUTO_IMPLEMENT |
| AUD-004 | P1 | CONFIRMED | AUTO_IMPLEMENT |
| AUD-005 | P2 | CONFIRMED | AUTO_IMPLEMENT |
| AUD-003 | P1 | CONFIRMED | AUTO_IMPLEMENT |
| AUD-010 | P1 | CONFIRMED | DEFER: cross-layer linkage and legacy behavior need design |
| AUD-006 | P2 | CONFIRMED | DEFER: lower benefit than selected five |
| AUD-007 | P2 | HIGH_CONFIDENCE | DEFER: needs real adapter failure harness |
| AUD-008 | P2 | CONFIRMED | DEFER: no reliable performance baseline; selected tasks consume cap |
| AUD-009 | P2 | HYPOTHESIS | VERIFY_FIRST |

The selected five stay within the configured implementation cap and do not require dependency, public API, database schema, authorization, network, commit, or push changes.

## Confirmed follow-up disposition — 2026-07-10

The table above preserves the original audit and first-batch selection record.
After the user explicitly resolved the cross-layer/product choices, a second
bounded batch of five tasks changed the current disposition as follows:

| Finding / residual | Current disposition | Evidence |
| --- | --- | --- |
| AUD-010 record-first Level 2 removal | Fixed by OPT-006 | Canonical records carry exact origin links; only Memory-on, Level 2, unpaused, low-sensitivity non-constraint candidates auto-confirm; confirmed removal writes a text-free tombstone, updates the native session cache, and durably reconciles linked `accepted/applied` audit state to `undone`. Three review rounds ended ACCEPT. |
| OPT-005 historical `logs.txt` residue | Fixed by OPT-007 | Startup deletes only exact `<manifest.dir>/logs.txt` without reading/listing/uploading; independent review/verification PASS. Cold restart remains the reliable boundary for a pre-existing hot-reload Console closure. |
| Repository PR/master CI gap | Repository-local fix by OPT-008 | Read-only CI covers PR and `master` with notices, coverage, lint, build and bundle audit. First remote run and required-check configuration remain external. |
| AUD-006 duplicate Quiet Recall accept | Fixed by OPT-009 | Shared PluginManager Link owner records exactly once; review/verification ACCEPT/PASS. Historical aggregates are not migrated. |
| AUD-008 Stats full rescan on arbitrary delete | Fixed by OPT-010 | Removed only the duplicate PluginManager full-recalc listener; StatsManager incremental ownership remains; review/verification ACCEPT/PASS. No unmeasured percentage claim. |

AUD-007 and AUD-009 remain deferred/verify-first. No new P0 was found. The
OPT-006 review did find and close two P1 and four P2 trust/recovery gaps before
acceptance; their full audit trail is in `reviews/OPT-006.md`.

The later global integration audit additionally closed three P2 issues
(active-record audit recovery, malformed trust-count coercion, and pause-value
cross-write leakage) plus one P3 false concurrent-convergence warning discovered
in the real app. Fresh independent re-reviews accepted every correction. The
remaining accepted-without-record ambiguity is a baseline P2 residual with no
safe heuristic migration; defensive P3s and complete residual rationale are in
`reviews/GLOBAL-INTEGRATION.md`.
