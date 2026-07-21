# Pagelet UI/UX 优化 — Claude Code 开发 Handoff

Document status: Historical evidence (execution superseded by Tracker)
Updated: 2026-07-21
Work item: B-118
Authority: 2026-07-19 当日 commits、源码/测试审查与真实界面证据的历史开发交接；
当前执行状态、验证边界与下一步只以 [Tracker](./tracker.md) 为准。

> [!important] 2026-07-21 当前结论
> B-118 当前为 `Validated`。F-01..F-13 runtime、Prepared command → read-only Panel
> 入口、自动化、独立复审、本地/iCloud 部署与三方资产身份已闭合；Prepared cache
> 不可保存、不可展开到 Tab、不进入 current analysis，查看时不新增 provider call；
> 空缓存只提示 unavailable，并在任何 surface/state mutation 前返回，保留已有
> Panel、Bubble、layout 与 pending。生产命令注册和空缓存路径已由 CLI runtime 证明。
> 用户确认竖屏与长按等本轮手动检查通过；浅横屏明确为
> `NOT TESTED / accepted waiver`，不得沿用本 handoff 的 2026-07-19 QuickTime 历史
> baseline 冒充本轮 PASS。真实 provider/high-risk 调用未获数据/成本授权。closeout、
> commit、push、tag、release 仍需另行授权。

> [!important] 2026-07-21 provider trust + Quiet Recall semantic resolution
> 本 handoff 主体保留 2026-07-19 审查证据、当时未决的 SG-01..07 和旧 Modal
> 复现，不再作为这些产品语义的现行权威。当前统一 provider 合同是
> [DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)：
> 标准有界 Pagelet provider 路径在 capability 开启、来源通过 Data Boundary 后，首次
> 显示一次共享、非阻断通知并继续当前 eligible run；只复用
> `pageletProviderFirstUseNotified`，不得新建/重置 feature-specific authorization 或
> notice。broad、sensitive、costly、whole-vault、超出标准 envelope 与 excluded-scope
> override 仍须在 provider call/cost reservation 前逐次 `run / adjust / cancel`。
> 若首次实际调用恰为高风险，完整阻断披露在用户 Run、全部 gate 通过且调用即将发生时
> 同时完成 shared first-use，不追加第二条 notice；Cancel/close/未完成 Adjust 不写 flag。
> provider 信任不授予 Memory、持久化、vault/Markdown 写入或外部 action 权限。
> 同一 DEC-023 方案 A 还固定风险分类：foreground Review 先过滤、去重，实际允许
> 来源 `<=1` 为 standard bounded、`>1` 才逐次阻断；请求 `last7` 但实际只有 1 个
> 来源仍属 standard，确认前不预留 quota/cost。Generic background preload 只有在
> 显式 opt-in、changed-only、最近 7 天、实际输入 `<=4K`、请求输出 `<=1K`、调用
> `<=2/rolling-hour` 与 `<=20/local-day`、`allowWrite=false`、实际来源逐一通过用户
> 显式 shared Data Boundary 且无 whole-vault/excluded override 时为
> standard bounded；任一越界都 silent skip，不弹 blocking UI、不调用、不落账、
> 不改 flag。敏感性不做内容猜测或调用方布尔自证，未命中显式边界的笔记按普通来源
> 处理；content-free 调用时间戳跨 reload/toggle 持久，存储异常 fail closed。窄
> changed-only envelope 不属于“broad/weekly scan high-risk”。
> [DEC-024](../../../product/decisions/dec-024-quiet-recall-cold-semantic-retrieval.md)
> 进一步采用用户方案 A：保留 pure-semantic candidates；冷 query embedding 是一次
> 真实调用，经过 DEC-023 admission 并与 evaluator/retry 共用既有 Quiet Recall
> 10/hour、50/day 总实际调用预算，不新增额度。空检索只保证 downstream evaluator/
> generation=0；index unavailable 时 metadata 只可作为 explicit Discover local clue，
> 不得冒充 semantic relevance 或主动 Recall。每个 provider seam 与结果接纳前必须
> 使用 read-time source identity 复验 current source/run。
> SG-01..04、SG-07 的现行 resolution 见
> [B-118 Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md) 与
> [Approved SDD](./sdd.md)。后文凡与这些当前合同冲突的 `PRODUCT GATE`、
> `Off / Quiet / Balanced`、旧 action table、首次阻断 Modal 或“SG 仍未决”措辞均只代表
> 历史 finding/复现，不得继续驱动实现。
>
> 2026-07-21 只读源码复核曾确认 fresh-install authorization、shared actual-call、
> pure-semantic/source-freshness 与 Review/preload production admission 缺口；这些是
> 本 handoff 保留的历史 reopening 证据，随后均已修复并由 Tracker 记录验证。不得把
> 下文的“待修复”措辞重新解释为当前 runtime 状态。

> [!important] 交付结论
> 本段原交付结论已由当前 Tracker 取代。Pagelet UI/UX 在 B-118 授权范围内为
> `Validated`；仍需诚实保留浅横屏、iPad/Android、真实 provider/high-risk 调用与
> 新 Prepared command 非空缓存人工操作未执行的证据边界。

## 0. 给 Claude Code 的直接指令

1. 从仓库根目录读取 `AGENTS.md`、[PA Product North Star](../../../product/pa-product-north-star.md)、
   [DEC-021](../../../product/decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md)、
   [DEC-023](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)、
   [DEC-024](../../../product/decisions/dec-024-quiet-recall-cold-semantic-retrieval.md)、
   [B-118 Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)、
   [Feature Home](./README.md)、[Plan](./plan.md) 与本 handoff。
2. 先运行只读基线检查：`git status --short --branch`、`git diff --stat`，保护本
   handoff 和其他用户改动。审查时基线为 `master` / `39e99cd8`，当时与
   `origin/master` 一致且 worktree clean；本 handoff 创建后会有预期 docs 改动。
3. 使用已批准的 `sdd.md`，覆盖 B-118/REQ-01..10、B-118/AC-01..10 与 F-11/F-12；若实现
   发现合同变化，先同步 Product Spec/SDD/Tracker，不能从旧 handoff 猜测。
4. 每个 slice 使用 `implement → focused test → review → fix → verify`。先修无需新
   产品决定的 F-01/F-02、F-03 的 passive-close 安全部分，并按当前 Tracker 完成
   F-10/F-11/F-12 fail-closed、Review/preload classification、semantic retrieval 与
   source-race 边界；后文第 7.1 节旧
   `PRODUCT GATE` 只作历史证据，现行结论以 DEC-023/DEC-024 与 Product Spec 为准。
   之后处理其余 P2，最后处理 F-09；不要顺手重构无关模块。
5. CSS 只改 `src/custom.pcss` 并生成 `styles.css`；禁止 runtime `<style>`、
   `innerHTML` 或 `outerHTML` 注入。事件、timer、listener 必须在 teardown 清理。
6. 完成后必须更新 [Tracker](./tracker.md)，记录自动化、桌面可见界面、iPhone
   实体触控、Inspector/QuickTime 横屏和未测试边界。没有某类证据就明确写
   `BLOCKED` 或 `NOT TESTED`。
7. 本 handoff **不授权** commit、push、tag、beta/stable publish。若之后获准
   commit，使用 signed Conventional Commits、按模块拆分，不加 `Co-Authored-By`。

## 1. 审查范围与今日 commits

审查以 2026-07-19 当地时间的全部 7 个 commits 为输入。只有第一个 commit 大幅
改变用户 runtime/UI，第二个补自动化；其余 docs/release/governance commits 用于
核对交付声明、branch/release 边界，不能当作 UI 已通过的证据。

| Commit | 角色 | 与 B-118 的关系 |
| --- | --- | --- |
| `b0e4ca89 feat(pagelet): complete B-108 dogfood runtime flow` | 29 个 runtime/UI 文件，约 +4550/-437 | 本轮所有核心 surface 的主要变更来源 |
| `6724958d test(pagelet): add B-108 dogfood follow-up coverage` | 17 个测试文件，约 +5166/-123 | 证明已有合同覆盖；也暴露 touch/内容断言没有模拟真实路径 |
| `07dd6959 docs(pagelet): record B-108 dogfood follow-up design and lifecycle` | Product/SDD/tracker/handoff | 用于核对“3 秒价值”、Recap/Recall 与真机声明 |
| `13165b3e docs(pagelet): align B-108 deferred scope and beta authorization` | 文档边界 | 不改变 UI |
| `74305a2e docs(pagelet): close B-108 after BRAT beta validation` | closeout/archive | 历史通过不能覆盖本轮新真机失败 |
| `a06e0594 feat(release): enforce master-sourced beta packaging` | release tooling | 不在本 UI 修复范围；不能因 B-118 自动发版 |
| `39e99cd8 docs(governance): adopt master-first branch management` | repo governance | 后续 accepted work 先进入 master；不授权 Git 写入 |

主要变更面：Pet、Bubble、Scope Recap、Quiet Recall、Pagelet Orchestrator、Settings、
locale、Tab、`src/custom.pcss`。Release tooling 与 branch governance 已读，但没有
发现需要由 UI slice 修复的用户界面问题。

### 1.1 当前产品 authority

- 顶层价值：[PA Product North Star](../../../product/pa-product-north-star.md) 与
  [Low-Burden Review Principles](../../../product/pa-low-burden-review-product-principles.md)。
- B-118 选择与验收：[DEC-021](../../../product/decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md)
  与 [B-118 Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)。
- Scope Recap：[DEC-017](../../../product/decisions/dec-017-default-background-recap-preparation.md)、
  [DEC-018](../../../product/decisions/dec-018-quality-gated-scope-recap-hints.md)、
  [DEC-019](../../../product/decisions/dec-019-honest-layered-recap-fallback.md) 与
  [Scope Recap Spec](../../../product/specs/pa-scope-recap-theme-summary-product-spec.md)。
- Quiet Recall：[DEC-020](../../../product/decisions/dec-020-independent-quiet-recall-evaluation.md)
  与 [Quiet Recall Spec](../../../product/specs/pa-quiet-recall-insight-timing-product-spec.md)。
- Surface/层级：[Bubble Spec](../../../product/specs/pagelet-bubble-readiness-and-recall-product-spec.md)
  与 [Pagelet Product Design](../../../product/pagelet-product-design.md)。
- 信任/反馈/耐久动作：[Data Boundary](../../../product/specs/pa-data-boundary-product-spec.md)、
  [Retrieval Habit Profile](../../../product/specs/pa-retrieval-habit-profile-product-spec.md)、
  [Saved Insight](../../../product/specs/pa-saved-insight-ledger-product-spec.md)。

## 2. 证据等级与不可混用边界

本 handoff 使用以下标签。Claude Code 在 Tracker 中必须沿用相同边界：

| 标签 | 含义 | 可以证明 | 不能证明 |
| --- | --- | --- | --- |
| `REAL-DESKTOP` | 当前构建在真实 Obsidian 桌面窗口的可见交互 | 视觉层级、间距、实际关闭/导航、侧栏遮挡 | iPhone touch、iOS safe area |
| `REAL-IPHONE-TOUCH` | 用户手指或可见 iPhone interaction 的实体触控 | 真实 tap/hold/menu action 结果 | 未触摸的 action callback 次数 |
| `REAL-IPHONE-VISUAL` | 真实设备画面；横屏通过 QuickTime 观看 | notch/safe-area/遮挡/可见布局 | iPhone Mirroring 的横屏触控（它不能旋转） |
| `INSPECTOR` | Safari Web Inspector 连接真实 Obsidian WKWebView | DOM、computed CSS、rect、overflow、console | 手感或物理手势 |
| `SOURCE` | 当前源码和现行 Product Spec | 可达路径、event ownership、合同冲突 | 用户实际看到/点到的结果 |
| `AUTOMATED` | Jest/type/lint/build/deploy/byte-match | 回归合同、构建与部署一致性 | 真机视觉或触控体验 |
| `ARTIFACT-MISSING` | 审查会话里看过真实界面，但未保留截图/rect JSON | 说明当时观察内容与复测起点 | 可独立追溯的视觉证据；closeout 前必须重测并留 artifact |
| `NOT-TESTED` | 本轮未执行 | 诚实保留 residual risk | 任何 PASS 声明 |

历史 B-108 证据在
[archived package](../../../archive/2026/pagelet-b108-dogfood-followup/README.md)；它是
回归输入，不替代本轮 F-01/F-02/F-03/F-04/F-10 的新事实。

### 2.1 本轮实际环境

- Mac 已解锁，真实 Obsidian 1.13.2/test vault 可操作；不是模拟器或静态截图审查。
- iPhone 15、iOS 26.5.2 已连接、解锁并进入真实 Obsidian iCloud `test` vault。
- portrait 实体触控通过 iPhone interaction 完成；Safari Web Inspector 连接真实
  WKWebView；iPhone Mirroring 无法旋转，所以 landscape 视觉用 QuickTime，DOM/CSS
  仍由 Inspector 读取。
- iOS Reduce Motion 已实际开启，Inspector 确认 media query 为 true。
- `make deploy-icloud` 成功；审查时口头记录 `main.js`、两个 manifest 与 `styles.css`
  均与 `dist` byte-match，但没有保留四条逐文件输出，不能单独证明 iPhone 已 reload
  当前 runtime。第 10 节给出修复后必须执行的可追溯部署身份检查。
- 当前自动化 baseline：160 suites / 3175 tests，lint/build PASS。该结果早于 B-118
  runtime 修复，只作为“构建健康但 UX 仍失败”的对照。

审查会话关键状态序列（用于避免把 blocker/证据混写）：Mac 起初处于锁屏，用户
解锁后才开始真实 Obsidian 检查；iPhone 随后完成连接与解锁；长按首先确认出现
`Capture / Review / Discover` 且当时没有 Bubble；iPhone Mirroring 无法旋转后改用
QuickTime 观察真实横屏；iOS Reduce Motion 明确开启；Bubble 也由用户明确打开后
再记录 portrait/landscape rect。任何复测都应重新记录这些前置，不能假设沿用。

## 3. 总体评分（跨桌面、iPhone 与源码证据的混合审查）

该表不是桌面视觉基线，也不是单一平台分数；每一项只总结本轮实际覆盖的证据。

| 维度 | 评分 / 5 | 结论 |
| --- | ---: | --- |
| Design Coherence | 4 | Pet → Bubble → Detail 的方向一致，局部动作语义漂移 |
| Visual Polish | 3 | safe area 和卡片基本成熟；小字号、侧栏遮挡、motion 有缺口 |
| Interaction Quality | 2 | 真机菜单项核心路径失败，Modal 被动关闭有副作用 |
| Content Clarity | 3 | Recall/Recap 有结构，但 Recap 首屏用准备状态遮蔽实际价值 |
| Quietness | 3 | 无声音/强弹窗队列；错误 Bubble toggle 与持续 blink 破坏安静感 |
| Trustworthiness | 2 | 二层合同审查发现 Recall/Discover provider 路径未证明通过 shared first-use gate，并存在标签/导航/反馈漂移 |
| Capture Friction | 2 | 长按 opener 好，但 Capture 菜单项在真实 iPhone 不执行 |
| Return Accuracy | UNSCORED | 本轮没有检索相关性、时机或语义质量证据；Recap 问题计入 Content Clarity / Progressive Disclosure / Trustworthiness |
| User Burden | 4 | 大多可关闭、不成队列；Modal close 强迫 Settings 是例外 |
| Progressive Disclosure | 3 | 四层模型保留，Bubble 第一层的内容/动作合同需修复 |

可见界面初评的 Trustworthiness 为 3/5；随后第二层产品合同审查确认 Quiet
Recall/Discover provider 路径没有可追溯的 shared first-use gate，因此最终 handoff
下调为 2/5。

最终判定：**FAIL / 必须修复后再声称 UI/UX 验证完成**。F-02/F-03/F-08/F-09
含真实桌面会话观察，但没有保留截图/rect artifact；这些观察完整保留为复测目标，
closeout 前必须重新采集可追溯 artifact。

## 4. Confirmed Findings

<a id="f-01"></a>
### F-01 · P1 · iPhone 长按菜单项 touch 冒泡，动作与 Bubble 同时失真

证据：`REAL-IPHONE-TOUCH` + `INSPECTOR` + `SOURCE`。

#### 用户实际看到的结果

- 实体长按约 520ms：**PASS**。出现 `Capture / Review / Discover`，没有 Bubble。
- 菜单约 3 秒自动收起：**PASS**。
- 实体点 `Capture`：菜单 item 的 click action 没有正常完成，Pet 根收到
  `touchend` 并切换 Bubble；Quick Capture 没有按预期打开。
- 实体点 `Discover`：同样未执行目标动作，却切换 Bubble。
- 实体点 `Review`：目标 Review 动作可发生，但 Bubble 也被额外切换。
- 因此问题不在 520ms recognizer 或菜单出现，而在 menu item → Pet root 的触摸
  ownership；不能重写整个 long-press 交互来“修复”。

#### 源码根因

- `src/pagelet/pet/PetView.ts:165-179`：Pet 根 `touchend` 总是 `preventDefault()`，
  未区分事件是否来自 `.pa-pagelet-pet-hold-menu`，未触发 hold 时直接
  `onToggleBubble()`。
- `src/pagelet/pet/PetView.ts:428-445`：菜单按钮只监听 `click` 并在 click 上
  `stopPropagation()`；它没有隔离先到达根节点的 `touchstart/touchend`。
- 现有 click-only 测试可以通过，但没有覆盖从真实 menu button dispatch 的完整
  TouchEvent → synthetic click 顺序。

#### 必须实现

- 让 Pet root 的 touch handlers 忽略来自 hold menu/menu item 的 event path；优先
  使用 `event.composedPath()` 或有界 `closest()` 判断，避免依赖脆弱 target cast。
- 菜单 item 自身显式拥有 `touchstart/touchend/click`，防止根 Bubble toggle；同时
  保留 400ms synthetic-click suppression，确保 callback 只执行一次。
- menu-origin `touchcancel`、位移超过 12px、多指触摸均必须取消选择：目标 callback
  `0`、Pet 根 `onToggleBubble` `0`；不能把滚动/拖动误判为菜单选择。
- menu-origin `keydown` 的 Enter/Space 只执行当前 item 一次，不得冒泡成 Pet 根
  toggle；执行后把焦点恢复到合理入口。
- 选择菜单项时先安全收起 menu，再执行一个 callback；3 秒 timer、outside
  pointer、destroy 都必须清 listener/timer 且执行零 callback。
- 保留 keyboard、desktop mouse、短点、520ms hold ring、三项顺序与 i18n。
- 保留 Pet 短点的 400ms synthetic-click suppression，以及 Bubble action 既有 12px
  movement threshold 与 500ms synthetic-click suppression；两个 ownership 模型不要
  混成同一个全局 timer。

#### 自动化验收

- 从每个真实 button 元素 dispatch production-like `TouchEvent` 的 `touchstart` +
  `touchend`，再 dispatch 浏览器可能产生的 click：Capture/Review/Discover 目标
  callback 分别 `1`，Pet 根 `onToggleBubble` 额外调用 `0`。Review/Discover 的目标
  callback 可以按现行 downstream 合同打开或更新 Bubble/Panel；禁止的是根节点多
  做一次 toggle，不是 downstream 改变内容。
- 短点 Pet：Bubble callback `1`，menu callback `0`；400ms 内 synthetic click 不
  二次切换。
- hold 519ms 无 menu；约 520ms 有唯一 menu；松手 Bubble 不变。
- `touchcancel`、>12px movement、多指、menu-origin Enter/Space、重复 touch/click
  都有独立断言；前三者目标 callback 与 Pet 根 toggle 均为 `0`，键盘路径目标
  callback `1`、Pet 根 toggle `0`。
- timeout/outside/destroy：menu 移除、timer/listener 清空、三个 callback 均 `0`。

#### 真机验收

- iPhone 竖屏分别重新长按并用**用户手指**点 Capture、Review、Discover；真机只
  证明目标结果可见一次、没有额外 Pet 根 toggle/闪烁。callback exactly-once 必须
  由自动化或 Inspector runtime counter 证明，不能从“一次 UI 出现”反推。
- Capture 可取消且不写笔记。Review 按当前 `reviewCurrentNote()` 合同可显示结果
  Bubble；Discover 也可按目标 route 更新 Bubble/Detail。验收的是目标结果出现且
  Pet 根额外 toggle 为零，不是强迫 Bubble 前后完全不变。
- 记录每一步输入来源：`USER-FINGER`、`MIRRORING-TAP` 或
  `INSPECTOR-SYNTHETIC`；只有 `USER-FINGER` 可记为实体触控。Review/Discover 使用
  第 8.1 节的 provider-free downstream fixture，不为触控验证发送 note text。

<a id="f-02"></a>
### F-02 · P1 · prepared Recap 没有通过 3 秒价值门

证据：`SOURCE` confirmed + `REAL-DESKTOP` session-observed + `ARTIFACT-MISSING`。

#### 用户实际看到的结果

prepared Recap Bubble 的首要文案是通用“PA prepared a short recap/PA 已准备一份
简短回顾”；真正值得看的 observation 被放在较弱的 inline hint，来源入口没有在
第一眼建立证据感。用户必须继续点击才知道内容，违反 DEC-018 的“点击后立即显示
最强具体 observation，不能只显示 prepared copy”。

#### 源码根因

- `src/pagelet/bubble/recap-card.ts:15-37` 已正确生成 candidate：
  `title=insight.title`、`body=insight.summary`、`sourceRefs`、`whyNow`。
- `src/pagelet/bubble/BubbleContent.ts:366-394` 却把 primary finding 固定为
  `pagelet.bubble.recapDelivery`，只使用 `candidate.title` 作为 `sourceTitle`，并把
  `whyNow[0]` 放到 inline hint；`candidate.body/sourceRefs` 没有成为主内容。
- 另有一个 **P2 合同/可读性项**：`src/pagelet/orchestrator.ts:990-1032` 的 Recap
  Detail 渲染 observations、sources、coverage，但没有把 artifact 的明确 scope 与
  `generatedAt` 作为可见元数据。本轮没有保留该伤害的可追溯桌面 artifact，因此
  不把它并入 P1 视觉结论；仍应按现行来源/新鲜度合同补齐并复测。

#### 必须实现

- primary finding 使用最强 candidate 的 `body`；标题/来源入口或 compact source
  count 必须可见并能进入证据，不能伪造不存在的 source。
- “已准备回顾”降为次级状态/label；`whyNow` 继续解释“为什么现在值得看”，不替代
  observation 本身。
- 保持 Bubble 一眼一条、内容有界；长内容可安全截断/换行，完整证据留在 Detail。
- Detail 补明确 scope、本地化生成时间、coverage 与对用户有意义的新鲜度说明；
  不直接显示 `stale/fresh`、cache/backend 等内部术语。
- 点击 View 使用当前 prepared artifact，不产生 duplicate provider call。
- 新增长内容 fixture：中英文长 observation、多 sourceRefs、长文件名、24px 字号，
  以及可同时存在的 context action。验证 `.pa-pagelet-bubble-text`、source、
  `whyNow`、`View/Later`、close、`.pa-pagelet-bubble-context-action` 的垂直间距、
  换行/截断/滚动；首屏主动作不能被内容挤到不可操作区域。

#### 验收

- DOM test 直接断言 candidate body、title/sourceRef 出现在 rendered Bubble；通用
  prepared copy 不是唯一或最强文本。
- real Obsidian 使用 deterministic prepared fixture：打开后三秒内能复述一条具体、
  来源支持且值得继续看的 observation。
- Detail 可见 scope、本地化生成时间、coverage/新鲜度，与当前 artifact 一致。
- 点击前后 provider call/attempt 数不增加；该计数是辅助证据，不替代可见结果。

<a id="f-03"></a>
### F-03 · P1 · Scope Recap Modal 的 X/Escape 被错误当成 Adjust

证据：`SOURCE` confirmed + `REAL-DESKTOP` session-observed + `ARTIFACT-MISSING`。

#### 当前行为

- `src/pagelet/recap/ScopeRecapAuthorizationModal.ts:20-24` 的注释称被动关闭是
  “Adjust/later”，不会成为 durable opt-out。
- 但 `onClose()` 在 `:96-101` 对未 settled 状态直接 `resolve("adjust")`。
- `src/pagelet/orchestrator.ts:1238-1245` 收到 adjust 后持久关闭
  `scopeRecapPreparationEnabled`、保存，并打开/刷新 Settings。
- 当前 `Run/运行` 文案看起来像一次性运行，但实际选择会持久开启后续有界后台准备；
  该 durable effect 没有在按钮文案/紧邻说明中明确。
- 真实 Escape/X 因而产生意外设置修改和窗口跳转；“我只是关掉弹窗”被解释为
  “替我调整设置”。

#### 已确认安全边界与 SG-06

- Run/Adjust/Cancel 是显式不同路径；X/Escape/backdrop/programmatic close 不是
  affirmative provider authorization，不能直接调用 provider，也不能被伪装成
  Adjust 后强制跳 Settings。
- `Run` 只授权当前运行，还是同时授权未来有界后台准备；Adjust/Cancel 的最终持久
  状态；被动关闭是否保存 pending marker，以及跨 session 的冷却、上限和自然触发
  点，均属于 `PRODUCT GATE SG-06`。当前 `promptedThisSession` 在显示前即置位，
  这只是需要记录的现状，不能被升级成新的同 session 验收合同。

| 退出路径 | 决定前必须成立 | SG-06 后补充 |
| --- | --- | --- |
| Run | 明确 affirmative 后才可 provider call | current-only 或 ongoing、setting/save effect、文案 |
| Adjust | 只有用户显式点击才可打开 Settings；直接 provider call `0` | pending/off 与保存策略 |
| Cancel | 只有用户显式点击才可 decline；直接 provider call `0` | declined/off 与保存策略 |
| X / Escape / backdrop / programmatic close | 不授权、不直接调用 provider、不跳 Settings | pending marker、save 与跨 session reprompt |

#### 验收

- Modal 单元测试覆盖 Run/Adjust/Cancel/X/Escape/backdrop/programmatic/重复 close，
  每个 promise 只 settle 一次，并逐格断言“决定前必须成立”；持久结果等 SG-06 后
  再补，不能用假设值让测试变绿。
- X/Escape：`openPageletSettings=0`、provider call `0`；authorization mutation `0`。
  `saveSettings`/pending marker 是否为零由 SG-06 决定，当前不先写死。
- SG-06 后，Run/Adjust/Cancel 的中英文 CTA 与紧邻说明必须准确区分一次运行、未来
  后台效果、设置调整和 decline；不能只靠长段落让用户猜。
- 真实 Obsidian 独立 Settings 窗口保持原状态且不会被被动打开。
- 记录被动关闭后同 session 与 reload 后的**当前**重弹行为；SG-06 决定前不改变、
  不把它标为 PASS，跨 session/presentation/reprompt 均记 `BLOCKED`。

<a id="f-04"></a>
### F-04 · P2 · Reduce Motion 仍持续 blink，Pagelet motion 覆盖不完整

证据：`INSPECTOR` + `SOURCE`。iOS Reduce Motion 确实开启，但 blink FAIL 来自真实
WKWebView 的 computed style；本轮没有保留足以升级为 `REAL-IPHONE-VISUAL` 的持续
观察 artifact。

#### 本轮事实

- iOS `matchMedia('(prefers-reduced-motion: reduce)').matches === true`。
- Pet wrapper float 的 computed animation duration 为 `0s`，hold menu animation 为
  `none`：这两项 **PASS**。
- idle/nudge blink group 仍为 `pa-pagelet-pet-blink 5s infinite`：**FAIL**。
- `src/custom.pcss:5620-5626` 只覆盖 `.pa-pagelet-pet-svg-wrap`、
  `wrapper::before`、notification；`src/custom.pcss:5892-5915` 的 blink/working dots/
  resting zzz 等 descendant animation 并没有全部被直接停掉。

#### 必须实现

- reduced-motion media query 明确覆盖以下 selector/pseudo-element：
  - `.pa-pagelet-pet[data-state=idle] .pa-pagelet-pet-blink-group` 与 nudge blink group；
  - working `.pa-pagelet-pet-dot-1/-2/-3`、task-specific SVG wrap、
    `.pa-pagelet-pet-wrapper::before` task ring；
  - resting `.pa-pagelet-pet-zzz1/-zzz2` 与 sleep decoration；
  - nudge `.pa-pagelet-pet-svg-wrap` 与 `.pa-pagelet-pet-notification`；
  - `.pa-pagelet-pet[data-capture-hold=true]::after` 与 `.pa-pagelet-pet-hold-menu`；
  - `.pa-pagelet-bubble` open/close scale/translate，以及 rich action hover 的
    `translateY(-1px)`。这两类 Bubble motion 已在 B-118 Product Spec 中纳入，SDD
    只能设计实现与验收，不能降级成可选项。
- 停止 motion 不等于隐藏状态：working/nudge/resting 仍要用静态颜色、opacity、
  icon/shape 表达。
- 所有 touch/click/hold timer 逻辑保持原时序；Reduce Motion 只改变表现，不应把
  520ms 交互阈值改成 0。

#### 验收

- provider-free state fixture 生成 idle、working、nudge、resting 与 hold/menu；逐项
  读取 `animation-name/duration/iteration-count` 和 transition/transform。验收为无
  `infinite`，或 `animation-name:none` / duration `0s`；Bubble motion 同样在 reduce
  下没有可见 scale/translate 位移。
- macOS 与 iOS 真机分别验证上述静态状态仍可区分；iPhone 上重新做短点、长按和
  三个 menu actions。正常 motion 下复核 F-09 reposition 后 tail/transform-origin
  不跳位。

<a id="f-05"></a>
### F-05 · P2 · Quiet Recall 标签、路由和反馈动作不一致

证据：`SOURCE`。本轮没有执行 provider-backed Quiet Recall live smoke，不能升级为
真实 provider UI 结论。

#### 当前漂移

- `src/pagelet/bubble/BubbleContent.ts:270-301` 的 DeliveryCandidate 主按钮使用
  `Open source note` 文案并调用 `callbacks.onOpen(candidate)`。
- `src/pagelet/orchestrator.ts:2366-2372` 的实际 callback 会清 nudge、记录 view，
  然后 `runQuietRecall()`；它重新运行 Recall 并打开 Tab，不是打开 source。
- `src/pagelet/orchestrator.ts:2403-2409` 已有 dismiss handler，但 Bubble actions 没有
  把它暴露给用户；Not relevant 没有 Bubble 入口。
- `src/pagelet/tab/sections/QuietRecallSection.ts:316-383` 当前主要是 Link/Save，反馈
  完整性仍不足。
- `pagelet.bubble.quietRecall.dismiss` 的中文当前是“不再提醒”，但 Dismiss 合同只是
  弱语义的“忽略这次”；该翻译错误暗示永久 suppression。
- `src/pa/retrieval-habit-profile.ts:284-289` 当前把 View 记为 `+1`、Later 记为
  `-0.5`，并让 feedback 同时作用于 relation、strength 和全部 source。现行合同中
  View 不是 keep、Later 只是推迟；Not relevant 的学习粒度此前未被产品决定。
- 旧 Bubble Spec 曾规定 Open source/Link/Later；Quiet Recall Spec 规定
  View/Dismiss/Not relevant/optional Later。这个冲突本身是事实，但 Link 的最终层级、
  Not relevant 的具体影响范围与 Later 的耐久语义必须分别由
  `PRODUCT GATE SG-02/SG-03/SG-04` 解决，不能由实现者挑一个文档覆盖另一个。

#### 可立即修复的安全不变量

- 当前 action label 必须与真实 route 一致；任何明确标为 View/Detail 的导航不得
  隐藏地重新运行 provider-backed Recall。到底以 `View recall` 还是 `Open source`
  为 primary、独立 source action 放哪一层，属于 SG-02。
- source 不存在/失效时给诚实、可恢复反馈，不得静默重跑 provider。
- RHP 关闭时 Dismiss/Not relevant 不能写入或影响 habit profile。RHP 已显式 opt-in
  时，暂时只沿用现行 RHP 的 local/clearable/weak-influence 与既有 aggregate
  retention 合同；
  View/Later/Dismiss/Not relevant 的具体权重、exact-source 或 similar source/topic/
  trigger downrank 粒度属于 SG-03，决定前不改变现有 aggregate。不得把现有 profile
  retention 解释成新的 Not relevant retention 决定。
- Later 若保留，必须遵守 Quiet Recall 与 Saved Insight 的现行合同：这是明确 return
  intent，可能创建 Review Queue handoff/lightweight draft；不得擅自改成“24 小时且
  永不入队”。具体 snooze/queue/draft 行为属于 SG-04。
- Link/Save 属于耐久动作，产品方向倾向留在 Panel/Tab 确认流程；Bubble Spec 的旧
  Link 表与 Quiet Recall Spec 冲突，最终是否从 Bubble 移除由 SG-02 决定。在决定前
  不要改写 action hierarchy。
- 当前中文 Dismiss“不再提醒”与弱 dismiss 合同不符，但最终文案必须随 SG-03 的
  实际效果一起决定；决定前不要保留永久承诺却实现短期效果，反之亦然。
- X、Escape、点外关闭保持 neutral：不记 dismiss/not relevant、不建 queue、不
  产生“未处理”债务。

#### 验收

- 决策前先建立现状 characterization table：每个 label 的实际 route、provider call、
  write、RHP 与 queue 副作用；所有明确 View/Detail 路径 provider rerun `0`，passive
  close feedback/write/queue `0`。
- RHP disabled 时所有 learning write/influence 为零；RHP enabled 时沿用现行 aggregate
  直到 SG-03 批准新规则。Link action hierarchy 按 SG-02，Later 按 SG-04。
- SG-02..04 决定后，再为最终每个动作补 label—route—feedback—write/cost table 与
  provider-free visible smoke；未决定时对应 action 改动标 `BLOCKED`。
- stale/missing source、candidate 已过期和 cache 不存在时不得静默重跑；显示诚实
  fallback 或退出。
- provider-free deterministic fixture 完成 desktop visible smoke；只有明确授权后
  才做真实 provider 补充验证，并记录发送内容与成本。

<a id="f-06"></a>
### F-06 · P2 · stale/disable 路径可留下没有内容的 working/nudge Pet

证据：`SOURCE` + 现有状态机合同；本轮未在真实 UI 人工制造所有 race。

#### 当前路径

- `src/pagelet/orchestrator.ts:666-688`：Quiet Recall 在 `analysis-start` 后，如果 route
  token、active note snapshot 或 source/policy 失效，会提前 return；这些 return
  没有 `analysis-done`。
- Scope Recap retry 的 stale return 也有同类所有权风险。
- `src/pagelet/orchestrator.ts:2170-2208` 可在 Focus Mode/setting gate 关闭时清 Recall
  payload，但清除本身不保证 Pet 从 nudge 回 idle。
- `src/pagelet/pet/PetStateMachine.ts:59-106` 只根据显式 event/forceState 转换；如果
  owner 不发送 settle event，working/nudge 可持续。
- Scope Recap 的后台 preparation 当前也没有稳定驱动 Pet `working`；Pagelet
  Product Design 要求可见 Pagelet 在后台准备期间用轻量 working 表达正在处理，
  但完成、stale、disable 后必须立即收敛，不能形成常驻噪声。

#### 必须实现

- 明确 foreground route / nudge owner token；只有当前 owner 可以提交结果或 settle
  自己的状态，旧 owner 不得覆盖新 route。
- 所有 stale、cancel、timeout、disable、Focus Mode、teardown path 都有统一的
  finally/settle helper，使 Pet 回到与剩余可交付 payload 一致的 idle/nudge 状态。
- 不要用全局无条件 `forceState("idle")` 破坏另一个同时已就绪的 Recap/Pattern
  nudge。
- 将 background preparation 纳入同一 owner-aware lifecycle：开始时仅在 Pet 可见且
  没有更高优先级 foreground owner 时显示 working；成功、失败、stale、取消或
  disable 都 settle 到当前真实 delivery state。

#### 验收

- active note 中途切换、route token 失效、Recall/Hint/Focus 开关变化、destroy、
  timeout/error 的交错测试均断言最终 Pet state 和 payload owner。
- real Obsidian 做至少一个“运行中切 note”和一个“nudge 后开 Focus Mode”烟测，
  观察 Pet 不再假装工作/有结果。
- 用 deterministic Recap background fixture 观察 working → idle/nudge 的完整路径，
  不为状态烟测调用真实 provider。
- 单独覆盖 background lifecycle：开始、与 foreground owner 的优先级竞争、成功产生
  delivery、成功但低质量保持 idle、失败、stale、用户取消、设置关闭与 teardown；
  每条都断言 state、payload owner、timer/listener 和最终可交付内容一致。

<a id="f-07"></a>
### F-07 · P2 · 普通用户没有 proactive Quiet Recall 的三档设置入口

证据：`SOURCE` + 当前 Product Spec。

#### 当前漂移

- `src/settings.ts:144-152`：Quiet Recall 默认 `enabled=true`，但
  `bubbleNudgesEnabled=false`。
- `src/pagelet/orchestrator.ts:2170-2176`：自动 nudge 同时要求 pagelet、pet、generic
  proactive hints、Quiet Recall enabled 和 bubble nudges 全部开启。
- `src/settings/pagelet/index.ts` 当前 Scope Recap 区域约从 `:1370` 开始，但没有
  Quiet Recall `Off / Quiet / Balanced` 控件；普通用户无法理解或开启现行 Spec 的
  proactive flow。
- Quiet Recall Product Spec 的 QR-D8 已明确三档且默认 Off；但它没有决定三档的
  精确展示频率、context cooldown、旧 boolean 迁移或与 generic hints 的全部映射。

#### 已确认边界

- 默认必须 fail closed 为 Off，不得从 generic proactive hints 推断 opt-in；显式
  Quiet Recall/Discover 的可达性与 proactive opt-in 是两件事。
- UI 最终只暴露产品级 `Off / Quiet / Balanced`，不把多个内部 booleans 原样交给
  用户；具体频率、context fingerprint cooldown、legacy `bubbleNudgesEnabled=true`
  的迁移，以及是否保留 generic hints 父门，属于 `PRODUCT GATE SG-01`。
- 在 SG-01 决定前，Claude Code 可以补测试夹具/设置映射设计，但不得写入任意
  1/24h、3/day、4h、7d 数值或静默迁移。若这阻止可用实现，Tracker 记 `BLOCKED`。
- 任何非 Off 档位仍必须受已存在的 quality gate、quiet hours、Focus Mode、每
  candidate 一次与 provider actual-call budget；最终 display/context cap 必须在
  provider evaluation 前生效，避免为不可展示结果付费。
- generic proactive hints、Scope Recap high-value hints 与 Quiet Recall 不能被一个
  UI 选择静默同时打开。说明 note text 可能发送给已配置 provider，并说明调用/
  credits 成本；普通 UI 不出现 VSS/RAG/backend jargon。

#### 验收

- SG-01 决定后，default、legacy data、upgrade/reload、Off→Quiet→Balanced→Off
  fixture 全覆盖；不出现静默 opt-in。fake clock 证明批准的 display/context cap 在
  provider evaluation 前生效。
- Settings 中英文、14/16/24px、窄屏无溢出；开关后当前 nudge/state 立即正确收敛。
- 本 track 保留现有 Quiet Recall 产品名称；改名为 Recall/Related/Connections 等是
  独立产品决定，不在实现中顺手更名。

<a id="f-10"></a>
### F-10 · P1 · Quiet Recall/Discover provider note reading 未证明通过 shared Data Boundary gate

证据：`SOURCE` + Data Boundary current contract。该问题来自二层产品合同审查；
本轮没有为验证它而发送真实 note text。

#### 当前风险

- `src/plugin.ts:3733` 起的 `runQuietRecall()` 会读取 active note content，并收集
  related/vault notes 后进入 provider-backed why-now evaluation。
- 当前 Quiet Recall/Discover 路径没有像 Scope Recap 那样在首次 provider-backed
  note reading 前展示 scope、included/skipped、provider/model、note text 传输、
  成本和 `Run / Adjust / Cancel`。
- `docs/product/specs/pa-data-boundary-product-spec.md` 明确要求首次 provider-backed
  note reading 和 broad/costly/sensitive runs 披露上述信息。
- 当前 shared Data Boundary 合同要求 PA 各 surface 共用来源排除、provider disclosure
  与 cleanup 体系；但现有文档没有明确“Scope Recap 的一次授权是否可覆盖后续小范围
  Recall/Discover”，不能擅自推断可复用或必须 feature-specific。

#### 必须先建立的安全边界

- 所有 Quiet Recall/Discover provider 路径先进入现有 shared Data Boundary gate；
  无法证明当前运行已有有效授权时 fail closed，provider call `0`，而不是先发再补 UI。
- 保留 current contract：首次 provider-backed note reading 需要披露；broad、sensitive、
  costly run 每次按需重新披露；临时包含 excluded scope 必须 one-run explicit override。
  已授权的低风险小范围运行不应每次重复 heavy disclosure。
- 纯本地 Discover clue：不弹 provider disclosure、不调用 provider，并继续使用
  `Local related clue/本地关联线索` 的来源标签。
- “本地证据足够”与“继续 AI why-now”的可执行判据、共享首次授权的复用范围、未来
  proactive runs 的 included/skipped scope 与授权寿命，属于 `PRODUCT GATE SG-05`。
  不要新增 feature-specific authorization store 或把 Scope Recap 状态迁移成通用授权。

#### 验收

- first-use、已有 shared authorization、broad/sensitive/costly、excluded-scope override、
  cancelled、passive close、provider/model changed、Data Boundary changed、reload/
  upgrade 的 state matrix；每条都用 provider spy 断言调用次数。
- 在 SG-01/SG-05 决定前，不实现 Quiet/Balanced 的持久授权语义；任何 Cancel/X/Escape
  都必须零 provider call，explicit one-run override 不能静默改变 proactive mode。
- disclosure 中英文、窄屏、14/16/24px 可读；说明 scope、skipped、provider/model、
  note text、实际适用的 call cap 与 credits/API cost；不能把未来未批准的 scope/cap
  写进确认文案。
- 真实 provider smoke 只有在用户明确同意本次测试数据和成本后才可执行；自动化
  provider spy 足以关闭代码 gate，但不能冒充真实 UI disclosure smoke。

<a id="f-08"></a>
### F-08 · P2 · 14px 基准下正文与辅助文字低于合理可读下限

证据：`SOURCE` + computed value + `REAL-DESKTOP` session-observed +
`ARTIFACT-MISSING`。

#### 当前事实

- `src/custom.pcss:3904-3912` 把 Pagelet token 绑定到 Obsidian
  `--font-text-size`，总体方向正确。
- `src/custom.pcss:4049-4063` 的 source link 使用 `0.6875 × base`；14px 时为
  **9.625px**。
- `src/custom.pcss:4011-4018` 的 Bubble item/body 使用 `0.84375 × base`；14px 时约
  **11.81px**。
- `.pa-pagelet-bubble-inline-hint` 与 `.pa-pagelet-bubble-btn` 使用
  `--font-ui-smaller`，审查环境约 **10.5px**；`.pa-pagelet-bubble-btn-label`、
  `.pa-pagelet-bubble-context-action-label/btn` 使用 `--font-ui-small`，约
  **11.38px**。
- `src/custom.pcss:4309-4314` 的 action description 使用 `0.71875 × base`；14px 时
  约 **10.06px**。
- 当前真实桌面可读性偏弱，尤其在暗色、次级色和高密度来源 pill 中。

#### 必须实现

- 保留用户字体设置随动，但让 body、inline hint、button/description、source、
  context label/button 等文本的可读下限约 12px；优先使用
  现有 Obsidian UI tokens 或 `max()`，不要给全部 Pagelet 写死单一 px。
- 保持主次层级：辅助文案可以更弱，但不能依赖低到难读的字号表达 quietness。
- 检查中英文、长文件名、来源 pill、button description、hover/focus。

#### 验收

- 自动化遍历 14/16/24px × light/dark × zh/en 的 computed matrix；目标元素不低于
  约 12px，24px 仍合理放大。
- 可见 smoke 用代表性 pairwise，避免制造 12 组重复截图：14px/dark/zh、
  16px/light/en、24px/dark/中英长文本。保留 Tab h2/h4/body/tag/source/action 与
  insight-card hover 无布局位移检查。

<a id="f-09"></a>
### F-09 · P3 · 桌面 Bubble 与右侧栏约重叠 142px

证据：`REAL-DESKTOP` session-observed + `SOURCE` + `ARTIFACT-MISSING`。

#### 当前事实

Bubble 已按 workspace overlay container bounds 做 clamp，并非完全按 viewport；缺口是
没有进一步按 active Markdown leaf 的实际可用区约束。右侧栏打开时会话观察到约
142px 交叠，但没有保留 Bubble/sidebar/leaf rect artifact。当前内容仍可看到，因此
维持 P3；若复测证明 close/action 或 sidebar control 不可操作，立即升为 P2。

#### 必须实现

- 在既有 overlay clamp 之上，让 desktop placement/clamp 依据 active Markdown leaf
  或其可用 workspace region；跟随 sidebar open/close、split leaf、resize。
- 保留 Bubble 尾部/transform origin 的合理关系，避免 open/close 动画跳位。
- CSS/DOM placement change 必须 scoped；不得修改已通过的
  `.pa-pagelet-bubble--mobile` portrait/landscape safe-area rules。

#### 验收

- 右侧栏关闭/打开、左侧栏打开、双分栏、窄窗口、resize 后记录 overlay、active
  leaf、sidebars 与 Bubble rect/实际交集；Bubble 完整可见且不遮住关键 sidebar
  control，close/action 可点。
- 移动 portrait/landscape 精确回归下方 baseline，无横向 overflow。

## 5. 已通过且必须保留的 UI 细节

以下是当前构建的正向基线。它们不是“无需再测”，而是修复后必须继续通过。

### 5.1 Desktop / Obsidian

- 真实 Obsidian test vault 可打开 Pagelet，Pet 入口、Bubble、Panel/Tab 基础层级存在。
- 既有 B-108 桌面 evidence 覆盖 16px/24px、亮/暗主题、Panel/Detail/Bubble reflow、
  macOS Reduce Motion settled UI；本轮审查没有发现全局 layout 崩坏。
- 当前需要保留：键盘 Enter/Space、短 click、hover/focus、light/dark、中文/英文、
  Settings 独立窗口、active Markdown leaf ownership。
- 但本轮 F-02/F-03/F-08/F-09 已推翻“当前桌面 UX 全部 PASS”的宽泛说法。

### 5.2 iPhone 竖屏：430×932

证据：`REAL-IPHONE-TOUCH` + `INSPECTOR`。

| Surface | 实测 rect / 状态 | 判定 |
| --- | --- | --- |
| Body | viewport `430×932`；`is-mobile is-ios is-phone` | 真实 phone renderer |
| Obsidian sidebar button | `[12, 59, 44, 44]` | 44×44 |
| Pagelet Pet | `[56, 59, 44, 44]` | 与 sidebar 相邻、无重叠 |
| Short tap | 一次打开、再次一次关闭 Bubble，最终状态稳定 | PASS，无 duplicate toggle |
| Bubble | `[8, 710, 398, 108]`，底部约 114px | PASS，无横向 overflow |
| Bubble close | `[351, 721, 44, 44]` | PASS，44×44 |
| Bubble action | `[27, 745, 360, 54]` | PASS，可触控 |
| Hold menu | `[56, 111, 91.94, 146]` | PASS，可见且未越界 |
| Hold menu items | Capture/Review/Discover 各约 44px 高 | PASS，target size |
| 520ms opener | 菜单出现，Bubble 不出现 | PASS |
| 3s timeout | 菜单自动消失 | PASS |

注意：表中 opener/layout PASS 不抵消 F-01 的 menu item action FAIL。
本轮没有保留 `visualViewport.width/height/offsetLeft/offsetTop`、截图路径或 rect JSON；
因此这些数字是会话观察基线，不是可独立追溯 artifact。修复后必须按第 10 节重新
采集，不能只复制本表。

### 5.3 iPhone 真实横屏：约 932×430

用户明确指出 iPhone Mirroring 无法横屏，因此本轮采用：

- QuickTime：真实设备横屏可见画面与遮挡判断；
- Safari Web Inspector：同一个真实 Obsidian WKWebView 的 DOM、computed CSS、rect、
  document overflow；
- 不声称完成了 Mirroring 横屏触控手感。

| Surface | 实测 rect / computed state | 判定 |
| --- | --- | --- |
| Body | viewport `932×430`；`is-mobile is-ios is-phone` | 真实 phone renderer |
| Pet | `[115, 12, 44, 44]` | PASS，safe area 内 |
| Bubble | `x=226, y=222, w=480, h=108` | PASS，左右各约 226px |
| Bubble bottom gap | 约 100px | PASS，不压 Home indicator |
| Close | `[651, 233, 44, 44]` | PASS |
| Primary action | `[245, 257, 442, 54]` | PASS |
| Document | client/scroll width `932/932`，height `430/430` | PASS，无横/纵 document overflow |
| Bubble CSS | absolute；computed left/right 约 59px；width/max-width 480px；max-height 约 290px；overflow auto | PASS |

对应 CSS 在 `src/custom.pcss:4368-4384`。B-118 的 desktop placement 改动不得破坏
这组 mobile landscape 规则。

横屏 hold menu 若曾通过 Inspector 合成状态观察，只能标记 `INSPECTOR-SYNTHETIC`；
本表没有把它计为用户手指横屏触控。本轮也未保留 QuickTime 文件/截图路径与
`visualViewport` JSON，修复后需要重新采集可追溯 artifact。

### 5.4 iOS Reduce Motion 的已通过部分

- `matchMedia(...reduce).matches === true`。
- Pet wrapper 的主要 float duration 为 `0s`。
- hold menu `animation-name: none`。
- 以上均为真实 WKWebView 的 `INSPECTOR` computed evidence，不是持续视觉观察。
- 已确认 FAIL 是 blink group 仍 `5s infinite`；Bubble open/close 与 rich action transform
  是补充审计项。不要删除已正确规则；按 F-04 扩展覆盖并逐项记录。

## 6. 源码与测试定位表

| Surface | 生产代码 | 现有/应补测试 |
| --- | --- | --- |
| Pet root touch + hold menu | `src/pagelet/pet/PetView.ts:137-180,393-477` | `__tests__/pagelet-pet-state-machine.test.ts`：补 menu-origin TouchEvent |
| Pet state | `src/pagelet/pet/PetStateMachine.ts:59-106`、`src/pagelet/orchestrator.ts` | orchestrator interleaving + final state assertions |
| Recap candidate | `src/pagelet/bubble/recap-card.ts:15-37` | candidate mapping tests |
| Recap Bubble | `src/pagelet/bubble/BubbleContent.ts:366-394` | `pagelet-bubble-content.test.ts` DOM/content hierarchy |
| Recap Detail | `src/pagelet/orchestrator.ts:990-1032` | orchestrator/panel tests for scope/localized generatedAt/coverage/freshness copy |
| Bubble touch/action | `src/pagelet/bubble/BubbleView.ts` touch suppression path | `pagelet-bubble-view.test.ts` exactly-once |
| Authorization Modal | `src/pagelet/recap/ScopeRecapAuthorizationModal.ts:25-106` | `scope-recap-authorization-modal.test.ts` six-way close matrix |
| Authorization persistence | `src/pagelet/orchestrator.ts:1210-1255` | `pagelet-orchestrator.test.ts` no-mutation passive close |
| Recall actions | `src/pagelet/bubble/BubbleContent.ts:270-301`、`orchestrator.ts:2348-2420` | content/coordinator/orchestrator call-count + feedback |
| Recall Detail | `src/pagelet/tab/sections/QuietRecallSection.ts` | panel/tab DOM actions and stale source |
| Recall learning | `src/pa/retrieval-habit-profile.ts:259-290` | feedback-specific source/relation/strength weight tests |
| Recall settings | `src/settings.ts:144-152`、`src/settings/pagelet/index.ts` | settings defaults/migration/DOM/locale |
| Recall provider gate | `src/plugin.ts:3733+`、Data Boundary helpers | shared first-use/broad/sensitive/costly/excluded-scope gate + provider spy；SG-05 后补复用 |
| Typography/mobile Bubble | `src/custom.pcss:3904-3912,4049-4063,4309-4384` | CSS artifact assertions + real UI matrix |
| Pet animations/menu | `src/custom.pcss:5620-5626,5772-5915,6000-6035` | reduced-motion selector matrix + real iPhone |

## 7. 推荐开发 slices 与 review gate

### Slice A — Pet touch ownership（P1）

- 只改 Pet event ownership、相关 tests，必要时加小型 helper。
- Review：touch/click ordering、keyboard、timer/listener teardown、desktop/iOS parity。
- Exit：focused tests + real iPhone Capture/Review/Discover 各一次；Pet 根额外
  `onToggleBubble=0`，但目标 downstream 可按现行合同改变 Bubble/Panel。

### Slice B — Recap first-screen + authorization close（P1/P2）

- 让 actual recap body/source 成为 primary，Detail 补 scope/generatedAt；为 Modal 增
  passive close 安全分支；Run/Adjust/Cancel 的持久效果与文案等 SG-06。
- Review：3 秒价值、source truth/metadata、provider call count、pending/declined/
  adjust persistence。
- Exit：DOM、Modal/orchestrator focused tests + real desktop visible smoke。

### Slice C — Provider fail-closed boundary（P1 / PRODUCT GATE）

- 先让 Quiet Recall/Discover provider call 统一经过 shared Data Boundary gate；无法
  证明授权时零调用，local clue 保持 local。
- 不新增 feature-specific store，也不自行决定 authorization reuse/proactive scope；
  到 SG-05 停止并请用户决定。
- Exit：provider-spy 证明所有未授权路径零调用；SG-05 未决时状态为 `BLOCKED`，不能
  把 fail-closed 当成完整 disclosure UX 已交付。

### Slice D — Motion + Pet convergence（P2）

- 完整 reduced-motion selectors；owner-aware stale/disable settle。
- Review：不要无条件 idle 覆盖另一个有效 nudge；不要把 UI motion 与 hold timing 混合。
- Exit：interleaving tests + macOS/iOS motion + one real stale/Focus flow。

### Slice E — Quiet Recall characterization + gated repairs（P2 / PRODUCT GATE）

- 可直接修：被动关闭 neutral；明确 View/Detail 导航不得隐藏地重跑 provider；
  stale source 不静默重跑。其余先做现状 characterization。
- SG-01 决定 settings frequency/migration；SG-02 决定 action/Link hierarchy；SG-03
  决定 feedback 粒度；SG-04 决定 Later；SG-05 决定 shared disclosure mapping。每个
  gate 可独立阻塞，不得把它们捆成一次自作主张的实现。
- Review：provider call count、RHP opt-in、Saved Insight queue contract、passive close、
  generic/Recap hint independence、locale。
- Exit：无 gate 的修复通过 provider-free deterministic UI；已获决定的行为再补自动化
  matrix。真实 provider 仅在明确授权时补做。

### Slice F — Typography + desktop placement（P2/P3）

- 提高辅助文字 floor；active-leaf placement/clamp。
- Review：CSS scope、14/16/24px、light/dark、zh/en、sidebars/splits、mobile media rules。
- Exit：desktop visual matrix + portrait/QuickTime landscape regression。

如果后续用户授权 commits，建议按以上 slice 拆分，不把全部 runtime/CSS/docs 压进
一个 commit。当前不执行 Git 写入。

### 7.1 PRODUCT STOP GATES — Claude Code 必须停下询问

| Gate | 未决产品判断 | 已确认的安全默认 |
| --- | --- | --- |
| SG-01 | Quiet/Balanced 的精确 display/context caps、legacy true 迁移、generic hints 父门 | 默认 Off；不迁移、不声明假定频率；provider budget/quality/quiet/Focus gate 保留 |
| SG-02 | Recall Bubble 最终 action taxonomy，View/Open source/Link/Save/Later 的优先级与 Bubble/Detail/Panel 落点 | 保留现行动作表；只修明确的重复 provider call/误触发，先记录 label-route 副作用 |
| SG-03 | Dismiss/Not relevant 在 RHP opt-in 后的 downrank 粒度、保留期与权重 | RHP disabled 时零 collection/influence；enabled 时沿用现行 local、clearable、weak-influence aggregate |
| SG-04 | Later 的具体 snooze、Review Queue / Saved Insight draft 行为 | 保留 Saved Insight 的 explicit return intent，不擅自改成无队列 24h snooze；动作落点归 SG-02 |
| SG-05 | shared first-use authorization 的跨 feature 复用、版本迁移、proactive future scope、local clue 升级判据 | first-use + broad/sensitive/costly disclosure；excluded-scope one-run override；无法证明授权就 fail closed |
| SG-06 | Scope Recap Run 是 current-only 还是 ongoing，以及 passive close 的持久状态/重询策略 | 被动关闭不授权、不直接 provider call、不强制跳 Settings；现有重弹行为只做 characterization |
| SG-07 | Quiet Recall 最终名称、Explicit Discover 是否总先进入 Detail、普通 Intentionally Quiet Bubble 的 3 秒价值 | 不在 B-118 顺手改名或重做 IA |

获得用户决定后，先更新 Decision/Product Spec/SDD/Tracker，再写相关 runtime；未获决定
时保留 `BLOCKED`，不要用“推荐值”伪装成 accepted contract。

## 8. 自动化与静态验证矩阵

### 8.1 可复现的 provider-free downstream fixture

触控与路由 smoke 不得依赖真实 provider。按以下合同执行；历史参考是
[B-108 provider-free downstream handoff](../../../archive/2026/pagelet-b108-dogfood-followup/handoff-pagelet-v29-validation.md)，
但本轮必须重新记录当前 runtime 的证据：

1. 明确把 repo `test/pagelet-smoke-golden.md` 与 `test/Pagelet Smoke Test.md` 同步到
   iCloud `test` vault；`make deploy-icloud` 只部署插件资产，不会替你复制 smoke note。
   打开 `pagelet-smoke-golden.md`，先确认 `[[Pagelet Smoke Test]]` 可解析。
2. 在 SDD 写清最窄、可逆的 Review analysis 与 Discover provider/VSS seam。fixture
   返回 deterministic、source-backed 的 Review finding 和 `Existing wikilink` local
   connection；不得修改 production source 来“方便 smoke”。
3. 安装临时 runtime counters：`petRootToggleCalls`、`captureCalls`、`reviewCalls`、
   `discoverCalls`、`providerCalls`、`writeCalls`，并记录测试前后 cost/token snapshot、
   `.pagelet/` 文件集与 Quick Capture target。目标是各菜单 callback `1`、Pet 根额外
   toggle `0`、provider/write/cost delta `0`。
4. 可见 selector：Capture `.pa-quick-capture-modal`；Review
   `.pa-pagelet-bubble[data-content-type="writing-assist"]`（需要时继续到
   `.pa-pagelet-panel`）；Discover 按目标 route 检查
   `.pa-pagelet-bubble[data-content-type="discovery"]` 或
   `.pa-pagelet-tab-graph-discovery`。只接受与当前 route 合同一致的一个结果。
5. 如果找不到可逆、零 provider 的 seam，**不要**为了完成矩阵点击 Review/Discover；
   标记 `BLOCKED: no provider-free seam`，等待新的测试数据/成本授权。
6. smoke 后恢复原 methods/session state，移除 counters/seams，关闭结果 UI，reload，
   再检查 source notes、Quick Capture target、`.pagelet/` 文件集、provider/write/cost
   delta 和 fresh console；任一残留都不能记 PASS。

先按 slice 跑 focused suites；最终至少包含：

```bash
npm test -- --runInBand \
  __tests__/pagelet-pet-state-machine.test.ts \
  __tests__/pagelet-bubble-content.test.ts \
  __tests__/pagelet-bubble-view.test.ts \
  __tests__/pagelet-bubble-coordinator.test.ts \
  __tests__/scope-recap-authorization-modal.test.ts \
  __tests__/pagelet-orchestrator.test.ts \
  __tests__/pagelet-settings.test.ts \
  __tests__/pagelet-panel-tab-view.test.ts \
  __tests__/quiet-recall.test.ts \
  __tests__/quiet-recall-evaluation.test.ts \
  __tests__/retrieval-habit-profile.test.ts \
  __tests__/data-boundary.test.ts

npx tsc -noEmit -skipLibCheck
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

`rg` 无输出且 exit 1 是 PASS。CSS/i18n/DOM 改动完成后使用 `make deploy` 做全量
Jest/lint/build/Tailwind/deploy，再进入真实 Obsidian UI；不要为早期单 slice 无必要
反复跑 full build。

最低新增断言：

- menu-origin TouchEvent、synthetic click、touchcancel/movement/multi-touch/keyboard、
  callback exactly once、Pet 根额外 toggle zero；
- Recap body/title/sourceRefs 主层级 + Detail scope/localized generatedAt/coverage/
  freshness 产品文案；
- Modal passive close no affirmative authorization/direct provider/forced Settings；
  Run/Adjust/Cancel 与 reprompt 的持久断言等 SG-06；
- Recall 当前 route/feedback characterization；明确 View/Detail provider rerun zero；
  SG-02 决定后再断言最终 action/Link hierarchy；
- RHP disabled 零 collection/influence；SG-03 决定后再断言具体 action weight 与
  Dismiss/Not relevant 影响范围；SG-04 决定后断言 Later/queue 行为；
- stale/disable/background-preparation Pet final state；
- Quiet Recall settings 默认 fail closed；SG-01 决定后补 migration 与批准的 display/
  context caps；
- shared Data Boundary first-use + broad/sensitive/costly + excluded-scope override 的
  provider-spy matrix；SG-05 决定后补授权复用/proactive scope；
- reduced-motion selector coverage；
- active-leaf placement 的 desktop DOM geometry helper（若采用）。

## 9. 真实 Obsidian 桌面复测

1. `make deploy` 后 reload/re-enable plugin，打开 repo-local `test` vault 的目标 Markdown
   leaf；确认 `pagelet.enabled=true`、`petVisible=true`、`focusMode=false`。Settings 是
   独立 Obsidian 窗口，不要把它误当 active note leaf。每个 finding artifact 记录截图
   路径、Obsidian/窗口尺寸、active leaf/sidebar/Bubble rect、主题/字号/语言、触发
   前置、DOM selector 与 commit/runtime identity。
2. 桌面 Pet 鼠标/键盘回归：短点、约 520ms 长按、Capture/Review/Discover、点外、
   3 秒收起、Enter/Space、focus restore；使用 8.1 fixture，目标 callback 一次且 Pet
   根不额外 toggle。
3. Prepared Recap fixture：Pet nudge → click → 首屏 3 秒内看到具体 observation +
   source；View 进入带 scope/localized generatedAt/coverage/freshness 产品文案的
   完整 Detail；无 duplicate
   provider call。
4. Authorization：分别 Run、Adjust、Cancel、X、Escape、backdrop/programmatic close；
   passive close 不授权、不直接调用 provider、不强制开 Settings；同 session/reload
   重弹只记录现状，持久状态与 presentation/reprompt 按 SG-06 决定后执行。
5. Quiet Recall provider-free fixture：View、Open source、Dismiss、Not relevant、Later、
   X/Escape；标签与实际去向逐一记录，View 不重跑。Link/Later/feedback 的 gate 未决
   时只记录现状并标 `BLOCKED`，不伪造最终 UI。
6. shared Data Boundary fixture：first-use、broad/sensitive/costly、excluded-scope override、
   Cancel/X/Escape、provider/model/boundary change；使用 provider spy，未授权均零调用。
   SG-05 未决部分保持 `BLOCKED`。
7. Pet stale state：Recall working 中切 note；nudge 后开 Focus Mode/关设置；Pet 回到
   正确稳定状态。
8. Recap background fixture：Pet working → idle/nudge 与 stale/disable settle，不调用
   真实 provider。
9. 自动化跑完整 computed matrix；真实可见 pairwise 为 14px/dark/zh、16px/light/en、
   24px/dark/长中英内容。检查 body、hint、source、button/description、context label、
   Tab h2/h4/body/tag/source/action、long path、hover/focus 无裁切或位移。
10. 布局矩阵：right sidebar closed/open、left sidebar open、split leaf、窄窗口、resize；
   Bubble 不遮挡关键区域。
11. macOS Reduce Motion：idle/working/nudge/resting/hold/menu 与 Bubble/action motion
    符合 F-04 的承诺且仍可用。

若真实 Recap/Recall 使用 configured provider，必须记录发送的测试内容、provider/model、
调用次数与成本；provider-free fixture 足以验证本次导航/UI 时，不要制造不必要调用。

## 10. iPhone 真机复测

### 前置

- USB/无线设备已连接、解锁、信任；Obsidian iCloud `test` vault 已打开。
- Safari Develop 出现真实 `-- Obsidian -- localhost` WKWebView target。
- `make deploy-icloud` 的精确目标必须是
  `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian/plugins/personal-assistant`。
  逐字节比较 `dist/main.js`、`manifest.json`、`manifest-beta.json`、`styles.css`，并
  在 Tracker 保留四条显式 `MATCH`；任一 mismatch 立即 `FAIL`。
- byte-match 后手动 reload/re-enable plugin，必要时关闭重开 iCloud vault；通过真实
  WKWebView 记录 plugin manifest version、plugin instance 已重建、预期 patched runtime
  marker/behavior 与 fresh console，证明加载的是当前构建。byte-match 单独不足以证明
  iPhone 已加载新代码。若 `body.in-progress` 持续存在，停止反复 reload 并记
  `BLOCKED`，先恢复 Obsidian 状态。
- `pagelet.enabled=true`、`petVisible=true`、`focusMode=false`；按测试目标设置 Recall/
  Recap 和 Reduce Motion。
- 同步并打开第 8.1 节两份 smoke notes；在任何 Review/Discover 手指测试前证明
  provider/write/cost counters 为零基线。

### 竖屏实体触控顺序

1. 短点打开 Bubble，一次；再短点关闭，一次；无 double toggle。
2. 长按约 520ms：三项菜单出现、Bubble 不出现。
3. 用户手指点 Capture：Quick Capture 可见一次，取消后无 note write；Pet 根无额外
   toggle。callback exactly-once 由自动化/Inspector counter 证明。
4. 重新长按，用户手指点 Review：目标 Review 结果可见一次；按现行合同允许结果
   Bubble 出现，禁止的是额外 Pet 根 toggle/闪烁。
5. 重新长按，用户手指点 Discover：目标 local Discover route 可见一次；允许目标
   route 更新 Bubble/Detail，Pet 根无额外 toggle。
6. 重新长按后等待约 3 秒：仅菜单消失；再测点外部，只收起、不触发动作。
7. Bubble close/action 与 source/feedback 各点一次，确认 synthetic click 不二次执行。
8. 开启 iOS Reduce Motion 并 reload：检查 idle/working/nudge/resting/hold/menu；再跑
   短点和三个 menu actions。

### 横屏

iPhone Mirroring 无法旋转，继续使用 QuickTime 看真实横屏画面，并用 Safari
Inspector 记录 DOM/CSS/rect/overflow。至少复核：

- Pet、menu、Bubble、close、action 在 safe area 内且可见；
- 记录 `visualViewport.width/height/offsetLeft/offsetTop`，并以该 visual bounds 而非
  只看 `documentElement.clientWidth/Height` 断言所有 rect 完整落入可视区域；
- menu 在 Pet 下方，三项各至少 44px，且不与 Obsidian toolbar、notch/system controls
  重叠；
- Bubble max width 480px、居中、内部可滚动，无 document horizontal overflow；
- B-118 desktop clamp 没有污染 mobile landscape media rule；
- 横屏 menu 若仅由 Inspector 合成事件打开，证据必须标为 `INSPECTOR-SYNTHETIC`，
  不能计入 `REAL-IPHONE-TOUCH`；
- 若无法执行横屏实体触控，明确写 `visual/DOM PASS, physical landscape touch NOT TESTED`。

### 真机收尾与污染检查

1. 恢复 Reduce Motion、Recall/Recap/Pagelet 设置、目标 note 与原方向；关闭 Bubble、
   menu、Modal、Panel/Tab。
2. 移除所有临时 provider/VSS seams 与 counters，reload plugin，确认 plugin instance
   已重建且 `body.in-progress` 不残留。
3. 核对 Quick Capture target、两份 smoke source note 和 `.pagelet/` 文件集与测试前
   baseline 一致；任何预期外写入先调查，不能直接删掉掩盖污染。
4. 清空 console/error buffer 后重新读取 fresh Console，并记录 provider/write/cost
   final counters。只有零残留、零意外写入、零未授权调用才完成真机 smoke。

### iPad

本轮没有 iPad 设备证据。除非实际完成 iPad smoke，否则 closeout 必须写
`NOT TESTED`，不得从 iPhone 或 CSS 推断 parity。

## 11. 当前未覆盖与残余风险

- `NOT-TESTED`：iPad placement/touch。
- `NOT-TESTED`：Android Pagelet parity；B-118 不把它设为完成 gate。
- `SOURCE-ONLY`：provider-backed Quiet Recall 的本轮真实 navigation/feedback；应先用
  deterministic fixture，只有明确授权后才补真实 provider。
- `SOURCE-ONLY`：F-10 首次 provider disclosure 与 F-12 Review/preload classifier 已由
  provider/modal/quota spies 闭合；真实 provider/high-risk 路径未获数据/成本授权，
  不冒充实调 PASS。
- `ARTIFACT-MISSING`：desktop/portrait 的部分可见检查虽已人工确认，但没有为每一项
  留下独立截图/JSON 路径；自动化、用户确认与 artifact 边界必须分开陈述。
- `NOT-TESTED / accepted waiver`：本轮 iPhone 浅横屏未执行。2026-07-19 的历史
  QuickTime/Inspector baseline 不能替代本轮检查，也不能写为 PASS。
- VoiceOver 完整朗读顺序未做；修复不得破坏现有 role/aria/keyboard，若变更动作
  结构，应增加至少基础 screen-reader/keyboard 检查。
- Desktop sidebar overlap 的 142px 是当前窗口组合的实测值，不应硬编码 142px；
  修复目标是可用区域约束。
- SG-01..SG-07 的当前 disposition 已进入 Product Spec/Decision/Tracker；下文 stop-gate
  表仅是历史过程证据。Prepared Recap 的 3 秒测试仍不能替代其他 surface 证据。

## 12. 完成定义

以下是本 handoff 当时给出的历史 exit checklist；当前完成状态与 residual 只读
[Tracker](./tracker.md)。B-118 只有同时满足以下条件才可进入 Validated/Closeout：

- F-01/F-02/F-03/F-12 的 P1 已由自动化 + 对应真实 surface 关闭；其中 F-03 的 SG-06
  已获得决定并完成。F-10 已证明所有未授权路径 fail closed，且 SG-05 已决定并
  完成；F-12 已证明 actual-source Review 分类与 background silent-skip envelope；任何
  仍属 B-118 scope 的 P1 不得仅以“延期”进入 Validated。
- F-04/F-06/F-08 已关闭，无持续 motion、假状态或低可读性；F-05/F-07 先完成
  characterization，受 SG-01..04 影响的部分必须已决定并实现；
- F-09 已完成，或由用户明确延期并进入 Backlog，不得静默跳过；
- 若用户决定移除某个 SG-01..06 对应的 P1/P2，必须先用新的 Decision/Product Spec
  把它正式移出 B-118，并进入 Backlog；不能只在 Tracker 写 Deferred 后关单。
  SG-07 是已声明的非目标，closeout 只需记录“保持现状/后续 Backlog”的明确
  disposition，不要求 B-118 顺手实现。
- B-118/REQ-01..10 与 AC-01..10 在 Approved SDD 和 Tracker 中一一有证据；
- focused gate、TypeScript、whitespace、community DOM scan、`make deploy` 通过；
- iCloud 四条 `MATCH`、真实 WKWebView runtime identity、iPhone 三菜单 item 的用户
  手指触控与 Reduce Motion 复测完成；
- portrait safe area 没有回归；浅横屏未测时只记录显式 waiver，不从历史 baseline
  推断 PASS；
- Product Spec、Bubble/Quiet Recall/Pagelet 当前合同、Tracker 与实际行为一致；
- 没有未清理 listener/timer、runtime style/HTML injection、自动写入、provider 扩权、
  Git/release 越权、临时 seam/counter、smoke 数据污染或无关 refactor。

完成实现但没有真实 Obsidian/iPhone 证据时，状态只能是 `Validating` 或 `BLOCKED`，
不能写 `Validated`、`Closed` 或“真机通过”。
