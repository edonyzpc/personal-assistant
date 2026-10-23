# B-187 Pagelet Chat Continuation Development Tracker

Document status: Current
Delivery status: Planned
Updated: 2026-10-23
Work item: B-187
Authority: B-187 唯一执行状态、实施顺序、finding 与验证证据。
Product spec: [从 Pagelet 的发现继续思考](../../../product/specs/pagelet-chat-continuation-product-spec.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: SDD 文档设计；产品范围已确认，运行代码未实施。
- Next action: 获得明确实施授权后按 T-01 → T-02 完成核心，再小范围接入 T-03，统一进行 T-04 验收。
- Blocker / decision needed: 无核心产品待决策；本轮没有实施授权，不能据此启动开发。辅助项已有可后置边界。
- Last verified behavior: 2026-10-23 只读核对 `43050df2`（v3.0.1）附件、宿主导航、阅读选择及既有测试落点；未验证新运行行为。
- WIP: 本项为唯一 Planned/Next；现有 B-124 仍占 Now，本轮不修改其他 track。实际启动时按项目 WIP 规则处理。
- Artifact disposition: Discovery 的产品结论、可视化口径与源码事实已吸收进 DEC-072、Spec、SDD；删除已吸收过程稿并移出 Backlog/Discovery 索引，B-187 由本 Tracker 连续承接。

## Work

这是一个小范围交付顺序，不拆多期计划。未来由 GPT 维护设计与独立验收，单一实施者按
[GPT / GLM workflow](../../workflows/gpt6-glm-delivery-workflow.md) 完成接线和定向验证；不并行修改 ChatView。
是否使用既有配额接管按实施时有效事实处理，本轮不启动实施 worker 或探测 provider。

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-00 | B-187/REQ-01～B-187/REQ-05 | 固定已确认产品范围，完成源码核对、SDD 与最小验收安排 | [x] | DEC-072 / Spec / SDD；文档检查见下 |
| T-01 | B-187/REQ-01 / B-187/REQ-02 / B-187/REQ-05 / B-187/AC-01 / B-187/AC-05 | 待发送和历史附件内容线索、来源/全文展开、通用空态隐藏及移除后恢复；保持原草稿、接受和保存边界 | [ ] | 预期：ChatView、局部样式和 zh/en 文案；V-01 |
| T-02 | B-187/REQ-03 / B-187/REQ-05 / B-187/AC-02 | 来源与原笔记真实路径导航、已开页复用/新 tab、缺失提示、外链；与 T-01 共同构成可交付核心 | [ ] | 预期：ChatView 局部 helper；V-02 |
| T-03 | B-187/REQ-04 / B-187/AC-03 / B-187/AC-04 | 辅助入口与 exact live reveal，复用候选校验/阅读位置，失败展开附件 | [ ] | 预期：ChatHost/integration、plugin、Detail/TabView 窄接线；V-03。若成本越界可后置并记录，不阻塞 T-01/T-02 |
| T-04 | B-187/REQ-02 / B-187/REQ-05 / B-187/AC-01 / B-187/AC-02 / B-187/AC-03 / B-187/AC-04 / B-187/AC-05 | 一次针对实际 diff 的独立复核、必要源码门禁、部署后桌面主路径及窄容器检查 | [ ] | V-01～V-04；辅助项后置则明确 AC-03/04 的适用范围，不记为已实现 |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Minimum Validation

只为新导航、空态转换及实际纳入的精确匹配/回退补必要断言，优先扩展已有用例。
不为每句文案、颜色、每个展开按钮或语言组合重复测试；不新建模型效果矩阵、设备认证或测试计划文档。

| ID / 风险与映射 | 最少证据与落点 | 通过条件 | 重跑/扩展触发 |
| --- | --- | --- | --- |
| V-01：附件/空态影响继续输入；B-187/REQ-01 / B-187/REQ-02 / B-187/REQ-05 / B-187/AC-01 / B-187/AC-05 | 扩展 [chat-view.test.ts](../../../../__tests__/chat-view.test.ts) 已有完整附件→接受→保存→恢复用例及空态用例；复用草稿冲突和接受断言 | 能认出内容、待发送/历史语义一致；有附件隐藏通用问题、移除后恢复；配置提示、草稿及接受保存条件保持 | 相关渲染、空态、handoff 接线或 fixture 改变；未触及的 provider 投影无需新增采样 |
| V-02：误开路径/新建文件；B-187/REQ-03 / B-187/REQ-05 / B-187/AC-02 | 同一 ChatView suite 的紧凑导航组，使用已有 workspace mock | 按真实路径复用目标/新 tab；缺失不创建；草稿、会话、附件保持；网页仍为用户点击外链 | 文件/leaf 路由或来源投影改变 |
| V-03：辅助返回错候选或打断阅读；B-187/REQ-04 / B-187/AC-03 / B-187/AC-04 | 纳入 T-03 时扩展 [pagelet-panel-tab-view.test.ts](../../../../__tests__/pagelet-panel-tab-view.test.ts) 的多候选/阅读位置用例；[plugin-record-note.test.ts](../../../../__tests__/plugin-record-note.test.ts) 的 Detail leaf 路由；ChatView 合入一次失败回退断言 | ID/hash 准确、已选中不重建；无 live/恢复占位/校验期间关闭或撤权不创建页；失败可读完整附件。复用现有过期与权限语义 | 仅在辅助导航纳入且对应选择/生命周期接线改变时执行；不扩展 orchestrator 发现效果矩阵 |
| V-04：原型与实际布局/原生导航不一致；B-187/REQ-02 / B-187/REQ-03 / B-187/REQ-05 / B-187/AC-01 / B-187/AC-02 / B-187/AC-05 | 授权实施后部署到测试库，一次桌面串联：发现→Chat→来源/原笔记→回到 Chat 输入→已接受历史核对；同次查看长正文和一个窄容器 | 原生页面正确、输入可用、主题/限高/内部滚动一致；辅助项纳入时顺带走正确返回与失效，不重复整套场景 | 本次相关 CSS/DOM/宿主接线变化；实际 iOS 特性或明确真机请求才增加硬件验证 |

V-02/V-03 的模型调用边界只检查新增附件处理器：导航自身不主动发起或依赖重新发现、模型调用，
不重新准备 handoff 或发送消息。既有后台发现仍按用户设置运行，不以全系统 provider 调用次数为零验收；
这是现有验收口径的澄清，不新增后台发现测试矩阵或抑制机制。

实施时源码定向命令按实际 slice 选择：核心使用 `npm test -- --runInBand __tests__/chat-view.test.ts`；
辅助项只增加上表两个就近 suite。这是预定检查，尚未执行，不意味着整个 B-176 验收需重跑。

按 [AGENTS 本地门禁](../../../../AGENTS.md#local-validation-gate) 完成类型检查、diff check 及 DOM/CSS 源码扫描。
应用验收使用项目部署流程：`make deploy` 已包含 lint/build/full Jest，计作对应覆盖；如果已有当前输入
的有效检查与构建，则用 `make deploy-current`，不重复完整门禁。只有失败、输入变化或具体未决风险才扩大/重跑。
本轮只有文档变化，执行 `npm run docs:check` 与 `git diff --check`；不运行上述产品测试、构建或 smoke。

## Findings

没有待解决的阻塞性设计 finding。源码核查已吸收三处具体约束：空态保留配置反馈并在移除后恢复；
附件导航不用活动笔记或交接入口；辅助导航以已存在候选身份/正文和 live 实例为准，继承过期可读、撤权不可读的边界。

F-01（P2，已按 Owner 2026-10-23 确认修正文档）：原“导航不调用 AI”的绝对表述与原生切页的既有后台发现不符。
DEC-072、REQ-05、SDD 与 V-02/V-03 已统一为导航自身不主动发起或依赖模型调用，后台发现按用户设置运行；
不增加抑制机制，不扩大开发和测试范围。此项关闭仅指文档边界，不代表产品实施或应用验收。

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-10-23 | B-187/REQ-01 / B-187/REQ-02 / B-187/REQ-03 / B-187/REQ-04 / B-187/REQ-05 | 只读源码与既有测试定位，两个独立视角核对 Chat 和 Detail 接线 | 设计依据已核实 | `43050df2`；不是新行为测试、应用通过或 SDD 实施批准 |
| 2026-10-23 | 全部文档路由与追溯 | `npm run docs:check`；`git diff --check` | PASS；均自然 exit 0 | 文档检查覆盖 339 Markdown files / 4352 local links；不代表产品代码或应用测试 |

## Closeout Readiness

- [ ] 核心行为实现与 Spec 一致；辅助项实际结果或后置范围记实。
- [ ] 必要源码、独立复核与桌面证据已记录；未声称未执行的模型/设备/发布验证。
- [ ] 未完成事项与稳定结论按项目文档流程承接；取得另行 closeout 授权后处置过程文档。

当前停在文档设计。Owner 于 2026-10-23 授权将本轮文档提交到本地 master；不修改产品代码，不推送或发布。
