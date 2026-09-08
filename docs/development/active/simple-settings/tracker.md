# Simple Settings Development Tracker

Document status: Current
Delivery status: Planned
Updated: 2026-09-08
Work item: B-106
Authority: 本 track 的唯一执行状态、任务依赖、finding 与验证证据。
Product spec: [Simple Settings Product Spec](../../../product/specs/pa-simple-settings-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: P0 完成 — 源码盘点、SDD、开发任务、三路独立设计复核与文档校验通过。
- Next action: 后续进入实施时从 T-01 开始，不跳过 P1 阶段验证。
- Blocker / decision needed: 无未决产品选择；本轮授权为设计开发任务，未开始 runtime 实施。
- Last verified behavior: 当前源码为 `master@b4de9c03`；本轮开始时仅有前序 DEC-033
  产品文档未提交修改。当前只有静态源码证据，不把历史测试/旧 build 作为 B-106 PASS。

## Work

任务状态是本表唯一权威；每个开发项须经过 focused validation→review→fix，
涉及共享文件的并行安排遵守 Plan 的所有权约束。

| ID | Requirement / AC | Slice / owner scope | Depends on | Status | Evidence / completion condition |
| --- | --- | --- | --- | --- | --- |
| T-00 | B-106/REQ-01..08 / B-106/AC-01..07 | P0：源码设计、字段闭集、依赖与验证计划；integrator + read-only reviewers | DEC-033 | [x] | 三路设计 review 无未处理 P0/P1/P2，docs/diff check 通过；见 Validation Log |
| T-01 | B-106/REQ-05 / B-106/REQ-07 / B-106/AC-05 | 五旧键规范化、单一新后台偏好、raw 检测与 save strip；Settings/Plugin integrator | T-00 | [ ] | 新旧值等价、幂等、不复活、失败重试、保护有效数据 |
| T-02 | B-106/REQ-06 / B-106/AC-02 / B-106/AC-05 | automatic/explicit admission、局部暂停/epoch、结果提交与提交后生效setter；Pagelet worker，Plugin 接缝由 integrator | T-01 | [ ] | pending/active/关开/late publish/force 路径，手动不被后台取消，保存失败不提前开启自动调用 |
| T-03 | B-106/REQ-02 / B-106/AC-02 | Memory bypass 删除、内置指南全链默认；Memory/Skills worker | T-01 | [ ] | 正常 readiness 保留、catalog/prompt/load_skill 一致、未知 ID 拒绝 |
| T-04 | B-106/REQ-04 / B-106/REQ-07 / B-106/AC-04 / B-106/AC-05 | 独立 opt-in、旧 extraction consent 对齐与权限保全；integrator | T-01 | [ ] | 00/10/01/11、有效旧启用、paused+raw true、来源/写入/治理 sentinel |
| T-05 | B-106/REQ-01 / B-106/REQ-02 / B-106/REQ-05 / B-106/AC-01 | P1 现有页面最小接线、删旧控件、新后台控制；同步三个 runner；integrator | T-02/T-03/T-04 | [ ] | 中间版本无悬空控件，runner 不靠废弃设置隔离或通过 |
| T-06 | B-106/AC-01 / B-106/AC-02 / B-106/AC-04 / B-106/AC-05 / B-106/AC-06 | P1 freeze→完整 gate→Desktop smoke→review/fix；一个 gate executor | T-05 | [ ] | 旧配置、新偏好、手动/后台、Memory 的实际 App 路径闭合 |
| T-07 | B-106/REQ-01 / B-106/AC-01 / B-106/AC-07 | 四组 registry、原生 details、旧深链/折叠偏好、局部刷新；Settings integrator | T-06 | [ ] | 首次AI、四组导航、精确记忆祖先展开、pending target、Pagelet刷新 |
| T-08 | B-106/REQ-04 / B-106/REQ-07 / B-106/REQ-08 / B-106/AC-04 / B-106/AC-06 / B-106/AC-07 | AI详情、长期学习、数据范围、Memory管理/恢复与保存反馈；integrator | T-07 | [ ] | provider draft/SecretStorage、权限、治理动作、失败反馈与目标消失焦点 |
| T-09 | B-106/REQ-01 / B-106/REQ-03 / B-106/AC-01 / B-106/AC-03 | 使用/保存/Metadata/统计分层；复用Statistics现场tab；integrator | T-08 | [ ] | 目的地条件展示、合法旧值保留、统计现场保存/重开、专业详情可达 |
| T-10 | B-106/REQ-03 / B-106/AC-03 / B-106/AC-07 | 图谱选项 Modal/现场入口及测试；graph worker，Plugin注册由integrator | T-07 | [ ] | 草稿/取消/保存失败、无leaf只保存、即时apply与类型/尺寸下次生效、apply失败区别于保存失败；完整替代后才删旧行 |
| T-11 | B-106/REQ-03 / B-106/AC-03 / B-106/AC-07 | 题图现场选项、编辑模式与不可变本次参数；featured-image worker，Plugin注册由integrator | T-07 | [ ] | 模型/数量/目录、取消零调用、保存失败不生成；默认值修改不漂移本次任务，连接变化停止后续请求 |
| T-12 | B-106/REQ-01 / B-106/REQ-08 / B-106/AC-01 / B-106/AC-03 / B-106/AC-06 / B-106/AC-07 | P2 EN/ZH、a11y/CSS/生命周期→freeze→gate→Desktop/real-iOS→review/fix；integrator + gate executor | T-09/T-10/T-11 | [ ] | 普通页面无技术配置、移动可达、保存/重开/关闭late回调，全部阶段证据 |
| T-13 | B-106/REQ-01 / B-106/REQ-02 / B-106/REQ-03 / B-106/REQ-04 / B-106/REQ-05 / B-106/REQ-06 / B-106/REQ-07 / B-106/REQ-08 / B-106/AC-01 / B-106/AC-02 / B-106/AC-03 / B-106/AC-04 / B-106/AC-05 / B-106/AC-06 / B-106/AC-07 | P3 最终契约、源码与证据核对；integrator + independent review | T-12 | [ ] | 同最终输入的全部验收可追溯；实施模式到Validated，不代替closeout/release |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Evidence Plan

先运行该 slice 最近的 suites；下列为最小风险证据分组，不表示每任务重复整组。
实际命令、自然退出、相关输入与产物身份在 Validation Log 记录；新增测试仅补未
覆盖风险，不为控件文字或字段映射的机械重复造测试。

| REQ/AC or risk | Change | Minimum sufficient evidence / command | Pass condition | Rerun / expansion trigger |
| --- | --- | --- | --- | --- |
| B-106/REQ-05 / B-106/AC-05；raw字段清理 | T-01 | `npm test -- --runInBand __tests__/settings.test.ts __tests__/pagelet-settings.test.ts __tests__/plugin-lifecycle.test.ts`；保护barrier时追加现有Memory migration/compatibility suites | 五旧键输出缺失、新键false保留、被保护sentinel不变；并发/失败不复活 | save/merge/provider事务/治理barrier改变，或fixture暴露冲突 |
| B-106/REQ-06 / B-106/AC-02；自动/手动隔离 | T-02 | `npm test -- --runInBand __tests__/pagelet-agent-quality-cache.test.ts __tests__/pagelet-agent-runtime.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/plugin-lifecycle.test.ts` | 自动pending/active取消；手动active/queued有效；过期epoch不得提交/交付；保存未完成/失败不得提前发布开启值 | scheduler/controller/trigger来源/identity/结果提交/偏好保存变化 |
| B-106/REQ-02 / B-106/AC-02；必要机制 | T-03 | `npm test -- --runInBand __tests__/memory-manager.test.ts __tests__/pa-agent-runtime-memory.test.ts __tests__/skill-context-provider.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-runtime-prompt.test.ts __tests__/chat-view.test.ts` | 无技术bypass；能力/来源拒绝仍有效；catalog和加载一致 | Memory admission、guide registration或Chat投影变化 |
| B-106/REQ-04 / B-106/REQ-07 / B-106/AC-04；独立学习与权限 | T-04/T-08 | `npm test -- --runInBand __tests__/memory-extraction.test.ts __tests__/retrieval-habit-profile.test.ts __tests__/data-boundary.test.ts __tests__/memory-control-center.test.ts __tests__/settings.test.ts`，load迁移追加plugin-lifecycle | 00/10/01/11及停用/旧值保全；无授权零新增收集/写入 | consent、来源范围、治理操作、legacy启用迁移改变 |
| 验证器不依赖已废弃开关 | T-05 | `npm run test:tooling -- --runInBand __tests__/retrieval-smoke-runner.test.ts __tests__/context-continuity-smoke-runner-script.test.ts`；Pagelet runner增加定向现有契约/实际smoke证据；ChatService窄构造接缝补source测试 | fingerprint覆盖新偏好；synthetic模型输入无catalog/load_skill且继续拒绝无关工具；生产默认不变 | runner/执行输入列表/capability隔离/ChatService构造改变 |
| B-106/REQ-01 / B-106/REQ-08 / B-106/AC-01 / B-106/AC-06 / B-106/AC-07；四区和保存 | T-07/T-08 | Settings/Chat/Memory控件现有suite补关键DOM与异步case；Desktop真交互 | 草稿、keychain、pending target、失败重试、关闭late结果全部保持 | group registry、local renderer、token/provider保存或DOM生命周期改变 |
| B-106/REQ-03 / B-106/AC-03；专业能力保全 | T-09/T-10/T-11 | local-graph/statistics/ai-service/settings suites加新Modal行为测试；场景化Desktop验证 | 替代入口全部可达、合法值保留、取消零调用、生成只在显式动作之后 | 现场入口/apply/生成参数或provider兼容性变化 |
| B-106/AC-07；移动真实输入与布局 | T-12 | 合成vault的real-iOS Settings：四组、折叠、token显式交互、文本编辑、保存失败/重开、精确记忆深链 | 实际触摸/键盘可用；被动操作不访问未知token；无焦点/滚动/状态丢失 | 相关资产/host/输入/布局改变；不能以Desktop缩窄代替 |
| P1/P2 phase gates | T-06/T-12 | 根AGENTS Local Validation Gate；冻结后`make deploy`；最终同产物real-iOS。覆盖后不单跑重复lint/build/full | source/tooling/artifact正确分组；当前产物部署且真实操作通过；fresh错误无新增 | 阶段后任何相关source/test/config/fixture改变或新finding |

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| D-01 | P1 | 现有旧总开关关闭会reset scheduler并取消显式请求 | 新后台偏好不入全局identity，automatic lane定向暂停与epoch | T-02设计及竞态测试目标 | 设计处理；实现待执行 |
| D-02 | P1 | merge先丢旧键会令迁移无法观察需写回；陈旧snapshot可重新写入 | raw存在性pending + 保存前精确strip，不全量merge | T-01 raw/load/save/conflict与barrier目标 | 设计处理；实现待执行 |
| D-03 | P2 | 图谱/题图没有完整PA现场配置入口，直接移除会丢能力 | 先新Modal/入口，再删除原行；统计已有tabs直接复用 | T-10/T-11入口与交互目标 | 设计处理；实现待执行 |
| D-04 | P1 | raw extraction=true可能覆盖显式paused/unconfirmed并重新授权 | 对齐合法legacy启用与显式consent优先级，00/10/01/11独立 | T-04 loader/consent目标 | 设计处理；实现待执行 |
| D-05 | P2 | 普通debouncedSave失败只有日志，Memory动作仍全量display丢其他草稿 | 受影响区域失败反馈/重试，管理局部refresh | T-08异步失败/关闭/草稿目标 | 设计处理；实现待执行 |
| D-06 | P2 | 三个现有runner依赖废弃字段，continuity probe以Skills开关隔离 | P1同步runner，保持isolated host拒绝行为 | T-05 tooling targets | 设计处理；实现待执行 |
| D-07 | P2 | 仅deny工具不能避免bundled catalog影响continuity输入，ChatService无透传接缝 | 提取私有实例createAgentRuntime；隔离service包装传null，生产不变 | T-05 catalog/load_skill输入及拒绝测试目标；独立设计复核通过 | 设计处理；实现待执行 |
| D-08 | P2 | 有效保存建议提示和分钟节流的去向不明确 | 明列operationsProactiveSaveSuggestionsEnabled有效入口；cooldown作为内部数值保留 | T-09提示保留/普通UI目标；独立设计复核通过 | 设计处理；实现待执行 |
| D-09 | P2 | 图谱apply不能覆盖类型/尺寸，保存失败与应用失败未区分 | 草稿/取消明确；保存后即时apply可用字段，类型/尺寸下次打开 | T-10现场与失败/重开目标；独立设计复核通过 | 设计处理；实现待执行 |
| D-10 | P2 | 题图多次await重新读全局参数，现有helper不接收快照 | Proposed只读RunOptions贯穿原helper/service，连接revision/currentness复验 | T-11默认值变化/连接变化/取消目标；独立设计复核通过 | 设计处理；实现待执行 |
| D-11 | P1 | 现有窄保存helper先改live值，保存失败前可能意外开启自动调用 | Proposed专用setter用queued snapshot保存，成功才publish新字段并sync自动lane | T-02延迟/失败/写后抛错/多次排队目标；独立设计复核通过 | 设计处理；实现待执行 |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-08 | B-106 全范围设计 | 三路只读源码核对：字段/调度、UI/现场入口、权限契约；核对HEAD与工作区 | 设计输入已取得 | 只读事实与Proposed接口明确区分；尚未验证运行时 |
| 2026-09-08 | B-106 全范围设计 | 三路独立设计review及修订复核：运行/保存边界、UI/现场入口、产品契约/任务覆盖 | PASS；无未处理设计P0/P1/P2 | D-01..11均有设计处理及实施验证目标；不代表代码修复或运行时PASS |
| 2026-09-08 | B-106 全范围设计 | `npm run docs:check`；`git diff --check` | PASS；均自然退出0 | 198 Markdown / 1626 local links；4项既有episodic-memory索引/孤立文档提示保持advisory。工作区仅文档改动，未执行runtime测试、build或App/device smoke |

## Closeout Readiness

- [ ] Owning contract 与最终实际行为一致。
- [ ] Required source/tooling/full gates、review 与 Desktop/real-iOS evidence 已记录。
- [ ] 无未处理 P0/P1/P2；未完成项仅按明确决策处理。
- [ ] 稳定结果吸收到 current contracts/tests。
- [ ] 在独立 closeout 授权后处置过程文档；不把设计/Validated 当发布。
