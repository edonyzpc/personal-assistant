# Pagelet UI/UX Optimization Development Tracker

Document status: Current
Delivery status: Planned
Updated: 2026-07-19
Work item: B-118
Authority: 本 track 的唯一执行状态、finding lifecycle、验证证据与 closeout readiness。
Product spec: [Pagelet UI/UX Hardening Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: 进入设计 phase 后创建并链接 `./sdd.md`

## Current Snapshot

- Current phase: 产品合同、执行计划与 Claude Code handoff 已建立；Design 尚未开始。
- Next action: 创建 Approved `sdd.md`，再从不依赖产品决定的 T-01/T-02、T-03/T-10
  fail-closed safety、T-04/T-06/T-08/T-09 开始。
- Blocker / decision needed: SDD 尚未创建；`SG-01` 至 `SG-07` 分别阻塞设置频率/
  迁移、Recall 动作、feedback、Later、shared authorization、Scope Recap Run/reprompt
  与 Discover/name/quiet-first-screen。其他 slice 不被这些决定阻塞。
- Last verified behavior: 2026-07-19 当前 master 的自动化与 deploy 通过；真实桌面和
  iPhone/产品合同审查确认 4 个 P1、5 个 P2、1 个 P3，同时确认移动 safe-area/短点/长按
  opener 等非回归基线。详见 handoff，不能把该 baseline 当作修复后验证。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-118/REQ-01 / B-118/AC-01 | Pet hold-menu touch ownership | [ ] | [Handoff F-01](./handoff-claude-code.md#f-01) |
| T-02 | B-118/REQ-02 / B-118/AC-02 | Recap first-screen concrete value | [ ] | [Handoff F-02](./handoff-claude-code.md#f-02) |
| T-03 | B-118/REQ-03 / B-118/AC-03 | Authorization passive-close safety；Run/reprompt 受 SG-06 阻断 | [ ] | [Handoff F-03](./handoff-claude-code.md#f-03) |
| T-04 | B-118/REQ-04 / B-118/AC-04 | Complete reduced-motion coverage | [ ] | [Handoff F-04](./handoff-claude-code.md#f-04) |
| T-05 | B-118/REQ-05 / B-118/AC-05 | Recall characterization；action/feedback/Later 受 SG-02..04 阻断 | [ ] | [Handoff F-05](./handoff-claude-code.md#f-05) |
| T-06 | B-118/REQ-06 / B-118/AC-06 | Pet stale/disable state convergence | [ ] | [Handoff F-06](./handoff-claude-code.md#f-06) |
| T-07 | B-118/REQ-07 / B-118/AC-07 | Quiet Recall settings characterization；caps/migration 受 SG-01 阻断 | [ ] | [Handoff F-07](./handoff-claude-code.md#f-07) |
| T-08 | B-118/REQ-08 / B-118/AC-08 | 14/16/24px typography readability | [ ] | [Handoff F-08](./handoff-claude-code.md#f-08) |
| T-09 | B-118/REQ-09 / B-118/AC-09 | Desktop active-leaf placement and mobile regression | [ ] | [Handoff F-09](./handoff-claude-code.md#f-09) |
| T-10 | B-118/REQ-10 / B-118/AC-10 | Shared Data Boundary fail-closed；reuse/UI 受 SG-05 阻断 | [ ] | [Handoff F-10](./handoff-claude-code.md#f-10) |
| T-11 | B-118/REQ-01..10 / B-118/AC-01..10 | SDD, adversarial review, docs and full validation | [ ] | SDD 尚未创建 |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | iPhone 菜单项 `touchend` 冒泡到 Pet 根：Capture/Discover 不执行却切 Bubble，Review 执行同时切 Bubble | 隔离 menu touch ownership；target callback once、Pet 根额外 toggle zero；downstream 可按合同呈现结果 | production-like TouchEvent counters + user-finger iPhone matrix | Open |
| F-02 | P1 | prepared Recap 首屏只显示通用“已准备”，真实 `body/sourceRefs` 被降级；Detail metadata 是另一个 P2 合同项 | 实际 observation/source 为 primary；Detail 使用产品语言显示 scope/time/coverage/freshness | DOM contract + desktop 3-second value + long-content layout | Open |
| F-03 | P1 | Modal X/Escape 被解析为 Adjust，关闭准备并打开 Settings | 先保证 passive close 不授权/不直接 provider/不强制跳 Settings；持久状态与 Run/reprompt 受 SG-06 阻断 | modal matrix + provider/authorization/redirect counters | Open / Partly blocked |
| F-04 | P2 | iOS WKWebView computed blink 仍为 `5s infinite`，Pet/Bubble motion 覆盖也不完整 | 精确 selector/pseudo matrix，保留静态状态 | computed animation/transition matrix + real iPhone interaction | Open |
| F-05 | P2 | Recall CTA label/route/provider 副作用不一致，反馈/Link/Later 合同互相冲突 | 先 characterization；View/Detail 不隐藏重跑；SG-02..04 后改 taxonomy/feedback/Later | route/provider/write/RHP/queue counters + provider-free UI | Open / Partly blocked |
| F-06 | P2 | stale route 或 hint/Focus 关闭可留下无内容的 `working/nudge`；Recap background preparation 未表达 working | owner-aware settle + bounded background working | interleaving/disable/teardown tests | Open |
| F-07 | P2 | proactive Recall 默认关闭且没有现行 Spec 的 Off/Quiet/Balanced 入口 | 默认 Off；先 characterization；精确 caps/migration 受 SG-01 阻断 | settings/legacy/locale/DOM；决定后 fake-clock | Open / Partly blocked |
| F-08 | P2 | 14px 下 body/source/hint/button/description/context label 约 9.625–11.81px | 提高可读下限并保持缩放/层级 | computed full matrix + representative visible pairs | Open |
| F-09 | P3 | 既有 overlay clamp 未按 active leaf 可用区约束；会话观察右栏约重叠 142px但无 artifact | 依据 active leaf 可用区域定位/clamp并记录实际交集 | sidebar/leaf/Bubble rect + split/resize smoke | Open |
| F-10 | P1 | Quiet Recall/Discover provider path 未证明遵守 shared first-use Data Boundary | 先统一 shared gate 与 fail-closed；reuse/UI 受 SG-05 阻断 | first-use/broad/sensitive/costly/excluded/no-call provider-spy matrix | Open / Partly blocked |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-07-19 | Baseline only | `npm test -- --runInBand`, lint, build | Pass | 160 suites / 3175 tests；只证明自动化/构建，不证明 UI 已修复 |
| 2026-07-19 | Baseline only | `make deploy-icloud` + four-asset byte comparison | Session-reported Pass / artifact missing | 口头记录四资产一致，但未保留四条 MATCH 与 WKWebView runtime identity；修复后必须重做 |
| 2026-07-19 | Baseline only | Desktop real Obsidian UI audit | Mixed / FAIL overall | Recap、Modal、typography/placement findings；通过项和环境见 handoff |
| 2026-07-19 | Baseline only | iPhone 15 iOS 26.5.2 real-device + Safari Inspector + QuickTime landscape audit | Mixed / FAIL overall | Hold-menu action 与 reduced-motion 失败；portrait/landscape safe area 通过；iPad 未测 |
| 2026-07-19 | Baseline only | Second-layer Product contract/source audit | Fail | 补充 F-05/F-07/F-10：Recall action/feedback/weight、三档 reachability、first-use provider disclosure；未发送真实 note text |

## Decision Log

| Date | Decision | Impact |
| --- | --- | --- |
| 2026-07-19 | [DEC-021](../../../product/decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md) | 采用 evidence-led staged hardening，保留非回归基线；未决 Recall/authorization/reprompt 语义进入 SG-01..07 |
| 2026-07-19 | SG-01..SG-07 | 不由 Claude Code 擅自决定 frequency/migration、actions、feedback、Later、shared authorization、Modal Run/reprompt 或 Discover/name/quiet-first-screen |

## Closeout Readiness

- [ ] Owning Product Spec 与实际行为一致。
- [ ] Architecture/Pagelet contracts 与实际行为一致。
- [ ] SDD 已创建且 Approved，映射 B-118/REQ-01..10 与 AC-01..10。
- [ ] 当前 B-118 scope 的 P0/P1/P2 已关闭；SG-01..06 已决定并完成，或经新的
  Decision/Product Spec 正式移出 B-118 并进入 Backlog。
- [ ] SG-07 已记录保持现状或后续 Backlog 的明确 disposition。
- [ ] Required review、desktop/iPhone smoke 与 community gate 证据已记录。
- [ ] 未完成项已进入 Backlog，且没有把 iPad/provider 缺口冒充 PASS。
- [ ] `closeout.md` 已逐项记录 README、Plan、SDD、Tracker、handoff 与临时证据去向。
- [ ] Active Registry 与 Archive index 更新方案明确。
