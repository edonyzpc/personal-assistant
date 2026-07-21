# Pagelet UI/UX Hardening Product Spec

Document status: Approved
Updated: 2026-07-21
Work item: B-118
Decision: [DEC-021 — 按真实界面证据分阶段修复 Pagelet UI/UX 漂移](../decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md)
Scoped decision: [DEC-023 — Pagelet provider 首次使用采用共享非阻断通知](../decisions/dec-023-shared-pagelet-provider-first-use.md)
Authority: B-118 的已授权修复范围、证据边界、非目标与验收标准；现有 Scope Recap、Quiet Recall、Bubble、Data Boundary、Retrieval Habit Profile 与 Saved Insight 合同继续定义其余行为。
Approval boundary: SG-01 至 SG-04、SG-07a/SG-07b 已由用户于 2026-07-20
解决，SG-07c 已延期且不阻断 B-118；SG-05/SG-06 仅以 DEC-023 为当前权威。

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
  downstream callback 可以按现行合同有意打开或更新 Bubble、Panel 或 Detail；这不
  属于 Pet 根冒泡，其中 Discover 保持进入 Panel。3 秒超时、点外部、取消触摸和
  移动超阈值只负责收起或取消。
- B-118/REQ-02: fresh prepared Recap 的 Bubble 首屏以最强的实际
  `title/body/sourceRefs` 为主要内容；“已准备回顾”只能作为次级状态，不能替代
  具体 observation 与来源入口。Detail 同时显示明确 scope、generatedAt、coverage/
  freshness 等现有 artifact 元数据，并把内部状态翻译为普通用户可理解的文案。
- B-118/REQ-03: 标准有界 Scope Recap 不显示授权 Modal。provider 已配置、能力未
  关闭且来源合规时，第一次实际 Pagelet provider 调用显示一次共享非阻断通知并
  继续；通知说明可能发送允许范围的笔记摘录、可能消耗 API credits/cost，以及可在
  Settings 关闭。broad/sensitive/costly/whole-vault 或 excluded override 仍必须在
  provider call 和 cost reservation 前提供 blocking `run / adjust / cancel`。若第一次
  实际调用恰为高风险，完整 blocking disclosure 在用户明确 Run、全部 gate 通过且调用
  即将发生时同时完成 shared first-use，不追加第二条 notice；Cancel/close/未完成的
  Adjust 不改 shared flag。
- B-118/REQ-04: `prefers-reduced-motion: reduce` 覆盖 Pagelet Pet、通知点、blink、
  working dots、resting zzz、nudge、hold ring/menu 等装饰动画，以及 Bubble
  open/close scale/translate 与 rich action hover 位移；内容、状态和触控仍可用。
- B-118/REQ-05: Quiet Recall Bubble 的动作固定为 `View / Later / Dismiss`；
  `Link / Save` 留在 Recall Detail Tab。`View` 使用当前候选进入 Tab，不得隐藏地
  重新运行 provider-backed Recall。`Later` 进入既有 Review Queue，表达用户明确的
  return intent。`Dismiss` 只对当前具体 candidate 形成弱信号；RHP 关闭时不收集、
  不写入且不影响排序。被动关闭保持中性，不冒充反馈或 Later。
- B-118/REQ-06: Scope Recap 后台准备只有在对应任务真实 active 时才能显示
  `working`。成功、空/低质量结果、provider 不可用、失败、超时、abort/cancel、
  route/scope/active-note 失效、相关设置关闭、Focus Mode、Pagelet disable/unload、
  reload 或 newer run 取代旧 run 后，Pet 必须收敛到与当前可交付内容一致的非
  working 稳定状态；迟到的旧 promise 不得恢复过期 `working/nudge`。
- B-118/REQ-07: Settings 必须把 Quiet Recall 表达为 `Off / On` 两档，默认 Off，
  且不另设 frequency cap；quality gate、quiet hours、Focus Mode 与每 candidate 一次
  共同控制噪声。旧 `bubbleNudgesEnabled=true` 迁移为 On，false 或缺失等其他状态
  迁移为 Off。Quiet Recall 与 generic proactive hints、Scope Recap preparation/hints
  分别控制，互不联动；Retrieval Habit Profile 仍需显式启用或完成 first-use notice，
  不能随 Recall 设置静默 opt in。英文名称保留 `Quiet Recall`，中文使用“相关回顾”。
- B-118/REQ-08: Bubble 的来源链接、动作说明等辅助文字在 Obsidian 14px、16px、
  24px 基准下保持可读、按比例缩放且不溢出；目标可读下限约 12px。
- B-118/REQ-09: 桌面 Bubble 以 active leaf 的可用区域放置，在左右侧栏开关、
  分栏和窗口缩放时不产生不可操作遮挡；iPhone 竖屏与浅横屏继续遵守 safe area、
  44×44 触控目标和无横向溢出合同。
- B-118/REQ-10: 所有 Recall/Discover/Recap provider-backed note reading 复用现行
  shared Data Boundary：标准有界运行共用一次 first-use non-blocking notice，并在
  通知后继续；broad/sensitive/costly/whole-vault run 与 excluded override 逐次阻断。
  已显示共享通知的小范围低风险运行不重复重型披露。B-118 不新建、迁移或重置
  feature-specific first-use state；provider trust 也不授予 Memory、写入、Markdown
  或外部 action 权限。

### Non-goals

- NG-01: 不重做 Pagelet 四层渐进披露 IA、Pet 视觉资产或整个 Settings 页面。
- NG-02: 不新增 Review Queue、badge、自动写入 Markdown/Memory、自动 link 或其他
  write action；也不删除 Saved Insight 已有的用户意图队列语义。
- NG-03: 不改变 Scope Recap provider/data boundary、成本上限、质量门或后台准备
  默认语义。
- NG-04: 不用模拟器、DOM 或自动化测试替代所声明的桌面/真机视觉与触控证据。
- NG-05: 不把 iPad、Android、stable release 或未授权 provider 调用伪装成本
  track 的完成条件。
- NG-06: 不扩展 2026-07-20 已决定的 SG-01 至 SG-04、SG-07a/SG-07b；不在 B-118
  重做 SG-07c 延期的普通 Quiet Bubble empty state。SG-05/SG-06 只执行 DEC-023 的
  已接受合同。

## User Flow And States

### Pet 短点与长按

短点在 Bubble 开/关之间稳定切换一次。长按约 520ms 后显示三项菜单，松手不打开
Bubble。菜单项拥有自己的 touch/click 事件边界；选择、取消、超时、点外部和移动
超阈值互不混淆。Pet 根切换计数为零，不表示 target downstream 不能呈现结果。

### Prepared Recap

Pet 处于 insights-ready/nudge 时，用户点击后首先看到一条具体、来源支持、值得
继续看的 observation。用户可进入 Recap Detail，或使用现行合同允许的动作。首屏
不要求用户先点击通用“已准备”卡片才能知道内容是什么。

### Scope Recap 首次通知

标准有界 Scope Recap 不再显示授权 Modal。第一次实际 Pagelet provider 调用共用
一次轻量非阻断通知并继续，后续 eligible bounded runs 不重复重型披露，也不得由
任一 feature 重置通知状态。用户已有 opt-out 继续有效。高风险范围仍在任何 provider
call 或 cost reservation 前阻断，并提供 run / adjust / cancel。若它同时是第一次实际
调用，完整阻断披露只在 affirmative Run 后的 imminent-call seam 写 shared flag，且不
叠加普通 notice；后续高风险运行仍逐次确认。

### Quiet Recall

Quiet Recall 默认 Off；用户开启后，仍由 quality gate、quiet hours、Focus Mode 与
每 candidate 一次约束主动呈现，不增加频率档位。Bubble 只提供 `View / Later /
Dismiss`：View 使用当前候选进入 Recall Detail Tab，Tab 内保留 Link/Save；Later
进入 Review Queue；Dismiss 只对当前 candidate 形成弱信号，且 RHP 关闭时零影响。
关闭 Bubble、Escape 或点外部保持中性。显式 Discover 继续进入 Panel；普通 Quiet
Bubble empty state 在 B-118 保持现状。

### Motion、状态与布局

Reduce Motion 下保留静态状态差异，不持续闪烁、跳动、脉冲或漂浮。每个后台任务
只在真实活动期拥有 working；任何 terminal、失效或 lifecycle 事件都必须清理。
桌面 Bubble 不压住 active leaf 或侧栏关键操作；移动端继续保持已验证的安全区和
触控目标。

## Trust, Data And Authority

- Source evidence: UI 内容必须来自当前 `DeliveryCandidate`、Recap artifact 与明确
  source refs；不得用“已准备”状态冒充洞察。
- Shared Data Boundary: [PA Data Boundary](./pa-data-boundary-product-spec.md) 继续
  定义 source eligibility、shared first-use notice、broad/sensitive/costly disclosure
  与 excluded-scope override；B-118 不创设或重置平行 first-use 状态。
- Local learning: [Retrieval Habit Profile](./pa-retrieval-habit-profile-product-spec.md)
  继续要求 first-use notice 或显式 enable，且仅 local、clearable、weak influence。
- Later / durable intent: [Saved Insight and Insight Ledger](./pa-saved-insight-ledger-product-spec.md)
  继续定义 durable insight 语义；B-118 中 Quiet Recall Bubble 的 `Later` 明确进入
  既有 Review Queue，`Link / Save` 仍留在 Tab。
- Data sent / stored: B-118 不新增数据发送类型或持久对象类型；`Later` 只写入既有
  Review Queue。自动化和 UI smoke 优先使用 provider-free fixture；真实 provider
  验证必须另有明确数据/成本授权。
- Reversibility / recovery: 所有 UI 修复应可局部回滚；不能把关闭 Bubble 推断为
  consent、negative feedback、save 或 durable dismissal。

## Acceptance Criteria

- B-118/AC-01: 自动化或 Inspector runtime counter 证明 Capture、Review、Discover
  各 target callback 恰好一次，Pet 根 `onToggleBubble` 额外次数为 0；真实 iPhone
  手指触控证明对应结果只出现一次且无额外 Pet 根切换/闪动。Review/Discover 可按
  现行 downstream 合同改变 Bubble/Panel/Detail。`touchcancel`、移动超阈值和多点触控
  的 target/root callback 均为 0；菜单 Enter/Space 不冒泡到 Pet 根；Pet 保持现行
  约 400ms click suppression，Bubble action 保持现行 12px move threshold 与 500ms
  click suppression。Discover target 继续进入 Panel。
- B-118/AC-02: prepared Recap 的 DOM 与真实桌面首屏都直接显示候选 body、可识别
  标题/来源，并通过 3 秒价值测试；Detail 可见 scope、本地化 generatedAt、coverage/
  freshness 产品文案；打开不产生重复 provider call。
- B-118/AC-03: 标准有界 Scope Recap 首次运行证明授权 Modal 数为 0、共享通知显示
  一次且运行继续；后续 Recall/Discover/Recap 共用同一已通知状态，不重复通知、不
  重置状态。provider 未配置、能力关闭或来源为空时 provider call 为 0。高风险路径
  覆盖 Run、Adjust、Cancel 与被动关闭；Cancel/close 的 provider call、cost
  reservation 和 first-use state mutation 均为 0。第一次实际调用为高风险且选择
  Run 时，完整 blocking disclosure=1、non-blocking notice=0；只有全部 gate 通过且
  invocation immediately next 时 shared flag 才变为 true。
- B-118/AC-04: macOS/iOS Reduce Motion 为 true 时，blink group、working dots、
  resting zzz、notification、task ring、nudge、`[data-capture-hold=true]::after` 与
  hold menu 均没有 infinite animation，或计算后的 animation-name 为 none / duration
  为 0；Bubble open/close 与 rich action hover 没有 scale/translate 位移。短点、
  长按、菜单项和各状态仍可辨识且可操作。Inspector/computed-style 证据不得标记为
  真实视觉观察。
- B-118/AC-05: Bubble 只显示 `View / Later / Dismiss`，Link/Save 只在 Tab；测试
  记录每个动作的 route、provider、durable write、RHP 与 Review Queue 副作用。
  View 打开当前候选且新增 provider call 为 0；Later 创建一个既有 Review Queue
  item；Dismiss 只标记当前 candidate，并仅在 RHP 已启用时记录弱信号。RHP 关闭时
  feedback write 与排序影响均为 0；被动关闭的 feedback、queue、dismiss 均为 0。
- B-118/AC-06: deterministic lifecycle tests 覆盖 `idle -> working` 后的成功、
  空/低质量、provider missing、throw/reject、timeout、abort/cancel、route/scope/
  active-note 失效、设置关闭、Focus Mode、Pagelet disable/unload、reload 和 newer-run
  supersession；每条路径最终 `working=false`，旧 promise 完成不能恢复过期 working/
  nudge，重复调度不产生重复可见状态或未清理 listener/timer。真实桌面在可见
  Pagelet 上验证至少 success 与一条 cancel/failure 收敛路径。
- B-118/AC-07: Settings DOM 和 runtime mapping 只提供 Quiet Recall Off/On，默认
  Off 且没有 frequency cap；On 仍服从 quality gate、quiet hours、Focus Mode 与每
  candidate 一次。迁移 fixture 证明旧 true -> On，false/缺失/其他 -> Off。Quiet
  Recall、generic hints、Recap preparation/hints 与 RHP enablement 互不联动；英文
  显示 `Quiet Recall`，中文显示“相关回顾”，且不暴露内部术语。
- B-118/AC-08: 14/16/24px、亮/暗主题、中英文组合中辅助文字计算字号不低于目标
  可读下限，无裁切、重叠或横向溢出。
- B-118/AC-09: 桌面右侧栏关闭/打开、分栏、窗口缩放均无关键遮挡；iPhone 430×932
  竖屏和约 932×430 浅横屏的元素 rect 全部位于 `visualViewport.width/height/
  offsetLeft/offsetTop` 内，menu 在 Pet 上方/下方的实际方向与可用空间一致，所有
  menu items 不小于 44×44，且不覆盖 Obsidian toolbar 或系统控件。QuickTime 真横屏
  与 Inspector synthetic viewport 必须分别标记，不能互相替代。
- B-118/AC-10: shared Data Boundary fixture 覆盖 first-use bounded、previously-notified
  bounded、broad/sensitive/costly/whole-vault run 与 excluded-scope override。标准
  bounded 首次通知后运行继续；高风险确认前 provider call 与 cost reservation 为 0。
  首次高风险 Run 由完整阻断披露同时完成 shared first-use，不出现重复 notice；shared
  flag 已为 true 也不免除后续高风险逐次确认。
  测试不得创建、迁移或重置 feature-specific first-use state，也不得把 provider trust
  当作 Memory admission、写入、Markdown 或外部 action 授权。

## Resolved Decisions And Remaining Boundaries

| Gate | Resolution | Current B-118 boundary |
| --- | --- | --- |
| SG-01 | 2026-07-20 Resolved：Quiet Recall 仅 Off/On、默认 Off、无 frequency cap；旧 true -> On，其他 -> Off | quality gate、quiet hours、Focus Mode、每 candidate 一次控制噪声；与 generic hints、Recap 解耦 |
| SG-02 | 2026-07-20 Resolved：Bubble = View + Later + Dismiss | Link/Save 留在 Tab；View 使用当前候选且不重跑 provider |
| SG-03 | 2026-07-20 Resolved：Dismiss 是当前 candidate 的弱信号 | RHP 关闭时零收集、零写入、零排序影响；被动关闭中性 |
| SG-04 | 2026-07-20 Resolved：Later 进入既有 Review Queue | 仅表达明确 return intent，不新增另一套 queue/snooze 模型 |
| SG-07a | 2026-07-20 Resolved：英文保留 Quiet Recall，中文为“相关回顾” | 仅同步产品文案，不重命名英文概念 |
| SG-07b | 2026-07-20 Resolved：Discover 保持进入 Panel | 不重做现有 IA |
| SG-07c | 2026-07-20 Deferred：普通 Quiet Bubble empty state 保持现状并进入 Backlog | 不阻断 B-118，其 redesign 不在本 track 实现 |

SG-05 与 SG-06 已由
[DEC-023](../decisions/dec-023-shared-pagelet-provider-first-use.md) 解决并保持独立
权威：标准有界 Pagelet provider path 共用一次非阻断 first-use notice；高风险范围
继续逐次阻断；首次高风险运行的完整 blocking disclosure 只在 affirmative Run 后、
调用即将发生时同时完成 shared first-use，不追加普通 notice。B-118 当前没有因
SG-01 至 SG-07 未决而保留的产品 stop gate；任何
超出上述 resolution 的新语义仍须先更新 Decision 与 Product Spec。

## Delivery Handoff

- Active Package: [B-118 Feature Home](../../development/active/pagelet-ui-ux-optimization/README.md)
- Detailed evidence and execution brief: [Claude Code handoff](../../development/active/pagelet-ui-ux-optimization/handoff-claude-code.md)
- Architecture contracts: [Pagelet Product Design](../pagelet-product-design.md), [Scope Recap Spec](./pa-scope-recap-theme-summary-product-spec.md), [Quiet Recall Spec](./pa-quiet-recall-insight-timing-product-spec.md), [Bubble Spec](./pagelet-bubble-readiness-and-recall-product-spec.md), [Data Boundary](./pa-data-boundary-product-spec.md), [Retrieval Habit Profile](./pa-retrieval-habit-profile-product-spec.md), [Saved Insight](./pa-saved-insight-ledger-product-spec.md)
- Release / rollout boundary: 本 spec 授权有界实现、测试、review 与本地/真机验证；
  不授权 commit、push、tag、beta/stable publish。
