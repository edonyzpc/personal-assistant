# Pagelet UI/UX Optimization Delivery Plan

Document status: Approved
Updated: 2026-07-21
Work item: B-118
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Product spec: [Pagelet UI/UX Hardening Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)
Tracker: [Development Tracker](./tracker.md)
Current execution note: 2026-07-21 source audit reopened Phase 3 / F-03 / F-10; DEC-023, including the user-selected rule that a complete first high-risk blocking disclosure also satisfies shared first-use, is approved product authority, but runtime reconciliation must finish before deploy/smoke. The current product-decision sync does not itself authorize code changes.

## Goal And Non-goals

以最小、分阶段修复恢复 Pagelet 的核心触控与首屏价值，并闭合授权、motion、Recall、
Pet 状态、辅助文字和桌面定位的合同漂移。实现必须保留 handoff 记录的已通过移动
布局和交互基线，不能借机重构无关 Pagelet、Settings、provider 或 release 代码。

## Dependencies And Source Surface

- 完整证据、复现与验收入口：[Claude Code handoff](./handoff-claude-code.md)。
- 产品 authority：DEC-021 与 B-118 Product Spec；provider first-use scoped amendment
  为 [DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)；
  支持合同为 Data Boundary、Scope Recap、Quiet Recall、Bubble 和 Pagelet Product Design。
- Pet/touch/state：`src/pagelet/pet/PetView.ts`、`PetStateMachine.ts`、
  `src/pagelet/orchestrator.ts`。
- Delivery/Recap/Recall：`src/pagelet/bubble/BubbleContent.ts`、`recap-card.ts`、
  `BubbleView.ts`、`BubbleCoordinator.ts`、`src/pagelet/tab/sections/QuietRecallSection.ts`。
- Provider trust/settings：`src/pagelet/orchestrator.ts`、`src/plugin.ts`、
  `src/settings.ts`、`src/settings/pagelet/index.ts`、Pagelet locale JSON；历史
  `ScopeRecapAuthorizationModal` 只作为被移除的旧路径证据。
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
| 3. P1 shared provider trust | 标准有界路径首次共享非阻断通知并继续；首次恰为高风险时由完整阻断披露同时完成 first-use；高风险运行仍逐次确认 | 移除旧 Scope Recap Modal；复用 shared disclosure/flag；broad/sensitive/costly/whole-vault/out-of-envelope/excluded override gate；Run/Adjust/Cancel timing | shared-notice/provider-spy matrix + real desktop notice；首次高风险 Run 无重复 notice，Cancel/close/unpassed Adjust 的 provider/cost/flag=0；已通知后高风险仍逐次确认 | 不重置 shared notice，不自建 feature authorization；只在 gate 通过且调用即将发生时写 flag；provider 信任不授予写权限 |
| 4. P2 motion + state | motion 合同完整、Pet 状态与真实任务收敛 | exact Pet/Bubble reduced-motion selectors、owner-aware working/nudge lifecycle | computed selector matrix + interleaving tests + desktop/iPhone smoke | 不能无条件 idle 覆盖有效 nudge，也不能以 Inspector computed 冒充视觉观察 |
| 5. Recall contract repair | 按 SG-01..05 已定合同修复 label/route/provider/write/RHP/queue 行为 | route/call counters、Off/On settings、View/Later/Dismiss、shared boundary | provider-free UI + SG-01..05 对应 tests | 不扩大 RHP、Saved Insight、Queue、provider 或写入权限 |
| 6. P2/P3 visual polish | 14px 可读、桌面侧栏不遮挡，移动基线不退化 | typography tokens、active-leaf placement/clamp | computed full matrix + representative visible pairs + iPhone portrait/landscape visualViewport | 不进行无关视觉重设计；复测不可操作遮挡时 F-09 升 P2 |
| 7. Review and formal validation | 所有声明有自动化与真实 surface 证据 | adversarial review、local gate、deploy、desktop/iPhone smoke、docs sync | 当前 B-118 scope 的 P0/P1/P2 全关闭；P3 完成或明确延期；被移除工作已更新 Decision/Spec/Backlog；SG-07 有 disposition | 不自动 commit、push、tag 或 release |

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| touch guard 阻断正常短点或键盘 | 只隔离 hold-menu event path，保留根 keyboard/click 合同 | short tap、Enter/Space、synthetic click suppression tests | 回退菜单 slice，保留旧长按 opener，不发布 |
| Recap 内容过长破坏 Bubble | strongest one-line observation + bounded source presentation | 中英文/窄宽 DOM 与 3-second smoke | 保留 Detail 完整内容，Bubble 截断而不回到通用占位 |
| 旧 Modal/feature flag 与 DEC-023 形成双重 first-use 状态 | 删除旧阻断入口，只复用 `pageletProviderFirstUseNotified`；不重置已通知用户或现有 opt-out | cross-feature、reload/upgrade、already-notified fixture | 回退到标准 structural/local 结果；不恢复 feature-specific authorization |
| Reduce Motion 抹掉状态含义 | 停动画而非隐藏状态元素 | idle/working/nudge/resting visual matrix | 使用静态颜色/opacity 状态，不恢复持续动画 |
| Recall settings 静默 opt-in 或共享错误开关 | Quiet Recall 默认 Off；旧 true 只迁移为 On；与 Recap/generic hints 解耦 | old `data.json` fixture + settings DOM | fail closed to Off；不重置其他 capability opt-out |
| Recall/Discover 绕过 Data Boundary，或首次高风险误写/漏写 shared flag | 标准有界路径先过滤后共享通知；首次高风险完整阻断披露可合并 first-use，但仅在 Run 后 gate 通过且调用即将发生时写 flag；后续高风险仍逐次确认 | first-use/already-notified/high-risk-first-call/broad/sensitive/costly/excluded provider spy | local clue/no call；Cancel/close/unpassed Adjust 不产生 call/cost/flag mutation；降为标准有界时回到普通 notice |
| Dismiss 过度降低无关候选 | RHP 默认关闭；启用时只记录该候选弱信号 | disabled/enabled + exact-candidate signal counters | disabled 时零 collection/influence；回退为 neutral dismiss |
| Later 被误改成无队列短 snooze | 按 SG-04 进入既有 Review Queue/Saved Insight return-intent 路径 | queue/draft/write characterization | 回退到现行明确 intent 合同，不新增平行 snooze state |
| stale result 反向覆盖新 route | owner token/settle 只作用于当前 owner | interleaving and teardown tests | 清 payload 并回 idle，不展示过期内容 |
| desktop clamp 破坏移动 safe area | desktop/active-leaf selector scoped；保留移动 media rules | portrait/landscape rect + overflow checks | 回退 desktop placement slice |

## Validation Strategy

- Focused tests: 按 handoff 的 slice 清单先跑最接近 Jest；触控测试必须从 menu item
  dispatch `touchstart/touchend`，断言 callback、Bubble 与 synthetic click 次数。
- Type/lint/build gate: `npx tsc -noEmit -skipLibCheck`、`git diff --check`、community
  DOM scan；CSS 变更后构建 Tailwind。最终 app confidence 使用 `make deploy`。
- Obsidian smoke: repo-local `test` vault，验证旧 Modal 不再出现、DEC-023 shared notice、
  prepared Recap、provider-free
  Recall fixture、themes/fonts/sidebar/split/reduced motion；记录截图路径、窗口/leaf/
  sidebar/Bubble rect、theme/font/locale、selector 和 runtime identity。
- Real-device / community / release gate: `make deploy-icloud` 后在精确 iCloud plugin
  目录保留四条 `MATCH`，reload 后确认真实 WKWebView runtime identity；
  iPhone 实体触摸 Capture/Review/Discover、竖屏/真实横屏 safe area 与 iOS Reduce
  Motion。Quiet Recall/Discover disclosure 先用 no-call fixture；真实 provider 只在
  明确授权后验证。iPad 未测就明确保留 residual risk。无发布授权。

## Approval

- Plan authority: 用户 2026-07-19 明确要求把完整 UI/UX 审查交给 Claude Code 用于
  优化开发；2026-07-20 已决定 SG-01..07 disposition，2026-07-21 又以 DEC-023 确认
  SG-05/SG-06 的统一 provider trust 合同，并选择首次高风险运行的方案 A。
- Approved on: 2026-07-19。
- Authorized implementation scope: B-118 runtime/CSS/i18n、focused tests、SDD/
  Tracker 同步、review、本地 Obsidian 与 iPhone 验证；provider 路径必须遵守 DEC-023，
  不包含 commit、push、tag、publish 或 stable release。
