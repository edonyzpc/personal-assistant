# Optimization Plan

## Selection policy

Candidates were ranked by correctness/data safety, reliability, testability, verified security impact, and only then performance or maintenance. `AUTO_IMPLEMENT` requires a reproducible or fully traced defect, bounded files, automated acceptance, no production dependency, and independent rollback. The five selected tasks are the configured maximum.

## Ordered implementation plan

### OPT-001

任务编号: OPT-001  
标题: 禁止 Level 2 自动迁移历史 Memory 候选  
来源问题: AUD-002  
问题证据: idle 和第 30 次确认均调用全量 `autoConfirmPendingMemoryCandidates()`，与产品文档明确的 no-migration 约束冲突；新候选已有独立 creation-time 路径。  
目标: Level 2 只自动确认创建后的新 eligible candidate；既有 suggested candidate 在启动和等级切换时保持不变。  
非目标: 不改变 trust threshold，不补做 Auto-accepted Remove UI，不改变 Memory record format。  
涉及模块: PluginManager Memory candidate orchestration。  
预计修改文件: `src/plugin.ts`, `__tests__/plugin-record-note.test.ts`。  
允许改变的行为: 移除历史 backlog sweep。  
必须保持的行为: 新 Level 2 candidate 自动确认；manual confirm、conflict guard、failure recovery 和计数不变。  
实现思路: 删除 idle sweep 和 manual-confirm 后 sweep；收窄不再需要的 option/field；增加真实 plugin path regression。  
替代方案: 给历史迁移增加提示——被明确产品合同排除。  
风险: 可能遗漏依赖 sweep 的隐藏调用；通过新候选正例和历史候选负例约束。  
前置依赖: 无。  
目标测试: `__tests__/plugin-record-note.test.ts` 的 Level 2 candidate 测试。  
完整验证命令: focused Jest；`npm run lint`; `npx tsc -noEmit -skipLibCheck`; `npm run build`; full regression。  
性能验收: 不适用。  
回滚方案: 仅回退本任务在 `src/plugin.ts` 和对应测试中的小块 diff。  
预计复杂度: S  
分类: AUTO_IMPLEMENT

### OPT-002

任务编号: OPT-002  
标题: 让所有 Quick Capture 弹窗共享同一按路径写入协调器  
来源问题: AUD-001  
问题证据: PluginManager 每次打开创建 service，但 append queue 是 service 实例字段；真实多弹窗可绕开串行化。  
目标: 单个 plugin 生命周期内，所有 Quick Capture 保存共享既有 per-path queue。  
非目标: 不改变捕获格式、目标选择、modal UI、post-processing 或公共命令。  
涉及模块: PluginManager, QuickCaptureService。  
预计修改文件: `src/plugin.ts`, `__tests__/plugin-record-note.test.ts` 或 `__tests__/quick-capture.test.ts`。  
允许改变的行为: 多次请求 service 时复用实例；卸载后释放引用。  
必须保持的行为: 单次打开、draft、Notice、post-processing、不同路径并发和现有输出格式。  
实现思路: PluginManager 懒加载并缓存一个 service；设置对象保持同一可变引用；卸载时清理缓存引用。  
替代方案: 静态全局 queue 会跨 Vault 泄漏；禁止第二弹窗会改变 UX，均不采用。  
风险: 缓存 service 可能捕获旧值；当前 callbacks 读取共享 settings/draft/plugin methods，需测试设置引用和卸载。  
前置依赖: 无。  
目标测试: service identity、多次打开和既有同实例并发 append。  
完整验证命令: focused Quick Capture/plugin Jest；lint；type-check；build；full regression。  
性能验收: 不适用。  
回滚方案: 删除缓存字段，恢复 factory 每次 new；回退测试。  
预计复杂度: S  
分类: AUTO_IMPLEMENT

### OPT-003

任务编号: OPT-003  
标题: 使 PA Store mutation 在持久化失败时保持原子且可重试  
来源问题: AUD-004  
问题证据: 故障注入确认 Review Queue、Memory Governance、Saved Insight 均在 persist reject 后保留新内存状态；Memory retry 产生重复 record。  
目标: 所有 store mutation 串行执行，只有 next snapshot 成功持久化后才提交；plugin settings adapter 失败后恢复旧子树。  
非目标: 不改变数据格式、状态机、ID、去重规则或授权/确认行为。  
涉及模块: ReviewQueueStore, MemoryGovernanceStore, SavedInsightStore, PluginManager persistence adapters。  
预计修改文件: `src/pa/review-queue-store.ts`, `src/pa/memory-governance-store.ts`, `src/pa/saved-insight-store.ts`, `src/plugin.ts`, `__tests__/review-queue-store.test.ts`, `__tests__/memory-governance-store.test.ts`, `__tests__/saved-insight-store.test.ts`, `__tests__/plugin-record-note.test.ts`（软上限 8）。  
允许改变的行为: persist reject 后操作抛错且 snapshot/settings 保持操作前状态；并发 mutation 按提交顺序串行。  
必须保持的行为: 成功返回值、状态转换、排序、持久化 payload、错误传播和公共类型。  
实现思路: 每个 store 加内部 promise queue；operation 构造 next state，await persist，成功后赋值；plugin adapter 用 try/catch 恢复旧数组引用。  
替代方案: mutate 后 catch rollback 在并发下会回滚后续成功操作；不采用。  
风险: commit-after-persist 改变操作期间 list 的可见时点；串行队列固定并发语义并以测试约束。  
前置依赖: OPT-001（同改 `plugin.ts`，先稳定信任流程）。  
目标测试: 三 Store reject-once、failure snapshot equality、retry single record、并发不丢更新；plugin adapter rollback。  
完整验证命令: 三 Store + plugin focused Jest；lint；type-check；build；full regression。  
性能验收: 不适用；队列只覆盖本来必须串行保存的本地 settings mutations。  
回滚方案: 分别回退三个 store 的 queue/commit helper、plugin adapter rollback 和新增测试。  
预计复杂度: M  
分类: AUTO_IMPLEMENT

### OPT-004

任务编号: OPT-004  
标题: 对 malformed PA ledger 持久化输入 fail closed  
来源问题: AUD-005  
问题证据: 基线 bundle 对缺失 summary/text 和 `sourceRefs:[null]` 可稳定抛 TypeError；这些 normalize 由启动 settings merge 直接调用。  
目标: 单条坏记录被丢弃且不抛；同一 state 的有效记录仍加载。  
非目标: 不自动修复或猜测坏数据，不改变有效记录，不迁移格式。  
涉及模块: PA contracts and three ledger normalizers。  
预计修改文件: `src/pa/contracts/source-ref.ts`, `src/pa/contracts/review-queue.ts`, `src/pa/memory-governance-store.ts`, `src/pa/saved-insight-store.ts`, `__tests__/review-queue-store.test.ts`, `__tests__/memory-governance-store.test.ts`, `__tests__/saved-insight-store.test.ts`。  
允许改变的行为: malformed entry 从 TypeError 变为被 normalize 丢弃。  
必须保持的行为: 有效 entry clone、validation reasons、security path checks 和混合 state 中的有效数据。  
实现思路: runtime validator 先检查 string/array/scope/source-ref/whyShown element shapes，再运行现有业务校验和 clone。  
替代方案: normalize 外层 catch 丢弃整个 ledger 会扩大数据损失；不采用。  
风险: 过严 guard 可能丢弃历史有效形状；用当前 defaults/fixtures 和混合 state 测试防止。  
前置依赖: OPT-003（同改 Store，后实施便于逐项审查）。  
目标测试: 每个 ledger 至少覆盖缺字段、null source ref、坏 scope arrays、混合有效/无效 records。  
完整验证命令: settings + three Store focused Jest；lint；type-check；build；full regression。  
性能验收: 不适用。  
回滚方案: 回退新增 runtime guards 与 malformed fixtures。  
预计复杂度: M  
分类: AUTO_IMPLEMENT

### OPT-005

任务编号: OPT-005  
标题: 移除移动端 Debug 的全局 Console 劫持  
来源问题: AUD-003  
问题证据: helper 会捕获其他插件日志、无界重写未脱敏原文，且卸载不恢复；插件已有脱敏且作用域内的 `this.log`。  
目标: Debug 只使用现有 scoped/redacted logger，不再修改全局 Console 或写无界 `logs.txt`。  
非目标: 不扩大脱敏器规则，不设计新的文件日志系统，不改变非 Debug 行为。  
涉及模块: PluginManager debug startup, obsolete mobile debug helper references。  
预计修改文件: `src/plugin.ts`, `__tests__/plugin-record-note.test.ts`，必要时删除仅此处使用的 helper。  
允许改变的行为: 移动 Debug 不再生成 `logs.txt`，不捕获全局日志。  
必须保持的行为: 启动 Notice、插件自身 Debug console 输出与 redaction。  
实现思路: 删除 import/call；测试 debug onload 不改写 Console，并验证 `plugin.log` redaction path。  
替代方案: 给全局 patch 加 disposer/上限仍会收集其他插件输出，违反最小权限。  
风险: 依赖旧文件日志的开发者失去该调试工件；当前仓库无文档/调用依赖，Console logger 仍保留。  
前置依赖: OPT-002/OPT-003（同改 plugin，最后实施可清晰复核）。  
目标测试: mobile/debug onload preserves console methods; plugin logger redacts secret-shaped values。  
完整验证命令: plugin focused Jest；community source scan；lint；type-check；build；full regression；test-vault smoke。  
性能验收: 不适用；验收为不再产生无界日志 I/O。  
回滚方案: 恢复 import/call 和测试；不涉及用户数据迁移。  
预计复杂度: S  
分类: AUTO_IMPLEMENT

## Deferred and rejected candidates

| Issue | Classification | Reason |
| --- | --- | --- |
| AUD-010 Auto-accepted Remove pipeline | DEFER | Requires cross-layer durable linkage, legacy fallback, UI confirmation, and more than one bounded task; unsafe to guess in this run. |
| AUD-006 duplicate Quiet Recall accept | DEFER | Confirmed but lower impact than selected data/privacy tasks. |
| AUD-007 swallowed Discovery failure | DEFER | Needs a real adapter failure harness to pin model-unavailable versus provider-error semantics. |
| AUD-008 Stats full rescan on delete | DEFER | Confirmed but no comparable performance baseline and implementation cap is consumed. |
| AUD-009 provider cancellation | VERIFY_FIRST | Abort propagation has not been proven across configured providers. |
| PR/master CI workflow | DOCUMENT_ONLY | External branch protection is unverified under the no-network constraint. |
| Framework/dependency upgrades | REJECT | No evidence and dependency changes are disabled. |
| VSS/vector algorithm rewrite | ACCEPT_CURRENT_STATE | Existing bounded implementation and benchmark evidence do not show a current regression. |

## Task boundaries

- No task changes dependencies, lockfiles, public APIs, database schema, authorization, network behavior, production data, release automation, commits, or remote state.
- Each task has an automated regression test and a path-only rollback.
- A task becomes `INVALIDATED`, `FAILED_REVIEW`, or `FAILED_VERIFICATION` rather than being replaced with opportunistic work if its evidence or root cause fails revalidation.

## Confirmed follow-up plan — 2026-07-10

After the initial `PARTIAL_SAFE_COMPLETION`, the user explicitly confirmed the
remaining product and repository decisions. The follow-up remains conservative,
uses no dependency/public API/database/auth changes, creates no commits, and
selects five additional independently reversible tasks:

| Task | Source | Confirmed boundary | Classification |
| --- | --- | --- | --- |
| OPT-006 | AUD-010 | Keep silent Level 2 activation; make Confirmed Memory the record-first source of truth; add exact-ID removal with confirmation, queue audit linkage for new records, safe legacy fallback, and a pause/resume setting that does not reset trust count. | AUTO_IMPLEMENT |
| OPT-007 | OPT-005 residual | Delete only the obsolete plugin-owned `<manifest.dir>/logs.txt` at startup, without reading/uploading/scanning; failure must not block startup. | AUTO_IMPLEMENT |
| OPT-008 | Repository CI risk | Add read-only PR and `master` CI using the existing release validation commands and concurrency cancellation. Remote required-check configuration remains outside the no-push boundary. | AUTO_IMPLEMENT |
| OPT-009 | AUD-006 | Assign Quiet Recall Link acceptance feedback to exactly one production owner and pin the real wiring with a regression test. | AUTO_IMPLEMENT |
| OPT-010 | AUD-008 | Remove the duplicate plugin-level delete/full-recalc path while preserving `StatsManager` incremental delete handling. | AUTO_IMPLEMENT |

OPT-006 is the only task expected to exceed the eight-file soft limit. The
boundary was re-evaluated: settings persistence, cross-store linkage, Pagelet
callback threading, bilingual copy, and automated UI/runtime acceptance form
one product contract. Splitting them would leave either an ungovernable durable
record or a visible control without a safe backend during intermediate review.
All other tasks remain independently reviewable and reversible.

## Final task disposition

The original five-task limit was honored for the first batch. The user then
explicitly authorized a second, separately bounded batch of five after the
first `PARTIAL_SAFE_COMPLETION`; this is not a silent expansion of one batch.

| Task | Final status | Review | Verification | Rollback boundary |
| --- | --- | --- | --- | --- |
| OPT-001 | COMPLETE | ACCEPT | PASS | Historical-sweep helper/entrypoints and regressions |
| OPT-002 | COMPLETE | ACCEPT after one fix round | PASS | Shared Quick Capture service lifecycle hunks |
| OPT-003 | COMPLETE | ACCEPT after one fix round | PASS | Three Stores plus shared settings queue as one unit |
| OPT-004 | COMPLETE | ACCEPT after one fix round | PASS | Validators/normalizers and their regressions |
| OPT-005 | COMPLETE | ACCEPT | PASS | Retired global logger import/call/helper/tests |
| OPT-006 | COMPLETE | ACCEPT after three task rounds and global re-reviews | PASS | Record linkage, removal, settings control, Pagelet threading, locale/tests |
| OPT-007 | COMPLETE | ACCEPT | PASS | Exact-path startup cleanup and tests |
| OPT-008 | COMPLETE_LOCALLY | ACCEPT | PASS | Delete `.github/workflows/ci.yml`; remote gate not yet configured |
| OPT-009 | COMPLETE | ACCEPT | PASS | Restore only the duplicate orchestrator feedback call/test expectation |
| OPT-010 | COMPLETE | ACCEPT | PASS | Restore only the duplicate PluginManager delete listener/test expectation |

No selected task was invalidated, rolled back, failed review, or failed
verification. AUD-007 remains `DEFER`; AUD-009 remains `VERIFY_FIRST`.
