# Astra Feature Workflow Optimization Validation Evidence

Document status: Archived
Updated: 2026-09-07
Work item: B-115
Authority: T-01–T-06 的历史来源、流程试点结论和验证限制；不提供当前执行状态、模型试验或发布授权。
Current contract: [GOV-001](../../development/governance/gov-001-agent-managed-project-lifecycle.md)

## 范围与处置

2026-09-07，T-01–T-06 经各步授权完成并达到 Validated，用户随后明确授权
closeout、提交远端 feature 分支和合并 master。治理规则已吸收至 GOV-001、
[AGENTS](../../../AGENTS.md)、相关 skills、工作流及模板；本历史记录保留独有
证据，原 `docs/development/active/astra-feature-workflow-optimization/` 的
README 与 Tracker 按 `delete-after-absorption` 删除。GOV-001 保持 Current。
该终态处置不宣称后续 Git 交付或发布已发生，相关结果须由实际 Git/发布回执证明。

| 已完成步骤 | 稳定结果与证据范围 |
| --- | --- |
| T-01 | 复用 B-115/GOV-001 建立最小治理入口，区分已有成本信号与未知字段；不新建产品契约或外部状态镜像 |
| T-02 | 最小修改以完整满足需求、清晰职责与合理影响范围衡量；任务模板按实际授权和复杂度选择流程 |
| T-03 | 需求/风险映射最低充分证据；按输入身份、自然退出和真实观察复用检查；失败先区分产品、工具、环境与陈旧构建 |
| T-04 | 独立 review 核对真实入口、状态归属及不变量；分配互不重叠写入责任，由主 agent 冻结输入并统一调度昂贵 gate |
| T-05 | 旧环境历史采集与实际加载规则后的两项 Chat UI 切片分别评价；可得证据支持试点收口，不能量化提速或模型效果 |
| T-06 | 保留必要 gate；区分可选参考方法与必需结果/设备；明细由执行方保留，治理方链接结论；准确说明完整 namespace，不改 checker 或模型 |

## 环境与样本准入

首次跨机交付为 `codex/astra-feature-workflow-optimization-b115` 的
`6d418ba6953f5201eff8d4534c4506c580eb3785`，tree
`ce19c4417b03f49d5a0d9f57644de142be10711a`。本机按明确 ref fetch 后，新建
`/private/tmp/pa-astra-t05-20260907` 独立工作树。原 master `9d0f12ae…`、IME
detached `384c2470…` 均 clean，B-129 本地 `096a8727…` 与 tracking `7c712924…`
的既有差异保留；未用 checkout/stash/reset/rebase 覆盖这些工作环境。

master、B-129 与 IME 的 AGENTS、GOV-001、review/followup、SDD、双端 smoke、
refactor 和任务模板共 9 项均为旧规则 blob；新树匹配交付规则。AGENTS 为
`3d44c5f7…` → `a9b13cb1…`，GOV-001 为 `26fdcc18…` → `0544fbd8…`。
因此仅 fetch 不算规则应用，以下 H-01–H-05 不算完整新规则试点。

来源机 T-01–T-04 为 Linux、Node `v22.22.1` / npm `10.9.4`；配置快照为
`gpt-6-astra / ultra`、Plan 默认 `xhigh`、项目 verbosity `high`，不代表逐轮设置。
本机为 macOS、Node `v22.22.3` / npm `10.9.8`；续做 session
`01a07a4d-4685-7a91-ad51-5ce82859aafd` L8 `turn_context` 为
`gpt-6-astra / ultra`。本轮未指定模型 override，不为历史或其他线程补写设置。

## H-01–H-05 独有历史采集

原历史产品证据见 [B-129 验证](./b129-multimodal-chat-validation.md)。以下是
2026-09-07 定点读取原记录所得，未重跑 B-129、迁移整份 session 或补算耗时。
`L` 为原 JSONL 行号，原时间均为 2026-09-06 UTC；完整 inline 参数可沿 call ID
或行号查回。命令缩写只是历史定位，不是新的可执行脚本。

- **S1**：`01a074d7-f5b0-7050-9d72-bf6104cf107b`，
  `~/.codex/sessions/2026/09/06/rollout-2026-09-06T11-51-45-01a074d7-f5b0-7050-9d72-bf6104cf107b.jsonl`。
  C-01/C-02 的 `turn_context` 为 L6807/7917/9083，C-04 为
  L11098/12092/12654/13168，均为主会话 `gpt-6-astra / ultra`。
- **S2**：`01a0773b-d83f-7080-ad6b-2617e81a0917`，
  `~/.codex/sessions/2026/09/06/rollout-2026-09-06T23-00-05-01a0773b-d83f-7080-ad6b-2617e81a0917.jsonl`。
  L493/529 的 AC-09 执行轮次为 `gpt-6-astra / medium`；L494 为用户要求补齐
  AC-09。更早 ultra 轮次、默认配置、子 agent 和 PA 的 Qwen 均不能代填。

| 历史样本 / 来源 | 原结果与计时 | 结论与不可扩大的范围 |
| --- | --- | --- |
| H-01 / C-01：保存重试，B-129/REQ-10、B-129/REQ-11 / B-129/AC-10、B-129/AC-11。S1 L7482/7500、L7678/7694；`call_NTm9joIiFcxTG54Dsw54bStw`、`call_TVF4wtVgLwG4U4XP1Sgke8HU` | `obsidian vault=test eval` 调用 `__b129ProductionServicesSmoke`；desktop-01 的 case 09 报 `retry_not_idempotent`，desktop-02 核实 11/11、attachmentsEqual/noteExact 及 note hash。[01 回执](./b129-multimodal-chat-evidence/p5/desktop-services-01.json) 起止 10:15:56.395–10:15:56.898，[02 回执](./b129-multimodal-chat-evidence/p5/desktop-services-02.json) 10:21:23.966–10:21:24.404；case 09 为 19 / 17 ms | runner 对象键序比较改为语义核对，产品未因误报改动。CLI session 65736/32061 无自然退出终态；回执无顶层 elapsedMs，返工总耗时未知。19/17 ms 不作提速对照；读日志 exit 0 不等于 runner exit 0 |
| H-02 / C-02：精确正文保存，B-129/REQ-10 / B-129/AC-10。S1 L9027/9030、L9041/9044；`call_rvbwbdCE4w4L3RrDFUnShRHp`、`call_u0h8Po1j91kkXNeJpCcSfZTE` | inline checker 的 bodyStartsExact=false，经完整 header 长度复核改为 true；两次 exec_command 均 exit 0，0.66293225 s / 0.649817083 s；同笔记 noteUnchangedSincePrior、finalNoteHashMatch、formalHashMatch 均 true，receipt completed | 原 `indexOf("\n---\n\n")+7` 错算边界，只修 checker。外层 exec 5.1 s / 6.5 s 不与内层相加；排查与 UI 保存总耗时未知 |
| H-03a / C-04：IDB 生命周期，B-129/REQ-03 / B-129/AC-03。S1 L11861、L11899、L11963/11989；`call_jlpZMejYNQXeQg3u7zs9va4n` | stable realm 修复后，`npm run test:all -- --runInBand` 日志 `/tmp/b129-stable-idb-tests.log` 为 238 suites / 6202 tests，Jest 111.107 s；有退出等待 warning，原 session 81819 后续自然 exit 0 | 临时活动窗口 IDB factory 生命周期是真实产品修复；必要验证不能归为浪费。Jest 时间不等于修复或端到端耗时 |
| H-03b / C-04：兼容升级。S1 L12036/12039；`call_0y5B9fcWv4EszxsjKCwSNger` | desktop-upgrade-02 返回 safely_refused/legacy_projection_mismatch，命令 exit 0、0.645426542 s；修复后拒绝原因变为 profile_evidence_unsupported。[Desktop 02](./b129-multimodal-chat-evidence/p5/compat-upgrade-desktop-02.json)、[Desktop 03](./b129-multimodal-chat-evidence/p5/compat-upgrade-desktop-03.json)、[iOS 01](./b129-multimodal-chat-evidence/p5/compat-upgrade-ios-01.json) 顶层 elapsedMs 分别 21/20/95 | 比较对象错误为产品修复；Profile/兼容字段/迁移身份/回滚期限保留。安全拒绝不算升级成功。25 项相关测试、TS/scoped lint/review 仅复用 B-129 归档汇总，主会话 scoped 原命令与独立耗时未知；外层 14.0 s 含另一命令，不全归升级 |
| H-03c / C-04：同设备 Blob 恢复，B-129/REQ-03、B-129/REQ-05 / B-129/AC-03、B-129/AC-05。S1 L13669、L13774/13792、L13801/13804、L13828 | 真实 iOS 报 cacheRead NotFoundError / URL Load failed；`npm run build` 原 session 39833 exit 0；`make deploy-current deploy-icloud-current` exit 0、0.931540792 s；实际加载 `327f06e…`，14:40:44.977。原日志分别为 `/tmp/b129-cache-recovery-build.log`、`/tmp/b129-cache-recovery-deploy.log` | 复用全量基线、补窄修检查与真实 reload；B-129 入链回执证明 PNG/HEIC 恢复，无新模型调用。build、定向回归和整段 iOS 时长未知 |
| H-04 / C-03：AC-09 gate 调度。S2 L661、L692/696、L712/719、L743；`call_fRmYmXGLiILVUln1wCqGc3Av` | `make deploy` 日志 `/private/tmp/b129-ac09-deploy.log` 报 238/6210、Jest 104.632 s 和退出等待 warning；随后 local_production_build_provenance_checkout_mismatch / current_plugin_artifact_stale，`make: *** [deploy] Error 1` | 主 agent 于全量期间 15:42:09.676–15:42:10.850 应用 review 引出的 ChatHost/chat-view/plugin 修复，是输入未冻结，并非两个编辑者争写。整体 deploy 失败，原 session 59602 最终 poll 未见；混合输入断言或读日志 exit 0 不记最终 gate PASS |
| H-05a / C-05：AC-09 review 后通知回归。S2 L730/743；`call_dCgirxzUzXHj3eMMTVCZNQq1` | `npm test -- --runInBand` 选 plugin-lifecycle、chat-view、chat-writing-style-service、writing-versions 四个 `__tests__/*.test.ts`；日志 `/private/tmp/b129-ac09-focused.log`，session 3599 exit 0，4 suites / 302 tests，Jest 1.93 s | 覆盖 Forget 首次提交后清理失败仍须使已显示样例失效的新修复；必要回归，只证明对应四套件 |
| H-05b / C-05：重建与 artifact。S2 L747/765；`call_A0WyrFAvnIXR2g2z95w3b5vY` | `npm run lint && npm run build && npm run test:artifacts -- --runInBand && make deploy-current`；复制日志 `/private/tmp/b129-ac09-copy.log`，session 69524 exit 0，2 suites / 61 tests，Jest 20.951 s；最终 Desktop `cbebae7e…` 与 UI 见 B-129 归档 | 源码变化使旧构建失效，重建后验证/复制。build、复制各自总耗时未知；合成内存治理夹具不等于真实旧库升级或生产 Forget 全流程，AC-09 本轮未新增 iOS 证据 |
| H-05c / C-05：复制隔离补测。S2 L769/781、L792、L800/820 | `npm test -- --runInBand __tests__/chat-view.test.ts`：session 16120 exit 1，208 PASS / 1 FAIL，Jest 0.864 s；测试按钮选择器 Copy text 改为 Copy writing 后，session 48694 exit 0，209 PASS、0.804 s | 断言误选不存在按钮，只修测试。末轮另有 esbuild 合成夹具编译 22 ms，不计入 Jest；排查总耗时未知 |

H-01/H-02 的 checker 诊断与 H-03c/H-05 的按变化补测是局部同等实践；它们
不能证明当时已完整应用切片映射、独立 review 可接手性及冻结规则，H-04 还是
冻结失败的反例。所有缺失字段保持未知，不从消息/回执间隔计算总时长，不相加
外层/内层或并行任务，也不把全仓测试数当新增数量。不同轮次 ultra/medium
不是单变量模型试验，不能证明模型责任、节省比例或诊断提醒阈值有效。

## 新规则试点与 T-06 结论

用户随后明确选择图片 copy/paste 收拢与保存表单简化，在加载规则的新树内执行
两项真实后续切片。产品 gate、review/修复、实际加载身份、成本明细和用户反馈
只保留于 [Chat 图片体验验证](./chat-image-experience-validation.md)，不将旧
B-129 或首次 docs-only 采集重标为该试点。两切片的必要自动化、独立 review、
真实 PA 观察与修复后复核齐备；用户“手动复制粘贴符合预期”仅验收 paste，
保存依已有实测，未冒充用户保存验收或直接 Codex 对照。

新证据支持规则可用于真实工作，并能区分必要重跑与工具返工。R-04–R-06 由
真实 UI 暴露，说明实机门不能被自动化代替；冻结只保证当前输入，后续修复仍
使旧证据失效。Jest 退出等待 warning 与最终自然 exit 0 均保留，未强制终止。
完整分项和同任务受控对照不足，仍不能声称流程已更快、量化提速或调整模型。

T-06 只吸收已观察结论：可选参考/诊断方法不可用不额外成为交付门；明确指定
比较、技术选型、未满足 AC 或设备门仍然有效。执行方保留明细、治理方链接结论；
完整 namespace 映射可用本次/继承短表，不意味着重新实施或重跑全部验收。
一次已解决的 28 个完整 ID 适配、UI 工具长等待或测试编写错误，均不足以支持
改造 checker/测试系统、调整等待阈值或模型；本轮保留原命令与必要门禁。

| 治理验证 | 最终可复用证据 |
| --- | --- |
| T-01–T-04 | 各步 docs/diff 与 2 suites / 58 docs contract tests 通过；受影响 lifecycle、review/followup、双端 smoke skill 结构检查及窄修/完整请求/指定步骤/并发冻结文字走查通过。该范围为规则验证，不是产品实机或提速实测 |
| T-05 首次历史采集 | 本机 `npm run test:docs -- --runInBand`，session 97395 自然 exit 0，2 suites / 58 tests、Jest 7.886 s；docs 192 Markdown / 1559 links，自然 exit 0，4 项既有 advisory。它不替代随后产品试点门禁 |
| T-06 规则/契约 | `/usr/bin/time -p npm run docs:check` 自然 exit 0，194 Markdown / 1578 links、real 0.40 s；`/usr/bin/time -p npm run test:docs -- --runInBand`，session 96962 自然 exit 0，2 suites / 58 tests，Jest 8.376 s / real 8.85 s，日志 `/private/tmp/pa-astra-t06-docs-tests-20260907.log` |
| T-06 最终回填/独立复核 | `npm run docs:check`，session 76802 自然 exit 0，194 Markdown / 1579 links；tracked/untracked 空白无诊断。可选参考受阻、指定设备缺失、输入变化、跨 track 采样及局部 followup 五场景通过；两项旧状态/明细归属残留已修并独立复核，未重复未变输入的 Jest |

上述 docs 结果均保留相同 4 项 Episodic Memory 既有 advisory，不是本轮新增
回归；各命令时间不相加为端到端成本。T-06 不改源码、测试、脚本、依赖或模型，
产品冻结输入和已加载资产保持不变。

closeout 的 `DOCS_CHECK_BASE=6d418ba6953f5201eff8d4534c4506c580eb3785 npm run docs:check`
最终自然 exit 0：192 Markdown / 1564 local links，仅相同 4 项 advisory；
diff check 通过。初轮曾因删除文件后两个空 Active 目录仍存在而报四项不完整包，
移除空目录后通过；没有改变 checker。复用输入未变的上述 58 项文档契约测试和
产品完整 gate，未为结果回填重复 Build/Jest/B-129。

## 限制与重启条件

- Codex App 无法被 Computer Use 读取、系统文件选择器无法提交损坏夹具的原因
  未知；PA 库内错误入口通过不等于原系统入口通过。只有后续明确要求相关比较/
  设备验证，或正常产品输入复发并改变结论时，再作定点采集；不重跑 B-129 矩阵。
- coding、测试编写、工具/设备等待、review 和接手等分项成本不足，模型因果
  未知；后续成本研究需明确范围及可比样本，模型试验仍需单独授权。
- checker 当前要求 Tracker 和存在的 SDD 出现 owning contract 全部完整 ID。
  只有明确子范围反复产生可定位的继承映射维护成本时，才评估显式、默认关闭
  的局部 scope；需先覆盖完整包漏项、非法/跨 Work item ID、缺少 scoped 映射、
  可选 SDD 及 GOV 一致性等反例。当前单组 REQ/AC 夹具不能证明新机制安全；
  该候选不是已有能力或已授权实现，未用 Governance lane/known-finding 绕门禁。

未开始候选由 [Backlog](../../backlog.md) 按重启条件承接；本归档只保存本次
判断依据，不承担新的执行状态，也不自行授权继续开发、模型调整或发布。
