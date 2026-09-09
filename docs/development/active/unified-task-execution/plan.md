# Unified Agent Task Execution Delivery Plan

Document status: Approved
Updated: 2026-09-09
Work item: B-135
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Approval scope: Owner 全量实施目标授权已确认范围按本计划执行；Tracker 的 Pending 产品选项不在批准范围内，其依赖任务仍须先取得真实答复。
Product spec: [Unified Agent Task Execution](../../../product/specs/pa-unified-task-execution-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

把已确认的主 Agent 语义决策、有效个性化背景、可靠作品及默认学习落实成可分片验证的实现。全部新增变更、旧契约修订、迁移、回归、App/device 证据和最终吸收都由 B-135 承担。

不新增独立分类 Agent、通用工作流、全文遥测或自动保存；不重开旧 track；不改 VSS 算法、媒体支持与高后果权限。分片不能以暂时删除旧产品能力来获得通过。

## Dependencies And Source Surface

源码核实输入为 local/remote master `8be89c4c0318a2a1320314cd305027f3da03af7c`。设计工作树仍以 `c923ee22089ef3e669b275718bce6052e98d7749` 为基线；两者差异只有发布规则/工具变更，B-135 源码相同。实施前重新核对实际基线；采用最新 AGENTS 的 gate，不把旧 worktree 当发布源。

| Surface | Existing entry / dependency | B-135 responsibility |
| --- | --- | --- |
| Semantic routing / source | `pa-agent-required-capability-policy.ts`、`pa-agent-control-policy.ts`、`chat-tool-prepare-helpers.ts`、prompts、runtime | 移除语义硬分类及预测补查，保留真实可用性、来源和权限检查 |
| Context / continuity | `context/PaAgentContextProjector.ts`、history、summary、runtime | 材料/个性化用途分开，完整历史优先，每次物理输入重验 |
| Completion / budget | `pa-agent-loop.ts`、`pa-agent-chunk-consumer.ts`、`pa-agent-runtime.ts`、stream bridge | 完成证据及时传递、单一硬截止、软过渡及可读中断 |
| Writing / UI / save | `writing-output.ts`、ChatView、`writing-style-service.ts`、WritingVersionService | 原协议兼容、新输出及预览、准确版本/图片、保存与风格治理 |
| Learning / settings | `settings.ts`、`plugin.ts`、`retrieval-habit-profile.ts`、Type A、`chat-memory-admission.ts` | 新默认有效准入、旧值迁移、真实退出、宿主来源与语义候选的分层 |
| Operations | runtime policy engine、Operations proposal / confirmation service | 获准后替换提议语义判断，保留 opt-in、core tools、确认、stale-safe 与 Undo |

文件/方法与拟新增接口的准确区别见 [SDD](./sdd.md)，任务和命令见 Tracker。旧 B-106/B-118/B-128/B-129 的验证只证明各自输入，不能代替新组合行为证据。

## Phases

| Phase | Outcome | Scope / dependency | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| P0 设计冻结与可行性 | 未决产品取舍解决，执行接口可验证 | T-01–T-04；native/provider、来源、混合消息与 reader 最小对照分别记录 | 产品选择有真实依据；source-verified SDD；无未处置 P0/P1/P2；native 兼容失败则重新决定路线 | Pending路径未批准不实现；已确认且不依赖该选择的可靠性/恢复工作继续 |
| P1 可靠结束与可读恢复 | 完成事实不丢、期限可解释、中断正文可读 | T-05–T-07；不依赖 native 被采纳 | finish/EOF/length/deadline/格式/array chunks 自动化对照；真实旧协议 Desktop 中断与恢复 smoke；最小 gate、review/fix | 未过关不标该阶段完成，不用新协议掩盖旧故障 |
| P2 学习默认与治理 | 默认真正可运行，关闭可靠，语义来源不污染长期风格 | T-08–T-11；依赖迁移选择、混合消息两条最终准入验证 | 新旧 settings 和实际 scheduler/collector/Personal/style 组合测试；Desktop 与受影响 iOS 设置/退出/遗忘 smoke；review/fix | 字段或准入不明时不写新迁移标记；未通过旧 reader 不写不兼容格式 |
| P3 统一语义与取材 | 主 Agent 根据目标取材，个性化/历史/权限保真 | T-12–T-15；依赖 D1 执行设计和已确认 Operations 范围 | 原句/否定/引用/混合任务真实模型对照；物理请求与整批准入测试；Desktop Chat/Operations smoke；review/fix | 权限或来源保障缺口未闭合不进入作品协议迁移 |
| P4 作品完整交付 | 单一主 Agent 完成创作/续写与确切保存 | T-16–T-19；native P0 通过，P3 接缝稳定 | 普通/作品终局、增量预览、版本/来源/图片/旧 reader 自动化；当前 provider、Desktop 和受影响 iOS 全流程 smoke；review/fix | 无兼容证明不切换默认协议，不静默 text-only 降级 |
| P5 全量验收与契约吸收准备 | 全部 17 项 AC 有证据、旧边界无回归 | T-20–T-22；输入冻结后统一 broad gate | lint/build/full test、docs/community source check、未覆盖 App/device/provider；同输入质量/成本对照；跨模块 review/fix | Validated 后等待明确 closeout/Git/release 授权；不以文档 PASS 标功能完成 |

P1/P2 在边界不重叠时可安排独立人员取证，但单一 Tracker 管理状态；共同 `plugin.ts`/runtime 输入不得并发写。每阶段按 implement → focused validation → independent review → fix → verify；审查的文件所有权明确，昂贵 gate 只由一个执行者运行。

## Risks And Rollback

| Risk | Prevention / detection | Rollback / fallback |
| --- | --- | --- |
| native tool 参数仍截断或 provider 不兼容 | P0 真实模型、转义/Unicode/chunk、正常工具结束与 tail 异常对照 | 停止切换；保留旧 reader 与已成版作品；若换正文块，先另作明确技术决定，不运行时自动双协议 |
| 完成证据与 tail 接收混淆 | 生成结束、transport、schema 三轴测试；不将 unknown 填 stop | 独立回退预算适配，保留已证明的完成事实与无正文诊断修复 |
| 默认迁移复活真实停用/伪造历史 | raw settings 分类、migration 与权限保存原子边界、11/10/01/00 测试 | 保留原字段/治理数据；修复版本解析，不清空用户设置或倒造 confirmedAt |
| 旧 reader 丢失新增 provenance/版本 | 加法 metadata、未知 fail-closed、旧/新 fixture 对照 | 写入前验证；旧 reader 不兼容则不宣称可降级，不改写历史以掩盖 |
| Personal 与任务材料混淆 | 物理输入来源/用途快照、当前笔记事实断言、跨轮更正 | 保留已授权背景，不回到全清空 bootstrap；缩小受影响机制并重新设计 |
| 语义提议扩大动作权限 | 原 opt-in/core tools/确认/stale-safe/Undo 测试保持 | 回退提议适配，执行服务不放宽 |
| 多阶段证据漂移 | Tracker 记录输入身份与复跑触发；最终冻结统一 gate | 新变更只失效相关证据；shared/config/dependency 漂移扩大复跑 |

## Validation Strategy

- 自动化检查证明宿主不变量；真实模型证明语义和当前 provider 输出能力；App/device 证明可操作性，各自不能互相代替。
- 当前文档 slice 仅运行 `npm run docs:check`、`npm run test:docs -- --runInBand`、`git diff --check`。
- 实现的最小命令、通过条件与扩大触发维护于 Tracker；相关测试由实际模块选择，不盲目全跑。阶段所需 App/device 门不得拖到最终再补。
- broad 共享改动最终运行 `npm run lint`、`npm run build`、`npm run test:all -- --runInBand`。`make deploy` 若已覆盖相同输入则复用；合格 production build 使用 `deploy-current` 需满足 AGENTS 证据条件。
- UI/DOM 使用 AGENTS Local Validation Gate 的社区源扫描；真实 iOS 和 live provider 需对应环境/授权，无法执行即记录 NOT TESTED，不能标为通过。发布与安装验证不是本次设计已完成事项。

## Approval

- Plan authority: Owner 2026-09-09 要求制定 B-135 SDD 开发任务，并将全部新增工作集中在 B-135。
- Approved on: 2026-09-09，依据Owner后续“按照b-135的方案设计以及sdd任务安排，完成所有的b-135的任务”；批准已确认范围的执行，不替代Tracker Pending产品答复或阶段证据。
- Authorized implementation scope: Owner 后续全量实施目标已授权已确认范围的实现与验证，具体执行状态以 Tracker 为准；未决产品选择不由一般实施授权代替。Git/release 和显式 closeout 保留各自边界。
