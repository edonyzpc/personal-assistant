# Pagelet UI/UX Hardening Product Spec

Document status: Approved
Updated: 2026-07-19
Work item: B-118
Decision: [DEC-021 — 按真实界面证据分阶段修复 Pagelet UI/UX 漂移](../decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md)
Authority: B-118 的已授权修复范围、证据边界、非目标与验收标准；现有 Scope Recap、Quiet Recall、Bubble、Data Boundary、Retrieval Habit Profile 与 Saved Insight 合同继续定义其余行为。
Approval boundary: 只批准不依赖 SG-01 至 SG-07 的 staged hardening；任一 gate 未解决时，对应 slice 保持 BLOCKED。

## Problem And Product Outcome

- User problem: Pagelet 当前构建在真实 iPhone 上出现长按菜单项额外切换 Pet
  Bubble，在桌面 prepared Recap 首屏只显示准备状态；若干辅助路径的文案、导航、
  动画和状态也与用户预期或现行合同不一致。
- Product outcome: 核心动作只由正确 owner 触发、首屏立即交付具体价值、motion 和
  异步状态可信、布局可用，并保留已通过的桌面与 iPhone 基线。
- North Star fit: 让用户轻触或长按即可得到预期结果，让自己的来源笔记在需要时
  自然浮现；不借 UI 修复制造新的管理负担、隐私授权或黑箱学习。

## Scope

### In Scope

- B-118/REQ-01: iPhone Pet 长按仍在约 520ms 后只打开
  `Capture / Review / Discover` 菜单。触摸任一菜单项只触发一次该 target callback，
  菜单收起，且 Pet 根 `onToggleBubble` 的额外调用数为 0。Review/Discover 的
  downstream callback 可以按现行合同有意打开或更新 Bubble、Panel 或 Modal；这不
  属于 Pet 根冒泡。3 秒超时、点外部、取消触摸和移动超阈值只负责收起或取消。
- B-118/REQ-02: fresh prepared Recap 的 Bubble 首屏以最强的实际
  `title/body/sourceRefs` 为主要内容；“已准备回顾”只能作为次级状态，不能替代
  具体 observation 与来源入口。Detail 同时显示明确 scope、generatedAt、coverage/
  freshness 等现有 artifact 元数据，并把内部状态翻译为普通用户可理解的文案。
- B-118/REQ-03: Scope Recap 授权 Modal 必须继续遵守 affirmative authorization：
  只有明确选择授权动作才可开始 provider-backed read。X、Escape、系统关闭或其他
  被动关闭不构成授权，也不得直接触发 provider call。`Run` 是只覆盖当前运行还是
  同时开启以后有界后台准备、以及被动关闭后的持久提示状态/重询间隔，属于
  `SG-06`，决定前不得靠改文案或迁移设置擅自选择。
- B-118/REQ-04: `prefers-reduced-motion: reduce` 覆盖 Pagelet Pet、通知点、blink、
  working dots、resting zzz、nudge、hold ring/menu 等装饰动画，以及 Bubble
  open/close scale/translate 与 rich action hover 位移；内容、状态和触控仍可用。
- B-118/REQ-05: 盘点并修复 Recall 动作标签与实际副作用不一致的问题，但在
  `SG-02` 至 `SG-04` 解决前，不改变动作 taxonomy、反馈保留/学习粒度或 Later 的
  Saved Insight / Review Queue 语义。任何 View/Detail 导航都不得隐藏地重新运行
  provider-backed Recall；被动关闭不冒充显式反馈。
- B-118/REQ-06: Scope Recap 后台准备只有在对应任务真实 active 时才能显示
  `working`。成功、空/低质量结果、provider 不可用、失败、超时、abort/cancel、
  route/scope/active-note 失效、相关设置关闭、Focus Mode、Pagelet disable/unload、
  reload 或 newer run 取代旧 run 后，Pet 必须收敛到与当前可交付内容一致的非
  working 稳定状态；迟到的旧 promise 不得恢复过期 `working/nudge`。
- B-118/REQ-07: Settings 必须诚实反映 runtime 已实际支持的 Quiet Recall、generic
  proactive hints 与 Scope Recap preparation/hints 边界。Quiet Recall 继续采用现行
  spec 的概念层 `Off / Quiet / Balanced` 且默认 Off；精确展示频率、context cap、
  旧设置迁移与承诺文案受 `SG-01` 阻断。Retrieval Habit Profile 仍需显式启用或
  完成 first-use notice，不能随 Recall 设置静默 opt in。
- B-118/REQ-08: Bubble 的来源链接、动作说明等辅助文字在 Obsidian 14px、16px、
  24px 基准下保持可读、按比例缩放且不溢出；目标可读下限约 12px。
- B-118/REQ-09: 桌面 Bubble 以 active leaf 的可用区域放置，在左右侧栏开关、
  分栏和窗口缩放时不产生不可操作遮挡；iPhone 竖屏与浅横屏继续遵守 safe area、
  44×44 触控目标和无横向溢出合同。
- B-118/REQ-10: 所有 Recall/Discover/Recap provider-backed note reading 复用现行
  shared Data Boundary：首次使用，以及 broad/sensitive/costly run 需要披露；
  excluded scope 只有显式 per-run override 后才能包含；已经授权的小范围低风险
  运行不重复重型披露。B-118 不新建 feature-specific authorization。跨 feature 的
  授权复用、版本迁移与具体 UI 受 `SG-05` 阻断。

### Non-goals

- NG-01: 不重做 Pagelet 四层渐进披露 IA、Pet 视觉资产或整个 Settings 页面。
- NG-02: 不新增 Review Queue、badge、自动写入 Markdown/Memory、自动 link 或其他
  write action；也不删除 Saved Insight 已有的用户意图队列语义。
- NG-03: 不改变 Scope Recap provider/data boundary、成本上限、质量门或后台准备
  默认语义。
- NG-04: 不用模拟器、DOM 或自动化测试替代所声明的桌面/真机视觉与触控证据。
- NG-05: 不把 iPad、Android、stable release 或未授权 provider 调用伪装成本
  track 的完成条件。
- NG-06: 不在 B-118 静默决定 `SG-01` 至 `SG-07`；受阻 slice 必须请求产品决定。

## User Flow And States

### Pet 短点与长按

短点在 Bubble 开/关之间稳定切换一次。长按约 520ms 后显示三项菜单，松手不打开
Bubble。菜单项拥有自己的 touch/click 事件边界；选择、取消、超时、点外部和移动
超阈值互不混淆。Pet 根切换计数为零，不表示 target downstream 不能呈现结果。

### Prepared Recap

Pet 处于 insights-ready/nudge 时，用户点击后首先看到一条具体、来源支持、值得
继续看的 observation。用户可进入 Recap Detail，或使用现行合同允许的动作。首屏
不要求用户先点击通用“已准备”卡片才能知道内容是什么。

### Scope Recap 首次授权

现行 DEC-017 与 Scope Recap spec 要求 affirmative first-run Data Boundary
authorization 后，才可进行 provider-backed 后台笔记读取。当前 Modal 的 `Run`
是否同时代表“本次运行”和“以后有界后台准备”，以及被动关闭后何时再次询问，
尚未形成无歧义合同。实现可以修复误触发 provider 的安全问题，但不得自行固化
持久设置或重询策略。

### Quiet Recall

Quiet Recall、Bubble 与 Saved Insight 当前合同共同定义 Recall 呈现、证据、反馈与
Later。它们的 action taxonomy 和反馈粒度仍有冲突或缺口。B-118 在产品决定前只
修复可证明的标签/副作用错误，不把 `Dismiss`、`Not relevant` 或 `Later` 改造成
新的保留、学习或队列政策。

### Motion、状态与布局

Reduce Motion 下保留静态状态差异，不持续闪烁、跳动、脉冲或漂浮。每个后台任务
只在真实活动期拥有 working；任何 terminal、失效或 lifecycle 事件都必须清理。
桌面 Bubble 不压住 active leaf 或侧栏关键操作；移动端继续保持已验证的安全区和
触控目标。

## Trust, Data And Authority

- Source evidence: UI 内容必须来自当前 `DeliveryCandidate`、Recap artifact 与明确
  source refs；不得用“已准备”状态冒充洞察。
- Shared Data Boundary: [PA Data Boundary](./pa-data-boundary-product-spec.md) 继续
  定义 source eligibility、first-use、broad/sensitive/costly disclosure 与 excluded-
  scope override；B-118 不创设平行授权。
- Local learning: [Retrieval Habit Profile](./pa-retrieval-habit-profile-product-spec.md)
  继续要求 first-use notice 或显式 enable，且仅 local、clearable、weak influence。
- Later / durable intent: [Saved Insight and Insight Ledger](./pa-saved-insight-ledger-product-spec.md)
  继续定义用户选择 `Later / Keep` 后可形成 Review Queue item 或 lightweight saved
  draft；任何改动都先经过 `SG-04`。
- Data sent / stored: B-118 不新增数据发送或持久对象。自动化和 UI smoke 优先使用
  provider-free fixture；真实 provider 验证必须另有明确数据/成本授权。
- Reversibility / recovery: 所有 UI 修复应可局部回滚；不能把关闭 Bubble 推断为
  consent、negative feedback、save 或 durable dismissal。

## Acceptance Criteria

- B-118/AC-01: 自动化或 Inspector runtime counter 证明 Capture、Review、Discover
  各 target callback 恰好一次，Pet 根 `onToggleBubble` 额外次数为 0；真实 iPhone
  手指触控证明对应结果只出现一次且无额外 Pet 根切换/闪动。Review/Discover 可按
  现行 downstream 合同改变 Bubble/Panel/Modal。`touchcancel`、移动超阈值和多点触控
  的 target/root callback 均为 0；菜单 Enter/Space 不冒泡到 Pet 根；Pet 保持现行
  约 400ms click suppression，Bubble action 保持现行 12px move threshold 与 500ms
  click suppression。
- B-118/AC-02: prepared Recap 的 DOM 与真实桌面首屏都直接显示候选 body、可识别
  标题/来源，并通过 3 秒价值测试；Detail 可见 scope、本地化 generatedAt、coverage/
  freshness 产品文案；打开不产生重复 provider call。
- B-118/AC-03: Modal 自动化覆盖 Run、Adjust、Cancel、X、Escape 与系统关闭；任何
  非 affirmative close 的 provider call 和 provider authorization mutation 均为 0。
  `Run` 的 current/ongoing 设置效果与被动关闭后的 presentation/reprompt 状态，在
  `SG-06` 决定前不得新增断言或实现。
- B-118/AC-04: macOS/iOS Reduce Motion 为 true 时，blink group、working dots、
  resting zzz、notification、task ring、nudge、`[data-capture-hold=true]::after` 与
  hold menu 均没有 infinite animation，或计算后的 animation-name 为 none / duration
  为 0；Bubble open/close 与 rich action hover 没有 scale/translate 位移。短点、
  长按、菜单项和各状态仍可辨识且可操作。Inspector/computed-style 证据不得标记为
  真实视觉观察。
- B-118/AC-05: 在 `SG-02` 至 `SG-04` 解决前，Bubble/Panel action table、feedback
  retention/weight 与 Later queue 行为不变；测试记录每个动作的 route、provider、
  durable write、RHP 与 Review Queue 副作用，且不得超出现行合同。若动作明确标为
  View/Detail，其导航 provider rerun 为 0。决策完成后再新增与所选合同一一对应的
  label、route、write/cost counter 测试。
- B-118/AC-06: deterministic lifecycle tests 覆盖 `idle -> working` 后的成功、
  空/低质量、provider missing、throw/reject、timeout、abort/cancel、route/scope/
  active-note 失效、设置关闭、Focus Mode、Pagelet disable/unload、reload 和 newer-run
  supersession；每条路径最终 `working=false`，旧 promise 完成不能恢复过期 working/
  nudge，重复调度不产生重复可见状态或未清理 listener/timer。真实桌面在可见
  Pagelet 上验证至少 success 与一条 cancel/failure 收敛路径。
- B-118/AC-07: Settings DOM 和 runtime mapping 对已交付能力使用一致产品语言，
  Quiet Recall 默认 Off，generic hints、Recap preparation/hints 与 RHP enablement 不
  被联动。精确 Quiet/Balanced caps 与 migration fixture 在 `SG-01` 决定前保持
  `BLOCKED`，不得用假定值通过。
- B-118/AC-08: 14/16/24px、亮/暗主题、中英文组合中辅助文字计算字号不低于目标
  可读下限，无裁切、重叠或横向溢出。
- B-118/AC-09: 桌面右侧栏关闭/打开、分栏、窗口缩放均无关键遮挡；iPhone 430×932
  竖屏和约 932×430 浅横屏的元素 rect 全部位于 `visualViewport.width/height/
  offsetLeft/offsetTop` 内，menu 在 Pet 上方/下方的实际方向与可用空间一致，所有
  menu items 不小于 44×44，且不覆盖 Obsidian toolbar 或系统控件。QuickTime 真横屏
  与 Inspector synthetic viewport 必须分别标记，不能互相替代。
- B-118/AC-10: shared Data Boundary fixture 覆盖 first-use、already-authorized small
  scope、broad/sensitive/costly run 与 excluded-scope override；未授权路径 provider
  call 为 0。测试不得创建 feature-specific authorization，也不得把 Scope Recap
  状态假定为跨 feature 永久授权；具体复用在 `SG-05` 决定后补充。

## Open Decisions And Stop Gates

| Gate | Product decision required | Safe behavior before decision |
| --- | --- | --- |
| SG-01 | Quiet/Balanced 精确 display/context caps、迁移、generic hints 父门映射、承诺文案 | 保持默认 Off；不迁移、不声明假定频率 |
| SG-02 | Recall Bubble 最终动作 taxonomy 与 View/Open source/Link/Save/Later 的 Bubble/Detail/Panel 层级 | 保留现行动作表；只修复无争议的重复调用或误触发 |
| SG-03 | Dismiss/Not relevant 粒度、保留期、RHP 权重 | 遵循现行 Quiet Recall + opt-in RHP，不新增 exact-source/90d/zero-weight 规则 |
| SG-04 | Later 的 snooze、Saved Insight draft 与 Review Queue 行为 | 保留 Saved Insight 当前 `Later / Keep` 用户意图语义 |
| SG-05 | shared Data Boundary 授权复用、版本迁移、future proactive scope、local-clue upgrade 判据和 UI 形态 | 仅执行 first-use、broad/sensitive/costly、excluded override 现行合同 |
| SG-06 | Scope Recap Run 的本次/持续授权，以及被动关闭后的重询策略 | 被动关闭不授权、不调用；不新增持久提示策略 |
| SG-07 | Explicit Discover 路由、Quiet Recall 名称、普通 quiet 首屏价值 | 保留现状，不顺手改 IA 或命名 |

Claude Code 遇到受 gate 影响的实现必须停止该 slice、记录 `BLOCKED` 并请求用户
决定；可以继续不依赖该 gate 的其他 slice。新的产品决定须先更新 Decision 与
Product Spec，再恢复实现。

## Delivery Handoff

- Active Package: [B-118 Feature Home](../../development/active/pagelet-ui-ux-optimization/README.md)
- Detailed evidence and execution brief: [Claude Code handoff](../../development/active/pagelet-ui-ux-optimization/handoff-claude-code.md)
- Architecture contracts: [Pagelet Product Design](../pagelet-product-design.md), [Scope Recap Spec](./pa-scope-recap-theme-summary-product-spec.md), [Quiet Recall Spec](./pa-quiet-recall-insight-timing-product-spec.md), [Bubble Spec](./pagelet-bubble-readiness-and-recall-product-spec.md), [Data Boundary](./pa-data-boundary-product-spec.md), [Retrieval Habit Profile](./pa-retrieval-habit-profile-product-spec.md), [Saved Insight](./pa-saved-insight-ledger-product-spec.md)
- Release / rollout boundary: 本 spec 授权有界实现、测试、review 与本地/真机验证；
  不授权 commit、push、tag、beta/stable publish。
