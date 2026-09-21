# Recoverable Agent Execution Development Tracker

Document status: Current
Delivery status: Planned
Updated: 2026-09-21
Work item: B-144
Authority: 本 track 的唯一执行状态、任务顺序、验证证据及跨会话接续入口。
Product spec: [Product Spec](../../../product/specs/pa-recoverable-agent-execution-product-spec.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: T-00 设计文档交付完成；Owner 已逐项确认 DEC-040 产品原则，文档 gate 与独立只读设计审阅通过。本轮仅写文档，Delivery status 保持 Planned。
- Next action: 后续收到实现授权时接受工程设计、核对基线变化，按 T-01 至 T-05 推进。
- Blocker / decision needed: 无未决产品选择；尚未授权本轮运行代码实施、部署或发布。Owner 已授权本次设计文档 commit 并推送远程 master，传输结果以实际 Git 提交与远端验证为准。SDD 的 DF-01..04 是对应切片的技术核对工作。
- Last verified behavior: 本轮核对源码基线 `05fb1671fa59aa4ee18b7a277c2042000059bcc2`；旧空回答修复证据见[诊断记录](../../validation/pa-agent-empty-answer-diagnosis-2026-09-21.md)。B-144 无运行验证证据；不将旧 316 suites / 8050 tests 结果复用为新设计 PASS。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-00 | B-144/REQ-01 / B-144/AC-01 至完整 Product Spec | 固化 Owner 决策、源码设计、实施与验证映射 | [x] | 2026-09-21 文档检查、2 suites / 58 tests、diff check 与独立设计审阅通过；仅文档 |
| T-01 | B-144/REQ-03 / B-144/AC-03；B-144/REQ-04 / B-144/AC-04；B-144/REQ-06 / B-144/AC-06；B-144/REQ-08 / B-144/AC-08 | 执行结果、失败/成功复用、恢复/进展及统一结果骨架；去除同职责旧分支 | [ ] | 先覆盖同参数失败、unknown/partial、候选反馈与空答案 |
| T-02 | B-144/REQ-01 / B-144/AC-01；B-144/REQ-02 / B-144/AC-02 | 已读版本、动态授权、写入目标及派生摘要；依赖 T-01 恢复语义 | [ ] | 编辑/背景刷新与撤销对照，含 SDK 物理 retry |
| T-03 | B-144/REQ-05 / B-144/AC-05；B-144/REQ-06 / B-144/AC-06；B-144/REQ-10 / B-144/AC-10 | 30 分钟期限、Chat/Pagelet 预算、操作调度与共享资源；依赖 T-01/T-02 | [ ] | 不在保持整 run 排他租约时单独放宽时限 |
| T-04 | B-144/REQ-03 / B-144/AC-03；B-144/REQ-07 / B-144/AC-07；B-144/REQ-08 / B-144/AC-08；B-144/REQ-09 / B-144/AC-09；B-144/REQ-11 / B-144/AC-11 | Writing 领域状态、交付前验证、UI/history、重载后用户继续；复用 T-01 结果骨架 | [ ] | 普通 Chat、native/legacy writing、确认卡、恢复/中断与历史 |
| T-05 | B-144/REQ-12 / B-144/AC-12 | 观测、全链路回归、真实 app 验收、当前契约吸收及清理 | [ ] | 所有必需切片证据齐全后方可 Validated |

T-01 先建立候选/结果接缝，T-04 完成领域迁移，不允许中间切片假报写作已完整可恢复。每片保留有效保护并删除已替代分支。若需要分派，按状态 owner 划分互不重叠文件，GPT 负责 authority 与验收；worker 路由遵守当前 GPT-6/GLM 工作流及有效授权，不从旧任务授权静默外推。

## Validation Planning And Reuse

| Risk / change | Minimum sufficient evidence / command | Pass condition | Rerun / expansion trigger |
| --- | --- | --- | --- |
| 文档权威、链接、全量 REQ/AC 映射 | `npm run docs:check`；`npm run test:docs -- --runInBand`；`git diff --check` | 无新增 gate 错误；既有 advisory 独立记录 | 文档/契约/索引变更 |
| T-01 恢复、去重、实际副作用 | `npm test -- --runInBand __tests__/pa-agent-loop.test.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-answer-completion-policy.test.ts __tests__/pa-agent-batch-preflight.test.ts` + 对应现有工具测试 | red→fix 保护真实行为，unknown 零重复提交 | 执行状态/重试/去重或工具语义变化 |
| T-02 来源与派生关系 | focused runtime-memory/context/stream-fallback 与 memory-manager、vss 相关套件 | 普通编辑继续；撤销/写入冲突仍阻止实际操作 | 投影、治理、摘要、来源记录变化 |
| T-03 时间与并发 | loop/dispatcher/coordinator/Pagelet focused；虚拟时钟及 adapter 集成 | 30min 边界、override、公平、取消、无嵌套锁死；健康长任务继续 | provider/transport、queue、deadline 输入变化 |
| T-04 交付/历史/重载 | writing-preview/stream-bridge/chat-view/history focused；实际 Obsidian 路径 | 可修正候选回循环；正文/终态一致；旧记录可读且不重放 | persisted 字段、native/legacy、UI 状态变化 |
| 共享行为切片退出 | `npm run lint`；`npm run build`；`npm run test:all -- --runInBand`；DOM source scan；diff check | 自然退出成功、正确测试组、输入冻结 | 新失败、代码/config/dependency 变化 |
| 每个影响运行/UI 的切片 | `make deploy` 或检查已覆盖且当前 build 有效时 `make deploy-current`；repo test vault 实际 smoke | 加载身份可核对，受影响可见交互成功 | 部署/目标/输入变更，不能以另一个 vault 代替 |

完整 `make deploy` 已覆盖 lint/build/full Jest 时不重复；昂贵 gate 对同一冻结输入只运行一次。新测试名由实际落地的行为决定，不为了满足表格造镜像测试。源码/adapter、app、模拟器、真机和真实 provider 证据分别记录。涉及移动原生取消/挂起等无法由 adapter 证明的风险时安排对应设备证据，不做无依据的全设备矩阵。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | Design | 失败调用被 seen-key 去重与失败强制收尾叠加 | T-01 分离复用/重试/无进展 | SDD 基线与执行契约 | Planned |
| F-02 | Design | 新鲜度与授权/写作来源绑定 | T-02 分离版本、授权与写入目标 | SDD 基线与 DEC-040/D1 | Planned |
| F-03 | Design | native writing 尝试即终止，交付在 agent_end 后再验证 | T-01 接缝 + T-04 领域化 | SDD 交付顺序 | Planned |
| F-04 | Design | 长期限与容量一整 run 锁共同造成排队风险 | T-03 同步迁移期限与调度 | 双任务和共享锁测试 | Planned |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-21 | 全量产品边界 | 本次用户逐项确认及源码定位 | 已核对 | DEC-040；30 分钟、后台完成导向、重载后用户继续均有明确选择；工程方案未实现 |
| 2026-09-21 | 全量文档映射 | `npm run docs:check`；`npm run test:docs -- --runInBand`；`git diff --check` | PASS，均自然退出 0；2 suites / 58 tests | 226 Markdown / 1984 links；4 条既有 episodic-memory unindexed/orphan advisory，无新增；本轮不运行 runtime build/app smoke |
| 2026-09-21 | 全量产品与设计边界 | 独立只读审阅 Decision、Spec、SDD、Home、Tracker | 无必须修改项 | 核对快照/动态授权、未知副作用、30 分钟期限、真实名额占用、writing 交付与重载范围；工程参数仅 Proposed，不是运行验证 |

## Risks And Rollback

- 来源改造过宽：保持逐次实际授权与派生链测试，普通编辑与撤销分开；失败回退完整投影/交付切片。
- 长请求或 unknown 操作失去资源归属：保留 attempt 身份与真实占用，不以本地计时器当远端停止证据。
- 并发暴露共享状态：按 run 隔离，嵌套 provider 调用复用操作租约上下文；写锁不跨用户/网络等待。
- 交付状态迁移：新字段可选、旧 reader 保留；失败保留作品/操作记录，回滚不删除或重放。

## Closeout Readiness

- [ ] 产品/当前 Architecture 与实际行为一致；文档中的目标行为已按证据吸收。
- [ ] 所有 AC、所需 review 与 app/平台证据齐全，技术核对项已关闭。
- [ ] 剩余工作按真实原因进入 Backlog；不把 Draft 设计当 Validated。
- [ ] 临时资源按任务归属清理，保留必要证据与用户状态。
- [ ] 稳定内容吸收后删除过程包；只归档有唯一价值的证据；Git/发布单独授权。
