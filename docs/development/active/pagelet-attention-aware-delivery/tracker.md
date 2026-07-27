# Pagelet Attention-Aware Delivery Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-07-27
Work item: B-121
Authority: 本 track 的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [Pagelet Attention-Aware Delivery Product Spec](../../../product/specs/pagelet-attention-aware-delivery-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: P4 已完成；runtime、design、automated、desktop 与 iPhone portrait
  layout/touch validation 均已交付。P5 文档生命周期清理由用户要求本轮先不处理。
- Next action: 无 runtime 或验证动作待办；commit/push/release 不在本轮授权内。
- Blocker / decision needed: 无。既有 20 项 docs checker baseline 不在 B-121 范围；
  iPhone physical landscape 仍为明确 `NOT TESTED` residual，不冒充 PASS。
- Last verified behavior: iPhone 用户实机长按确认 Ring 可打开；最新 iCloud build 在
  430×932 iPhone 上将 Capture / Review / Discover 从 Pet 下方排成同一 44px 水平行，
  全部位于 visual viewport；Mirroring 可见结果与 Web Inspector 几何一致。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-121/REQ-01; B-121/AC-01; B-121/AC-02 | versioned Recall/Recap fingerprint + transient receipt | [x] | delivery identity unit matrix |
| T-02 | B-121/REQ-02; B-121/REQ-03; B-121/REQ-04; B-121/REQ-12; B-121/AC-03; B-121/AC-04; B-121/AC-05; B-121/AC-06; B-121/AC-12 | device-local seen/ack store + visibility/detail commit + admission | [x] | store/fallback/Bubble/Detail/orchestrator tests + reload smoke |
| T-03 | B-121/REQ-05; B-121/REQ-06; B-121/AC-07; B-121/AC-08 | one-time empty explanation + short-click/Quick Review resolver | [x] | resolver tests + desktop first/second click smoke |
| T-04 | B-121/REQ-07; B-121/REQ-09; B-121/AC-09; B-121/AC-10 | Action Ring gesture ownership, mutual exclusion, pending nudge | [x] | gesture/coordinator/orchestrator tests + desktop interaction smoke |
| T-05 | B-121/REQ-08; B-121/REQ-10; B-121/AC-11 | Ring geometry, 44px, keyboard/focus/a11y/reduced motion | [x] | constrained-layout tests + desktop sidebar/Tab/Escape smoke |
| T-06 | B-121/REQ-11; B-121/AC-12 | reuse existing actions and preserve provider/Data Boundary/write limits | [x] | callback/provider/storage payload tests |
| T-07 | All B-121 requirements | focused/full gates + PA review/fix | [x] | final settled gate: 166 suites / 3516 tests；lint/build/type/diff/community scan PASS；CSS generated artifact byte-identical；multi-agent re-review 无开放 P0/P1/P2 |
| T-08 | B-121/AC-07; B-121/AC-08; B-121/AC-09; B-121/AC-10; B-121/AC-11 | deployed desktop and iPhone real-device smoke | [x] | desktop PASS；用户实机长按证据 + 最新 iPhone 竖屏水平布局/a11y/44px/viewport visual PASS；41.5px real-device touch move 后 Ring=false；Capture 触控只出现一个 Quick Capture；physical landscape 明确 NOT TESTED |
| T-09 | All | authority absorption and lifecycle closeout | [-] | current contracts/tests 已吸收；用户要求本轮先不处理文档管理，Active Package 保持 Current |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P2 | 右侧面板压窄 Markdown surface 时 Discover action 被父容器裁切。 | 将 desktop Ring viewport 与实际 Markdown container bounds 求交；窄空间退化布局。 | constrained unit + 真实侧栏三项完整可见 | Closed |
| F-02 | P2 | Escape 同步回焦会被 Obsidian key-event fallback 覆盖。 | 被动关闭后下一 task 回焦 Pet，并在 teardown 取消 timer。 | unit + 真实 DOM activeElement 为 Pet trigger | Closed |
| F-03 | P2 | Quick Review terse empty 曾按 content type 误提交另一语义的 empty acknowledgement。 | presentation 显式携带 acknowledgement；terse result 永不提交，Ready Empty / Intentionally Quiet 分开。 | cross-semantic acknowledgement regression | Closed |
| F-04 | P2 | Ring 与 Panel 共用同一 document capture Escape 时，一次按键可连续关闭两层。 | Ring 优先处理并 stopImmediatePropagation；第二次 Escape 才关闭 Panel。 | true EventTarget competing-listener regression | Closed |
| F-05 | P2 | readiness in-flight 会丢弃后到 Quick Review；stale nudge 可能让一次 Pet 点击无结果。 | 串行保留最新 presentation/entry/snapshot，只重绘 exact current content；stale/unavailable ticket 同次点击重跑 ordinary resolver。 | deferred readiness race + stale/render-failure split tests | Closed |
| F-06 | P2 | 一度把 background Recap failure 暴露到普通 Pet Retry Bubble，且缺本地定向/View sources，违反 DEC-019 silent boundary。 | background failure 仅保留 backoff；普通 Pet 不受影响；显式 Recap 继续走 call-free Detail，显示 scope/coverage、真实 sourceLinks、Retry + View sources。 | silent ordinary resolver + explicit Detail/provider/source tests | Closed |
| F-07 | P2 | Root hold 只在 Pet 内检测第二 contact；新增 document guard 后又暴露 no-document seam 与双 listener teardown 回归。 | Pet 所属 document 临时 guard；未挂载 seam 安全降级；gesture/outside listener 独立清理。 | outside pointer/touch + legacy/no-document + teardown tests | Closed |
| F-08 | P2 | Ring 在首 contact 未释放时，move/cancel/leave/第二 contact 的回滚、回焦与“原本已开 Ring”身份不一致。 | gesture 显式记录是否由本次新开；统一 rollback helper 只关闭本次新开的 Ring并延迟回焦，repeat hold 保留既有 Ring。 | post-threshold pointer/touch matrix + repeat-hold/focus tests | Closed |
| F-09 | P2 | 未配置 AI 服务时，显式 Recap Detail 仍显示 `Retry`，但点击实际进入设置，标签与结果不一致。 | 按 provider readiness 条件渲染操作卡：已配置显示 Retry；未配置显示 Open settings，并直接进入设置。 | provider configured/unconfigured action regression；7 suites / 371 tests | Closed |
| F-10 | UX-P2 | iPhone toolbar Ring 的 Capture / Review / Discover 向右下对角展开，纵向穿过标题与正文，视觉侵入过强。 | 改为从 Pet 下方向右水平排列；右侧空间不足时整行左移，极窄 viewport 才退化。 | 2 suites / 99 tests；local mobile visual；iPhone 430×932 三项同为 y=111、44px、inside viewport；Mirroring visual | Closed |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-07-27 | planning gate | source map + Approved Plan/SDD | PASS | runtime not yet changed |
| 2026-07-27 | all runtime slices | focused Jest + type-check + diff/community scan | PASS | 10 suites / 657 tests before final UI fixes；final focused 84 tests |
| 2026-07-27 | all runtime slices | final focused regression after completion audit | PASS | Bubble/Coordinator/Orchestrator/Ring/Pet 5 suites / 273 tests；Ring/Pet cancellation matrix 2 suites / 93 tests；type/diff PASS |
| 2026-07-27 | all runtime slices | final settled `make deploy` full gate | PASS | F-09 后重跑：166 suites / 3510 tests；lint/build/deploy PASS |
| 2026-07-27 | review | runtime + UI + product-authority second-layer review/fix | PASS | F-03..F-08 closed；follow-up review 继续发现 F-09 |
| 2026-07-27 | B-121/REQ-06; provider boundary | Recap setup-action follow-up | PASS | F-09 closed；7 focused suites / 371 tests；type/diff PASS；final multi-agent re-review no open P0/P1/P2 |
| 2026-07-27 | B-121/REQ-01..12; B-121/AC-01..12 | final requirement-by-requirement completion audit | PASS / RESIDUAL | code/test/current-contract audit 无开放 P0/P1/P2；最新 iPhone portrait visual/geometry 已补齐；physical landscape 明确 NOT TESTED |
| 2026-07-27 | B-121/AC-03; B-121/AC-05 | Bubble seen + repeated Recall in same session and after plugin reload | PASS | first nudge ticket 1；visible Bubble committed seen；repeat tickets 0/0 |
| 2026-07-27 | B-121/AC-07; B-121/AC-08; B-121/AC-11 | desktop Obsidian first explanation → Ring, sidebar geometry, Tab/Escape | PASS | three actions visible；focus moved Capture → Review → Pet |
| 2026-07-27 | app-runtime regression | durable Pagelet smoke runner | PASS / BLOCKED | PASS 26, BUG 0；1 protected durable-Memory probe blocked without mutation |
| 2026-07-27 | documentation gate | `npm run docs:check` | BASELINE FAIL | 与 B-121 无关的既有 20 项：3 unindexed + 3 orphan + 两份旧 Proposal 各 6 项 metadata/status + 2 missing Backlog |
| 2026-07-27 | final desktop incremental smoke | reload latest local deployment | PASS | Mac 解锁后以 Obsidian CLI 复核：部署期间插件被临时移除的 assets 触发 disabled，重新启用后命令恢复；最新 Pet 挂载，空态 Ring 的 Capture / Review / Discover 三项可见且约 3 秒自动收起；清空历史 probe error 后，当前交互 `dev:errors` / error console 均为空。Scope Recap live command 因需单独授权潜在 provider 传输未执行，setup-action 由 focused regression 覆盖 |
| 2026-07-27 | B-121/AC-10; B-121/AC-11 | `make deploy-icloud` + iPhone 15 real-device smoke | PARTIAL | full gate 166 suites / 3510 tests，lint/build PASS；iCloud `main.js` / manifests / `styles.css` 与当前构建逐字节 MATCH。Obsidian iPhone 竖屏 430×932：Pet 44×44，`aria-controls` 正确；Ring `role=group` / `Pagelet actions`，Capture 76.2×44、Review 70.4×44、Discover 80.5×44，全部位于 viewport，设备上三项可见且 keyboard handoff 仅打开一个 Quick Capture。Computer Use 输入日志仅为约 21ms single-touch，不能证明 520ms 长按；镜像无手动旋转入口，touch long-press/action exactly-once 与横屏 safe-area 不声明 PASS |
| 2026-07-27 | B-121/REQ-08; B-121/AC-10; B-121/AC-11 | iPhone horizontal Action Ring correction | PASS / RESIDUAL | user-operated physical long-press confirms Ring entry；latest `make deploy` / `make deploy-icloud` full gate 166 suites / 3516 tests，assets MATCH。iPhone 430×932 Web Inspector：Pet `[56,59,44,44]`；Capture `[56,111,76.2,44]`、Review `[140,111,70.4,44]`、Discover `[218,111,80.5,44]`；`sameTop=true`、`increasingLeft=true`、`inside=true`，Mirroring visual 同步显示水平行。real-device touch trace 从 `(77.7,82.8)` 移到 `(119.2,82.8)` 后 `ring=false`；Capture 触控只出现一个 Quick Capture，未见重复 action。physical landscape 无可用旋转入口，保持 NOT TESTED |

## Closeout Readiness

- [x] Owning contract 与实际行为一致。
- [x] Required review/smoke evidence 已记录；physical landscape residual 已明确。
- [x] 未完成项已有明确 disposition；无新增 runtime Backlog。
- [x] 稳定结论已吸收到 current contract/tests。
- [~] 用户要求本轮先不处理文档管理；Active Package 生命周期清理留后。
