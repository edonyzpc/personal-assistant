# Pagelet UI/UX Optimization Delivery Plan

Document status: Approved
Updated: 2026-07-19
Work item: B-118
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Product spec: [Pagelet UI/UX Hardening Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

以最小、分阶段修复恢复 Pagelet 的核心触控与首屏价值，并闭合授权、motion、Recall、
Pet 状态、辅助文字和桌面定位的合同漂移。实现必须保留 handoff 记录的已通过移动
布局和交互基线，不能借机重构无关 Pagelet、Settings、provider 或 release 代码。

## Dependencies And Source Surface

- 完整证据、复现与验收入口：[Claude Code handoff](./handoff-claude-code.md)。
- 产品 authority：DEC-021 与 B-118 Product Spec；支持合同为 Scope Recap、Quiet
  Recall、Bubble 和 Pagelet Product Design。
- Pet/touch/state：`src/pagelet/pet/PetView.ts`、`PetStateMachine.ts`、
  `src/pagelet/orchestrator.ts`。
- Delivery/Recap/Recall：`src/pagelet/bubble/BubbleContent.ts`、`recap-card.ts`、
  `BubbleView.ts`、`BubbleCoordinator.ts`、`src/pagelet/tab/sections/QuietRecallSection.ts`。
- Authorization/settings：`src/pagelet/recap/ScopeRecapAuthorizationModal.ts`、
  `src/settings.ts`、`src/settings/pagelet/index.ts`、Pagelet locale JSON。
- CSS：`src/custom.pcss` 是唯一 UI 样式源；生成 `styles.css`，不做 runtime style 或
  HTML injection。
- Focused tests：Pet state machine、Bubble content/view/coordinator、authorization
  modal、orchestrator、settings、Tab/Recall suites。

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| 0. Code-to-contract reconciliation | Claude 理解当前提交、证据类型和非回归基线 | 读取 AGENTS、North Star、DEC-021、B-118 Spec、handoff；检查工作树 | SDD 覆盖 B-118/REQ-01..10 与 AC-01..10，状态 Approved | 合同、源码或工作树与 handoff 冲突时先更新 Tracker，不猜测 |
| 1. P1 touch ownership | 三个菜单 target 各执行一次，Pet 根不额外 toggle | Pet 根 touch guard、菜单项 touch/click ownership、cancel/move/multi-touch/keyboard、teardown | production-like TouchEvent counter + desktop/iPhone matrix | Review/Discover downstream 可按合同改变 Bubble；不能把“根 toggle=0”误写为“Bubble 永不变化” |
| 2. P1 Recap first-screen value | 首屏直接显示 strongest concrete insight 与来源 | candidate mapping、Bubble content/hierarchy、DOM contract | focused DOM tests + real Obsidian 3-second value | 不得为显示内容重新调用 provider |
| 3. P1 Modal + provider safety | 被动 close 不变成 affirmative auth/强制 Settings；未经授权 provider=0 | Modal close ownership、shared Data Boundary fail-closed | Modal matrix + provider spy + real desktop close | Run/reprompt 受 SG-06、跨 feature authorization 受 SG-05；不得自建 feature store |
| 4. P2 motion + state | motion 合同完整、Pet 状态与真实任务收敛 | exact Pet/Bubble reduced-motion selectors、owner-aware working/nudge lifecycle | computed selector matrix + interleaving tests + desktop/iPhone smoke | 不能无条件 idle 覆盖有效 nudge，也不能以 Inspector computed 冒充视觉观察 |
| 5. Recall characterization + gated repair | 先记录 label/route/provider/write/RHP/queue 现状，再只修已获决定部分 | route/call counters、settings mapping、shared boundary | provider-free UI + SG-01..05 对应 tests | SG-01..05 任一未决就单独 BLOCKED，不预设 caps、action、feedback、Later 或 authorization |
| 6. P2/P3 visual polish | 14px 可读、桌面侧栏不遮挡，移动基线不退化 | typography tokens、active-leaf placement/clamp | computed full matrix + representative visible pairs + iPhone portrait/landscape visualViewport | 不进行无关视觉重设计；复测不可操作遮挡时 F-09 升 P2 |
| 7. Review and formal validation | 所有声明有自动化与真实 surface 证据 | adversarial review、local gate、deploy、desktop/iPhone smoke、docs sync | 当前 B-118 scope 的 P0/P1/P2 全关闭；P3 完成或明确延期；被移除工作已更新 Decision/Spec/Backlog；SG-07 有 disposition | 不自动 commit、push、tag 或 release |

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| touch guard 阻断正常短点或键盘 | 只隔离 hold-menu event path，保留根 keyboard/click 合同 | short tap、Enter/Space、synthetic click suppression tests | 回退菜单 slice，保留旧长按 opener，不发布 |
| Recap 内容过长破坏 Bubble | strongest one-line observation + bounded source presentation | 中英文/窄宽 DOM 与 3-second smoke | 保留 Detail 完整内容，Bubble 截断而不回到通用占位 |
| Modal close 使用户无法再次授权或频繁重弹 | passive close 不作为 affirmative auth；SG-06 决定持久状态/重询 | same-session + reload/reopen characterization | SG-06 前不新增 pending/cooldown 语义，受影响部分 BLOCKED |
| Reduce Motion 抹掉状态含义 | 停动画而非隐藏状态元素 | idle/working/nudge/resting visual matrix | 使用静态颜色/opacity 状态，不恢复持续动画 |
| Recall settings 静默 opt-in 或共享错误开关 | 默认 Off；SG-01 前不迁移、不声明假定频率 | old `data.json` characterization + settings DOM | fail closed to Off；迁移部分 BLOCKED |
| Recall/Discover 未经授权发送 note text | 复用 shared Data Boundary first-use/broad/sensitive/costly/excluded override | provider spy 覆盖未授权与 scope boundary | fail closed to local clue/no call；复用/UI 受 SG-05 阻断 |
| Not relevant 过度降低无关候选 | RHP 默认关闭；SG-03 前不改变现有 aggregate | disabled/enabled characterization + signal counters | disabled 时零 collection/influence；新粒度 BLOCKED |
| Later 被误改成无队列短 snooze | 保留 Saved Insight 的 explicit return intent | queue/draft/write characterization | SG-04 前不改变 Later 语义 |
| stale result 反向覆盖新 route | owner token/settle 只作用于当前 owner | interleaving and teardown tests | 清 payload 并回 idle，不展示过期内容 |
| desktop clamp 破坏移动 safe area | desktop/active-leaf selector scoped；保留移动 media rules | portrait/landscape rect + overflow checks | 回退 desktop placement slice |

## Validation Strategy

- Focused tests: 按 handoff 的 slice 清单先跑最接近 Jest；触控测试必须从 menu item
  dispatch `touchstart/touchend`，断言 callback、Bubble 与 synthetic click 次数。
- Type/lint/build gate: `npx tsc -noEmit -skipLibCheck`、`git diff --check`、community
  DOM scan；CSS 变更后构建 Tailwind。最终 app confidence 使用 `make deploy`。
- Obsidian smoke: repo-local `test` vault，验证 Modal、prepared Recap、provider-free
  Recall fixture、themes/fonts/sidebar/split/reduced motion；记录截图路径、窗口/leaf/
  sidebar/Bubble rect、theme/font/locale、selector 和 runtime identity。
- Real-device / community / release gate: `make deploy-icloud` 后在精确 iCloud plugin
  目录保留四条 `MATCH`，reload 后确认真实 WKWebView runtime identity；
  iPhone 实体触摸 Capture/Review/Discover、竖屏/真实横屏 safe area 与 iOS Reduce
  Motion。Quiet Recall/Discover disclosure 先用 no-call fixture；真实 provider 只在
  明确授权后验证。iPad 未测就明确保留 residual risk。无发布授权。

## Approval

- Plan authority: 用户 2026-07-19 明确要求把完整 UI/UX 审查交给 Claude Code 用于
  优化开发；DEC-021 与 B-118 Spec 只固化已授权的 staged hardening，SG-01..07 仍需
  用户产品判断。
- Approved on: 2026-07-19。
- Authorized implementation scope: 不依赖 SG 的 B-118 runtime/CSS/i18n、focused
  tests、SDD/Tracker 同步、review、本地 Obsidian 与 iPhone 验证；受 SG 影响部分在
  决定前只允许 characterization/fail-closed，不包含 commit、push、tag、publish 或
  stable release。
