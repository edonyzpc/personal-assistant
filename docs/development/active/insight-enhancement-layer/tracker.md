# Insight Enhancement Layer Development Tracker

Document status: Current
Delivery status: Planned
Updated: 2026-07-21
Work item: B-119
Authority: 本 track 的唯一执行状态、finding lifecycle、验证证据与 closeout readiness。
Product spec: [PA Insight Enhancement Layer Product Spec](../../../product/specs/pa-insight-enhancement-layer-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: 获得 runtime 实现授权后创建并链接 `./sdd.md`

## Current Snapshot

- Current phase: Plan-only；DEC-022、Approved Product Spec 与 Delivery Plan 已建立。
- Next action: 等待用户明确授权实现；随后创建并批准 `sdd.md`，先处理 shared foundation。
- Blocker / decision needed: 无产品决策；runtime implementation authority 与 Approved
  SDD 均尚不存在。B-118 F-03/F-10 shared-notice runtime gap 是实现依赖，不是新的
  产品决定；不存在外部 mirror 或 connector blocker。
- Last verified behavior: 2026-07-20 仅复核当前源码入口和文档合同；没有修改或验证
  runtime，也没有 Obsidian/provider smoke 证据。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-119/REQ-05 / B-119/AC-01、06、07 | SDD + shared provider/data/budget/DTO foundation | [ ] | Awaiting implementation authority and Approved SDD |
| T-02 | B-119/REQ-02 / B-119/AC-03 | Graph enhancer + source evidence + UI | [ ] | Not started |
| T-03 | B-119/REQ-01 / B-119/AC-02 | Pattern enhancer + parent trigger gates + UI | [ ] | Not started |
| T-04 | B-119/REQ-03 / B-119/AC-04、B-119/AC-05 | Maintenance preview overlay + existing move regression | [ ] | Not started |
| T-05 | B-119/REQ-05 / B-119/AC-06、B-119/AC-07、B-119/AC-08 | Settings、shared notice、cost attribution、lifecycle、locales | [ ] | Not started |
| T-06 | B-119/REQ-06 / B-119/AC-09、B-119/AC-10 | ephemeral persistence + source re-grounding + metadata-only coupling | [ ] | Not started |
| T-07 | B-119/REQ-01..03/05..06 / B-119/AC-01..10 | review、local gate、deploy、desktop/real-device smoke、docs closeout | [ ] | Not started |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | 原 handoff 把 enhancer 反向加入 `PageletHost`，但 plugin 已拥有结构结果、来源内容和 provider adapter | 保持 plugin-private pipeline，显式输入 `{ structuralResult, sourceNotes }` | SDD dependency direction + type tests | Open |
| F-02 | P1 | 原方案可能把 AI 文本放入可执行 `MaintenanceProposal` 并“适配” validator | 建立独立 ephemeral overlay；仅合法 folder 建议可显式转换为现有 move preview | executable fields deep-equal + write/undo counters | Open |
| F-03 | P1 | Graph/Pattern/Maintenance 新字段若只改 domain type，会在 Tab renderer 或 Detail clone 中丢失 | 同一 slice 更新 panel/tab types、clone、render、locales 和 round-trip tests | Pagelet reopen + bilingual DOM tests | Open |
| F-04 | P2 | `findRelatedNotes()` 可能产生 embedding provider 调用，不能只记录 generation 一次 | generation 与 VSS/embedding 分开 actual-call attribution | cost/rate/provider spy | Open |
| F-05 | P2 | 原 Feature 联动允许派生 claim 成为下一 feature 上下文 | 只传 dedupe/structural/source identity；最终 claim 重新读取原笔记 | forged upstream-claim rejection tests | Open |
| F-06 | P2 | B-118/Scope Recap 文档曾保留 provider trust authority drift | [DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md) 选择方案 A，并将 Scope Recap 与 B-119 纳入同一个 standard bounded Pagelet shared notice 合同；Memory 等高后果流程继续使用独立确认 | DEC-017、Data Boundary、Scope Recap、B-118/B-119 current contracts 已对齐 DEC-023；SDD 不得重置 shared notice | Closed |
| F-07 | P1 | B-119 原计划把现有 shared notice 当作完成依赖，但 B-118 source audit 证明 fresh-install Scope Recap gate 与 cross-feature actual-call timing/Discover coverage 未闭合 | B-119 SDD 必须先等待/复用 B-118 F-03/F-10 修复，或在 shared foundation 中原子协调同一 owner；不得创建 B-119 专属 flag/helper | fresh-install/no-call/Recap-Recall-Discover-B119 cross-feature provider-spy matrix | Open / implementation dependency |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-07-20 | Planning baseline | Read-only source/contract audit | Pass for planning | Verified plugin integration points, shared notice field, RateLimiter constructor, UI clone/render surfaces and move-only apply/undo; no runtime claim |
| 2026-07-21 | Historical external mirror (retired) | SLA-11 update + read-back | Pass | 当时已验证 title、decision summary、B-119/B-120 scope、repo paths、Backlog state 与 labels；仅保留历史证据，不触发后续同步 |
| 2026-07-21 | B-119/REQ-05 / F-06 | Provider trust contract reconciliation | Pass | DEC-023 Option A accepted；Scope Recap、Quiet Recall、Discover 与 B-119 standard bounded paths 共享非阻断首次通知；Memory admission/write 等独立 gate 未改变 |
| 2026-07-21 | B-119/REQ-05 / F-06 | `npm run docs:check`、`git diff --check`、historical SLA-11 read-back | Pass | 当时 247 Markdown / 1710 local links、zero whitespace errors；外部状态仅为历史证据；无 runtime claim |
| 2026-07-21 | B-119/REQ-05 / F-07 | Read-only shared runtime dependency audit | Gap recorded | B-118 fresh-install preparation remains off behind legacy authorization tuple；notice is not yet a common first-actual-call gate；B-119 runtime remains untouched |
| 2026-07-21 | Historical external mirror (retired) | SLA-11 runtime-truth update + read-back | Rejected / unchanged | 当时 connector 拒绝披露未提交 workspace/source-audit 明细；该记录不再构成待办、授权问题或同步要求 |

## Decision Log

| Date | Decision | Impact |
| --- | --- | --- |
| 2026-07-20 | [DEC-022](../../../product/decisions/dec-022-bounded-insight-enhancement-layer.md) | Graph + Pattern + Maintenance 同包；Writing 转 B-120；bounded default/shared notice；Maintenance preview + existing move confirm/undo only |
| 2026-07-21 | [DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md) Option A | Scope Recap、Quiet Recall、Discover 与 B-119 三项能力在各自 standard bounded envelope 内共享一次非阻断 first-use notice；不得重置或新建 feature-specific state；Memory 等高后果流程继续使用独立合同 |

## Closeout Readiness

- [ ] Owning Product Spec 与实际行为一致。
- [ ] Approved SDD 与实现、provider/data boundary、budget 和 UI lifecycle 一致。
- [ ] Graph、Pattern、Maintenance focused tests 与 full local gate 通过。
- [ ] Required desktop/iPhone smoke 和 provider/cost 证据已记录。
- [ ] Maintenance 未扩大 rename/link/create/write authority。
- [ ] 未完成项已进入 Backlog。
- [ ] `closeout.md` 已记录信息 disposition。
- [ ] Active Registry 与 Archive index 更新方案明确。
