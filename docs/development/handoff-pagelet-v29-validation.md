# Handoff: Pagelet v2.9 LLM Integration — Validation Tasks

> 本文档记录 2026-07-17 实现会话中未完成的测试验证工作，交接给后续 Codex 执行。

> [!info] 2026-07-18 formal validation update
> 当时 B-108 实现、三轮独立 review/fix、15 focused suites / 788 tests、159 full
> suites / 3130 tests 已通过；runtime 未再变化，先前 3128-test tree 的 `make deploy`
> 与 `make deploy-icloud` 产物仍与当前 runtime byte-matched。早期 deployed-build
> deterministic in-app fake-provider path 已证明一次调用可产出来源支撑的
> ready artifact、零重复调用即时打开、失败保留 prior artifact、clear 后
> 零调用 fallback，以及 Recall 单次语言重试和 exact-cache 零调用复用；
> 本轮又补齐完整 source-snapshot 去重、provider-boundary 二次校验、跨热重载
> hard cap、limiter 等待期间的 disable/unload/source-drift provider guard、完整
> coverage、change/time fallback、诊断 reload、Bubble context
> action mount、Pet focused-leaf/i18n/touch-cancel 与字号/触控 CSS 回归。physical
> 截至 2026-07-18，desktop gesture/theme/font 与 mobile interaction matrix
> 因 Mac 锁屏和无真机证据仍未完成；该状态已由下方 2026-07-19 update supersede。
> 当前状态与 residual risk 以
> [B-108 Tracker](./active/pagelet-b108-dogfood-followup/tracker.md) 为准。

> [!info] 2026-07-19 physical validation update
> 桌面 Obsidian 已真实验证 Pet 短点打开/关闭 Bubble、16px/24px 字号、
> 亮/暗主题与 macOS Reduce Motion 切换后的稳定渲染；设置已恢复为亮色、
> 16px、Reduce Motion 关闭。iCloud vault 的 `main.js`、两个 manifest 与
> `styles.css` 仍和当前构建 byte-matched。iPhone 15 通过 Mirroring + Safari
> Web Inspector 验证真实设备 WebView 中的 Pet 44×44、真实短点打开/关闭
> Bubble。另在该真实 iPhone renderer 中以合成 TouchEvent / MouseEvent 验证
> 520ms hold 路径会显示 Capture / Review / Discover、3 秒自动收起、外部
> pointer 收起，以及 Capture 打开 Quick Capture 后可无写入取消。合成事件
> 不等同于实体手指或实体鼠标长按证据。桌面真实 renderer 另以确定性内存
> fixture 补齐了“主 Recap + context action”同屏层级，以及 Tab 的 h2、h4、
> body、tags、source links、action button 在 16px/24px 下的视觉矩阵；fixture
> 只调用正式渲染入口，不调用 provider、不写笔记。全程未选择授权弹窗的 Run，
> 未发生真实 provider 调用、笔记传输或配额消耗。

> [!info] 2026-07-19 completion-audit update
> 该 completion-audit 中间 gate 以 15 focused suites / 807 tests、159 full suites /
> 3149 tests 通过；当前全量结果以授权设置修复后的 160/160 suites、3162/3162 tests 为准。
> lint、TypeScript、build、docs、whitespace 与 community DOM scan 通过，随后
> `make deploy` / `make deploy-icloud` 均再次通过，local/iCloud 的 `main.js`、
> 两个 manifest 与 `styles.css` 全部和 `dist` byte-matched。新增证据覆盖真实生产
> limiter 的 Recap 2/h+10/day 与 Recall 10/h+50/day N/N+1 边界、background-ready
> → nudge、单来源显式 Recap 与双来源主动提示分离、Pet lifecycle/callback，以及
> AI Recall / local Discover provenance 分离。当前生产 Tab renderer 还以仅内存 fixture
> 显示一张 `Local related clue`、零 AI Recall card，且未渲染注入的 local summary、
> why-now、next-action 或伪 Recall title；fixture 已恢复，fresh error buffer 为空。
> 本轮没有 provider 调用、笔记写入或配额消耗。

> [!info] 2026-07-19 provider-free downstream app-smoke update
> 当前树已在 Obsidian 1.13.2 的正式 renderer 中，用 Computer Use 实际点击
> Pet 菜单的 Review 与 Discover。Review 通过确定性 foreground seam 依次显示
> governed Bubble 与 Current Note Analysis Panel；Discover 保留真实
> `[[Pagelet Smoke Test]]` 解析，只隔离 VSS/provider 调用，并显示
> Connection Discovery 与 `Existing wikilink`。DOM 计数为 Review=1、related
> lookup=1、Discover=1、`writeCalls=0`、`costDelta=0`，`.pagelet/` 文件集不变；截图、
> settled UI 与 fresh error buffer 均通过。临时 seams/session state 已恢复，目标
> 笔记重开，Panel/Bubble/menu 清空，debug 与 mobile emulation 关闭。该证据证明
> 当前树 app routing/presentation，不冒充真实 provider 语义质量。

> [!info] 2026-07-19 real-provider Review/Discover update
> 用户明确选择不延期并授权完成全部验证。正式 Pet 菜单 Review 通过 Qwen
> `deepseek-v4-flash` 读取 `pagelet-provider-en.md`，返回 3 条具体建议：量化验收、
> 回滚条件与 go/no-go 责任人；Bubble 与 Current Note Analysis Panel 均正确渲染，
> 成本为 1608 input + 265 output = 1873 tokens。Discover 读取
> `2026-06-29.md`、`pagelet-smoke-golden.md`、
> `ux-journey/2026-06-29-quick-thoughts.md`、`2026-06-28.md`，生成 3 条具体中文
> connection 并显示正确 source list/graph，成本为 1027 input + 521 output =
> 1548 tokens。两条路径均未点击 Save，`.pagelet/` 为空，直接基线来源不变，fresh
> error buffer 为空；结果面板关闭并通过 plugin reload 清除会话态。

> [!info] 2026-07-19 real-provider Scope Recap update
> 首次真实 Scope Recap `Retry` 以 Qwen `deepseek-v4-flash` 发起一次调用，记录
> 1014 estimated input / 0 final-output tokens 与 `malformed`；没有自动重试，也没有
> 覆盖 last-valid、写入 Markdown 或开启后台准备。该结果暴露了短 JSON 请求与
> DashScope hybrid model 默认 thinking 的兼容缺口：最终 answer 可能为空，原诊断会将其
> 统一归为 malformed。修复后，仅对已知支持该参数的 DashScope hybrid families 显式传递
> `enable_thinking=false`；`*-thinking-*`、`*-instruct-*` 与 Qwen 3.7 的两个无后缀
> thinking-only Max ids 被明确排除，其他 provider/model 不受影响。Focused gate 4 suites / 348 tests、
> TypeScript 与 whitespace 通过，随后 `make deploy` 和批准后的 `make deploy-icloud`
> 以 159/159 suites、3152/3152 tests 通过，local/iCloud 四个 runtime assets 均与
> `dist` byte-matched。第二次也是最后一次可用 `Retry` 成功：1014 input + 574 output =
> 1588 estimated tokens，生成 1 theme + 1 tension + 1 open question，12 条来源引用，
> coverage 12/22；hourly limiter 正确达到 2/2。后台准备保持关闭，`.pagelet/` 为空，
> fresh console 无错误。原 `input ~2-5k` 是丰满 scope 的非合同估计；当前 bounded digests
> 的实测输入较小，不构成失败。

> [!info] 2026-07-19 Scope Recap diagnostic-contract follow-up
> 首次实况的空 final answer 在当时被记为 `malformed`，但既有 outcome contract 已明确区分
> `empty` 与“非空但无法解析”的 `malformed`。生产 adapter 现对空白 final answer 返回
> `empty`，且绝不把 `reasoning_content` 当最终答案；非空无效 JSON 仍为 `malformed`，
> 两种情况均保持一次 reserve / 一次 invoke、无自动重试。新增两条回归后，
> `plugin-record-note` 192/192、TypeScript、159/159 suites / 3154/3154 tests、lint、build、
> local/iCloud deploy 与四项 asset byte-match 再次通过。

> [!info] 2026-07-19 user physical-gesture update
> 用户在当前验证会话中完成并报告：桌面实体鼠标长按 520ms 后出现同一
> Capture / Review / Discover 菜单，通过；iPhone 实体长按通过。该用户直接操作证据
> 补齐此前 renderer/CDP/合成事件不能替代的实体手势层。未据此额外推断 iPhone 上曾点击
> Review / Discover 或产生 provider/write action。当前正式验证只剩 3-Second Value Test。

> [!info] 2026-07-19 authorization/settings formal-smoke update
> 验收追溯补齐了授权 Modal 的 5 条文案与 Run / Adjust / Cancel / 直接关闭回归，以及
> provider 未配置时 `Retry` 只打开设置、零 provider / detail duplication / write 的回归。
> 真实 Obsidian 复测发现并修复了 Adjust / Cancel 后持久状态已关闭、但独立 Settings
> 窗口开关未即时复位的误导状态；修复统一使用该 Settings container 的 owner document
> 维护可见生命周期。当前 UI 中 Adjust 立即显示关闭并持久为 pending + disabled，Cancel
> 立即显示关闭并持久为 declined + disabled；generic background review preparation 始终关闭，
> `lastAttemptAt` 保持 `2026-07-19T08:37:26.579Z`，未选择 Run，未新增或修改 `.pagelet`
> 与 Markdown 来源笔记。3-suite focused gate 为 257/257；最终 `make deploy` 与
> `make deploy-icloud` 均以 160/160 suites、3162/3162 tests 通过，lint、TypeScript、build、
> whitespace/community scan 通过，local/iCloud 四项 runtime asset 均与 `dist` byte-match。

## 背景

原始实现会话完成了 Pagelet v2.9 dogfooding 的首批工作；后续 B-108 follow-up 又完成了正式设计、实现、审计修复与大部分运行时验证。以下清单同时保留已完成证据与仍需真实交互、主观判断的边界；provider-backed smoke 已在明确授权后完成。

## 前置条件

- `make deploy` 已执行（assets 已部署到 `test/.obsidian/plugins/personal-assistant/`）
- 执行 provider-backed Review/Discover semantic smoke 或可选 real-provider token smoke 时，需要已配置 AI provider（API key）的 Obsidian test vault，并取得对应数据传输授权；provider-free app routing/presentation 已不再依赖此前置条件
- Vault 中至少有 10+ 篇有内容的笔记（含 tags、headings、相互链接）

## 待完成验证清单

状态说明：`[x]` 表示该条已由当前树自动化、早期 deployed-build 的确定性 provider
seam、真实桌面/设备 UI，或真实设备 renderer 的合成事件之一正式证明；每条会在文字中
标注证据类型。`[ ]` 表示该条指定的真实网络、肉眼交互、实体手势、主观判断或真机
证据仍缺失，不能用不同层级的证据替代。

### 1. Scope Recap LLM 端到端验证

**触发方式**：Command Palette → "Pagelet: Open Scope Recap"（中文："拾页：打开范围回顾"）

**验证项**：
- [x] provider invocation boundary 被调用并进入独立 cost tracker；确定性 seam 与真实 Qwen `deepseek-v4-flash` 均已验证
- [x] 返回的 Recap 内容是 provider 生成的结构化洞察（不是旧的 tag 统计 "Theme: #tag — appears across N notes"）
- [x] 洞察引用了具体笔记标题（sourceRefs 不为空）
- [x] 内容语言跟随笔记语言（中文笔记 → 中文洞察）
- [x] 后台准备在少于 2 个可用来源时不调用 provider、不制造 delivery/nudge；用户显式 `Retry` 可对 1 个来源生成可点击查看的 source-backed artifact，但单来源结果永不主动提示
- [x] 当 AI provider 未配置时，不展示 Recap delivery/nudge；显式命令立即显示诚实状态、本地 scope/source 说明与设置/查看来源入口

**失败降级验证**：
- [x] 模拟 provider 失败 → 不创建 ready/delivery/nudge，也不覆盖仍有效的 last-valid artifact
- [x] 仍有效的旧 artifact 存在 → 显式打开立即显示旧 artifact；没有有效 artifact → 立即显示本地 scope/source 说明 + `重试` / `查看来源`，且打开本身不调用 provider
- [x] 本地 overview 不进入 insight、DeliveryCandidate 或 hint pool；显式重试失败时保留已有内容并显示非破坏性反馈

### 2. Quiet Recall LLM "Why Now" 端到端验证

**触发方式**：先在 test-vault 配置中显式启用 `quietRecall.bubbleNudgesEnabled=true`
（当前默认 `false`），再打开一篇与其他笔记有语义关联的笔记，等待 Recall nudge 出现

**验证项**：
- [x] Quiet Recall Bubble nudge 的 whyNow 文本来自独立 provider evaluation（不是模板 "This saved insight references the note you are viewing"）
- [x] whyNow 语言跟随笔记语言
- [x] 无说服力的候选被过滤（不展示）
- [x] 60 秒 cooldown 生效：快速切换笔记时，第二次切换不启动新的 evaluation round；若没有当前 context-candidate fingerprint 的有效 AI 结果，不展示模板 Recall nudge
- [x] 60 秒后再次切换笔记时，provider 评估恢复

**语言重试验证**：
- [x] 打开中文笔记，如果首次返回英文 whyNow → 自动重试一次 → 第二次返回中文

**降级验证**：
- [x] AI provider 未配置、cooldown/预算阻止评估时 → 不展示模板 whyNow 或 Recall nudge；本地候选只可进入显式 Discover，并明确标注“本地关联线索 / Local related clue”，不携带 AI whyNow
- [x] 当前生产 Tab renderer 的确定性本地候选 fixture → 仅显示 1 张 `Local related clue`、0 张 AI Recall card；注入的 summary / whyNow / nextAction / 伪 Recall title 均未进入 DOM
- [x] 单个候选 provider 调用失败 → 该候选被过滤，其他候选不受影响

### 3. Bubble 上下文行动区验证

**触发方式**：点击 Pet 打开 Bubble

**验证项**：
- [x] 当有 recall candidates 存在但未通过展示门槛时，Bubble 底部显示 localized "N related notes found" + "Discover" 按钮
- [x] DOM callback 证据：点击 "Discover" → Bubble 关闭 → 精确调用 Discover Connections callback；这是低层回归，第 4 节另有已完成的真实 Obsidian route/render app smoke
- [x] 桌面真实 Bubble renderer 的确定性内存 fixture 中，主 Recap 与 context action 同屏；上下文行动区通过留白 + 字号降级与主内容区分隔（无虚线），无重叠
- [x] 当无 unconvincing candidates 时（count = 0），上下文行动区不出现

### 4. Pet 长按菜单验证

**触发方式**：在 Pet 上长按 520ms

**验证项**：
- [x] 真实 iPhone renderer 上合成 TouchEvent 触发 520ms hold 后出现 3 项菜单：Capture / Review / Discover
- [x] 桌面正式 renderer 上 CDP `mousePressed` 产生真实 `pointerdown` / `mousedown`；MutationObserver 在按下后 523ms 记录到 Capture / Review / Discover 菜单，release 后未触发菜单 action
- [x] 桌面实体鼠标长按 520ms 后出现同一菜单（用户实体操作反馈，2026-07-19）
- [x] 真实 iPhone renderer 上合成 hold + 菜单点击 "Capture" → 打开 Quick Capture；随后取消，未写入笔记
- [x] 直接 production `PetView` DOM regression：点击 "Review" 精确触发 Review Current Note callback，关闭菜单且不误切 Bubble
- [x] 直接 production `PetView` DOM regression：点击 "Discover" 精确触发 Discover Connections callback，关闭菜单且不误切 Bubble
- [x] 真实 Obsidian + Computer Use 点击 `Review` → 确定性无 provider seam 通过正式 orchestrator 显示 governed Bubble，再点击 `View details` 显示 Current Note Analysis Panel；`writeCalls=0`、`costDelta=0`、`.pagelet/` 文件不变
- [x] 真实 Obsidian + Computer Use 点击 `Discover` → 保留真实 `[[Pagelet Smoke Test]]` 解析并显示 Connection Discovery / `Existing wikilink`；只隔离 VSS/provider，`writeCalls=0`、`costDelta=0`、`.pagelet/` 文件不变
- [x] 真实 provider Review/Discover 语义输出：Qwen `deepseek-v4-flash` 分别返回 3 条具体 Review 建议与 3 条中文 Discover connection；来源、语言与 UI 正确，合计 3421 tokens，零 Save、零 `.pagelet/` 写入、fresh errors 为空
- [x] 真实 iPhone renderer 上合成 hold 后等待 3 秒，菜单自动消失
- [x] 真实 iPhone renderer 上合成 hold 后分发外部 pointerdown，菜单消失
- [x] 桌面与 iPhone 15 Mirroring 真实短点 Pet → 正常 toggle Bubble，不出现菜单
- [x] 真实 iPhone renderer 的 TouchEvent handler、菜单布局与 44×44 Pet target 通过
- [x] 实体手指长按的触发手感与 touch parity（用户 iPhone 实体操作反馈，2026-07-19）

### 5. 字号对齐验证

**触发方式**：Obsidian Settings → Appearance → Font size 调大/调小

**验证项**：
- [x] 桌面真实 Tab renderer 的确定性内存 fixture 中，h2、h4、body、tags、source links、action button 均随 16px/24px 设置变化并正常重排
- [x] 当前可见 Pagelet Panel、Detail View 与 Bubble 文本在桌面实际 16px/24px 切换中同步重排
- [x] 极端字号（24px）下当前可见布局不断裂（内容重排但不溢出/重叠）
- [x] 默认字号（16px）下实际视觉与 CSS regression 均证明 h4 小于 title（0.875rem vs 1rem）
- [x] macOS Reduce Motion 实际开启/关闭时 Pagelet 保持稳定渲染；此项不声称精确测量动画时长

### 6. 卡片样式验证

**触发方式**：触发 Scope Recap 或 Review → 查看 Detail View

**验证项**：
- [x] provider 生成的洞察卡片 DOM 使用 insight/comparison card style 与左侧强调条
- [x] 桌面正式 renderer 中以 CDP `CSS.forcePseudoState` 触发真实 `:hover` 规则；卡片出现 `0 2px 8px rgba(0,0,0,.12)` 阴影与更明显的 border，对比前后无位移
- [x] section type 到 insight/comparison card style 的映射已由 DOM regression 覆盖
- [x] 亮色/暗色主题下 Bubble、Panel 与 Detail View 的 settled UI 已真实观察，无截断或重叠
- [x] 亮色与暗色主题下均完成 hover 前后截图和 computed-style 对比；亮色 border 约从 230 降至 196，暗色约从 54 升至 83，阴影从 `none` 变为上述值，变化可感知

### 7. 3-Second Value Test（主观验证）

**B-108 验收前置条件**：本轮验证的是 DEC-017/DEC-018 的 prepared Recap
“点击即得”，不是关闭后台能力后的通用空状态。执行前必须确认 Scope Recap
后台准备已由用户通过 disclosure 的 `Run` 明确授权并处于开启状态，并由诊断或
Pet nudge 证明当前 scope 已有 fresh prepared artifact。Generic preload、generic
proactive hints 与 Quiet Recall Bubble 可以继续关闭。若此前刚完成 `Adjust` / `Cancel`
授权 smoke，必须先重新完成 `Run`，否则只看到 `intentionally-quiet` / CTA 不能作为
prepared Recap 的通过或失败证据。

**流程**：
1. 由验证者完成上述前置条件；后台准备发生在点击前，用户不为生成结果等待
2. 关闭所有 spec/文档
3. 打开 Obsidian，正常写 2-3 分钟笔记
4. 在 fresh prepared artifact 就绪后点击 Pet
5. 记录："这 3 秒内我看到的东西，值得我明天再点一次吗？"

**记录项**：
- [x] Bubble 主内容是具体 Recap observation，而不是 ready/CTA 文案
- [x] observation 让用户愿意继续看并再次打开；来源支撑由 fresh 12-source artifact 记录
- [x] 点击时零等待、零重复 provider call
- [x] 洞察质量：对测试 vault 的局限作出诚实、有用的判断，没有硬凑“发现”
- [x] 整体判断：pass；诚实边界建立了信任，并产生后续继续观察的期待

**首次尝试（2026-07-19，前置条件不成立，不计最终验收）**：

- [x] Bubble 实际命中已确认的 `intentionally-quiet` explanation state；可见内容只有
  `Find related old notes`，没有 Recap Delivery、Recall nudge 或本地来源方向
- [x] 用户反馈：不知道会出现什么实质内容，可能会直接点击 Find；三秒内没有足够
  内容让人判断是否值得明天再点
- [x] 未触发 Recap，洞察质量不适用
- [x] 未触发 Recall，whyNow 不适用
- [x] 用户感知结果为 fail；但运行配置仍是此前 Cancel smoke 留下的
  `scopeRecapBackgroundAuthorization=declined-v1`、`scopeRecapPreparationEnabled=false`、
  `proactiveHints=false`、`quietRecall.bubbleNudgesEnabled=false`、
  `quietAcknowledged=true`，因此该样本证明关闭准备后的 CTA-only 状态没有即时价值，
  不能判定 DEC-017/DEC-018 prepared Recap 失败。最终验收须在正确前置条件下重跑

**正式复测（2026-07-19，前置条件成立，计最终验收）**：

- [x] 用户亲自在 disclosure 选择 `Run`；持久状态为 `authorized-v1` 且 preparation on
- [x] 点击前后台准备已成功：folder scope、12 included sources、995 input + 639 output，
  Pet 显示 `insights ready`
- [x] 用户点击后立即看到有意义的 Recap；它指出当前是测试用 vault、缺少可形成实际
  高价值发现的材料，没有用泛化文案冒充洞察
- [x] 点击后的 `scopeRecapLastAttempt` 时间、snapshot 与 995+639 token 记录保持不变，
  证明没有重复 foreground provider call
- [x] 用户判断这种诚实限制“让我产生了信任”，并愿意以后继续打开，观察新的发现和
  PA 对自己的深入了解
- [x] 3-Second Value Test：pass

### 8. 必需的 Cost/Rate 验证

**验证项**：
- [x] Recall 按 DEC-020 逐候选独立评估：单轮最多 5 次初始调用，每个候选仅可因语言不匹配重试 1 次，单轮实际 provider call 总数 ≤ 10
- [x] 60 秒 cooldown 只限制 evaluation round；小时/日 limiter 按实际 provider call（含语言重试）计数，精确额度以 B-108 SDD 为准
- [x] pageletCostTracker 正确记录 input/output tokens，并以调用开始时 provider/model 归因

**可选真实 provider smoke（不阻塞 B-108 验证通过）**：

- [x] Scope Recap 真实调用已在用户明确授权 test-vault 数据传输与 quota 后执行；成功调用实测 1014 input + 574 output = 1588 estimated tokens。原 input ~2-5k 是丰满 scope 的非合同估计，当前 12 个 bounded digests 的较小输入可解释且成本有界

## 2026-07-19 物理证据边界

- 桌面：真实短点、字体 16px/24px、亮/暗主题、Reduce Motion 的 settled UI 已通过；
  hover 由正式 renderer 的 CDP 强制伪状态完成前后视觉与 computed-style 验证，不冒充
  实体鼠标移动。CDP `mousePressed` 还在正式 renderer 中于 523ms 创建三项 hold menu，
  但不冒充实体鼠标静止长按或手感证据；该缺口现由用户实体鼠标长按通过补齐。
- iPhone 15：真实设备 Mirroring 短点、44×44 target 与 Bubble 已通过；Safari Inspector
  合成事件证明真实 renderer 的 hold/menu/timeout/outside-dismiss/Capture 路由，但不冒充
  实体手指长按；该缺口现由用户 iPhone 实体长按通过补齐。
- Context action 的 DOM、文案、触控尺寸与 callback 有自动化证据；桌面真实 renderer
  的确定性内存 fixture 又专门观察了它与主 Recap 同屏时的视觉层级，因此第 3 节视觉项已完成。
- Tab 字体矩阵由桌面真实 renderer 的确定性内存 fixture 在 16px/24px 下完成；它覆盖
  h2、h4、body、tags、source links 与 action button，不声称发生 provider 调用或真实内容生成。
- iPhone 真机上的 Review / Discover 菜单项仍未点击，以避免未经授权启动 provider
  路径；但桌面真实 Obsidian 已通过实际 Pet 菜单点击完成 provider-free downstream
  app smoke。Review 显示 governed Bubble → Current Note Analysis Panel，Discover 以真实
  wikilink 显示 Connection Discovery；生产路由、settled presentation、零写入与零成本
  增量均已证明。随后真实 Qwen smoke 又证明 Review/Discover 语义质量、来源与语言，
  且未点击 Save、未产生 `.pagelet/` 写入。
- Local Discover 已在当前生产 desktop Tab renderer 中以确定性内存 fixture 观察：
  一张独立 `Local related clue` source-list card、零 AI Recall card，且无 AI summary、
  why-now、next-action 或伪 Recall title。fixture 清理后恢复原状态、关闭 Detail、重开
  目标笔记，fresh error buffer 为空；全程零 provider、零笔记写入。
- Scope Recap 真实 Qwen smoke 已完成：首次调用暴露 default-thinking/短 JSON 兼容缺口，修复后第二次调用成功生成 1 theme + 1 tension + 1 open question，12 条 sourceRefs，1014 input + 574 output = 1588 estimated tokens。两次调用均来自前台 `Retry`；验证结束时后台准备保持关闭，且无 Markdown/source-note 写入。
- Scope Recap 授权设置的真实 UI 复测已完成：Adjust 与 Cancel 均在当前独立 Settings 窗口中即时把 preparation toggle 复位为关闭；前者保留 pending，后者持久化 declined，generic preparation 不受影响。两条路径均未选择 Run，`lastAttemptAt` 未变化，也没有 `.pagelet` 或 Markdown 笔记写入。
- Cancel 后同一 app session 重新开启 preparation 曾因 session prompt guard 不复位而无法再次选择 Run；现仅在显式 `declined-v1 → pending + enabled` 时恢复一次 disclosure eligibility。参数化 Run/Adjust/Cancel regression、4-suite/323-test focused gate、160-suite/3165-test local/iCloud deploy、两处资产 byte-match 和独立复核均通过。
- 3-Second Value Test 首次尝试只看到 `Find related old notes`，用户感知为 fail；审计
  发现该尝试仍处于授权 Cancel 后的 declined/preparation-off 状态，因此不计 B-108
  最终验收。正式复测已在用户明确 Run、fresh 12-source artifact 与 `insights ready`
  前置条件下通过；诚实说明测试 vault 局限的 Recap 建立了信任和再次打开的期待。

## 历史说明

- 早期 `__tests__/plugin-record-note.test.ts:2069` 的 memory governance bootstrap
  失败已修复；补齐 Recap card-style 直接 DOM regression 后，当前全量结果为
  160/160 suites、3165/3165 tests 通过。
- `buildQuietRecallCandidates` 仍然作为 import 保留（在 early-return 路径中使用），不是 dead code。

## 验证通过标准

全部**必需** checklist 通过 + 在上述 prepared Recap 前置条件成立时，3-Second Value
Test 主观判断为 pass → 可以继续下一步
（prompt 调优或发布 beta.2）。Review/Discover provider 语义 smoke 与独立的 Scope Recap
真实 provider token/cost smoke、桌面/iPhone 实体长按与正确前置条件下的用户主观复测
均已执行通过。B-108 当前状态为 `Validated`；commit、closeout/archive 与 release 仍需
各自的明确授权。

如果正确前置条件下的 3-Second Value Test 判断为 fail → 记录具体原因。实际洞察
泛泛时优先调整 prompt（`src/pa/pagelet-prompts.ts`）；CTA-only、错误状态或无 artifact
时先追踪设置、准备状态与路由，不能把非 prompt 问题归因给 prompt。
