# B-173 单次写入、原生移动与收敛验证

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-12
Work item: B-173

本页保留独有故障、验收及限制，不作为当前实现权威。稳定行为由
[DEC-063](../../product/decisions/dec-063-direct-operations-and-native-move.md)、
[Current Spec](../../product/specs/pa-direct-operations-product-spec.md) 与
[Operations Architecture](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers) 持有。

## 授权与处置

Owner 已选择单次写入、移除多余 Confirm、保留 review/现有 Undo、结果连续性、
能力不足收敛及原生 move；随后确认引用由 Obsidian 负责，并授权 GPT 完成开发测试。
2026-10-12 明确要求 closeout B-173 并提交本地 master；推送、发布和私人 vault 部署
不在授权内。本次收尾未改运行代码、测试或配置，未重复模型或全量门禁。

Home/SDD/Tracker 吸收后删除，移除 Active 入口，不完整归档过程包。未提交过程原文
先保存至本机 `/private/tmp/b173-closeout-input/`，该临时路径不是长期资源，不声称
Git 已保存全部未提交过程。无本范围未完成项；B-159/F-24 和 B-171 M3 的延期保持。

## 根因与历史边界

实施源码基线为 `6dc27e7e`。原 capture `debug-mv3xw61w-3-w124yez` 中创建的 execute
约 583 ms 已 completed，但下一实际 provider 输入的同一 callId 为 result_unknown；
后续查询确认 completed，Agent 仍未收尾，用户约 644.7 s 取消。记录在约 497.8 s
到达采集上限，无法完整拆分最后一轮；内部每一步 lineage 未独立保留，不能将
截图 Running 或记录缺口当作完整 reasoning 证据。

真实输入/回执与确定性源码互证的旧丢失链是：普通执行文本未通过有限观察识别，
进入 unknown lineage 后被 `TaskSourceRun.prepareGenerationSnapshot` 排除；备用
`safeDomainIdentity` 又无法接受 applied.receiptId 中的 `JSON.stringify({intentId, receipts})`。
没有获准结果或备用身份后，action-history 的 resultContent 补入 result_unknown。
丢失发生于准入/投影，并非写入没有执行；当前闭合 owner 事实与独立不透明身份
同时修复两个缺口，不放行任意同名 JSON 或恢复被排除正文/参数。

当时缺少 move 和整文件 delete，复制无法完成移动；Undo 未参与慢执行，Confirm
不是该次创建的前提。执行前已有较长等待，不能把全部延迟归于单一因素。
私人笔记正文、路径及完整 reasoning 未进入仓库或后续模型验收。

## 工程证据与复用

| 检查 / 风险 | 结果与边界 |
| --- | --- |
| 结果、来源及 Undo 生命周期 | 结果链 focused 8 suites / 203 tests 与 core/UI 定向通过；实际下一 dispatch 见下文。完成后关闭原 owner 的 F-06 修复只降低 Undo 可用性，不抹 completed/逐项事实；现有跨 Chat、late-close 与 ChatService 回归通过 |
| 首次全量与窄诊断 | 389 suites 中 386 PASS；旧 stage/Confirm fixtures 迁移后 source-read 56 与 B157 tooling 55 tests 自然通过。Ghost 原 53 tests 的本机监听权限失败在允许本机端口的环境通过，无 Ghost 产品修订；原容量、伪造身份与来源强断言保留 |
| 最终冻结输入全量 | build/TypeScript、lint、DOM 零匹配及 diff checks 通过；`npm run test:all -- --runInBand` 389 suites / 9369 tests，248.039 s，原会话 95282 自然 exit 0。Jest 一秒退出提示后核实原进程自然退出，未强退或重复全量 |
| F-07 窄修与复用 | 首次真实移动成功、completed 连续且正常结束，但答复未经证明宣称全部引用已更新。只加一条工具说明限定路径成功与宿主引用职责；既有 Operations runtime 1 suite / 33 tests、lint/build/deploy-current 通过，并重验同一移动正例。其余全量输入不受影响，复用原通过，不新增类别或矩阵 |
| 构建与部署 | `make deploy-current` 后重载 test vault，实际加载工作树构建 manifest 2.10.9。dist 与部署 main.js 同 SHA-256 `617a0f0678bd1741f25dfda5cedbe4e2028ac73e50049c3ed92946b498ecc74c`；版本号不代表已经发布 B-173 |
| 收尾输入 | 50 个源码/测试与验收身份一致。按排序路径及文件 SHA-256 形成的本机接收清单摘要为 `daa3789a2ae06c65031d8c8a0fc9c639582c2725e48eb37581dd2314d68a4c3e`；closeout 仅改文档，复用有效工程/app 证据 |
| 收尾文档 | docs:check 301 Markdown files / 3906 local links 通过；现有文档 contracts 2 suites / 57 tests，6.893 s，自然 exit 0；diff 与新增文档空白检查通过，Active 包引用已移除。未重复构建、全量或模型验收 |

## 三类真实模型与界面证据

仅使用 repo-local test 的合成笔记及已配置 qwen/deepseek-v4-pro；开发、测试与独立
复核执行者均为 GPT。没有向 provider 发送私人 anthelion 材料，也无固定速度保证。

| 既有样本 | 原始观察与结论 |
| --- | --- |
| 能力足够：原移动续问 | preview 后真实输入“好的，帮我移动到对应目录”。run_mv43j5ws_xx1f2nly 的原 source leaf 路径 inbox→archive；下一实际 dispatch 1791739677983 保留 current_run completed，call_056e58731c9f4056859a97fa / intent 8451d04c-0e67-469e-b463-08ca569c4f10 匹配。可见答复 1791739681428、自然终态 1791739681429，即最后必要事实后 3.445/3.446 s；Applied 路径 review/full review、Undo→undone 实际操作通过 |
| 明确缺必要能力 | run_mv43ldfq_25534pce 要求整文件删除；一个实际请求、零效果、原笔记保留。目录事实→准确 incomplete 答复/自然 partial 11.967/11.967 s；未靠人工取消或 forced timeout 结束 |
| 已知部分完成后剩余不可达 | mobile run_mv43qidd_pwxgo362 的实际输入保留前次 completed append；准确保留追加、说明缺整文件删除能力，一个实际请求自然 partial。最后事实→可见答复/终态 10.601/10.602 s；标记仅一次，实际 Undo 后正文与原文完全一致 |

正例同份执行/下一请求/UI 证据覆盖 AC-01/03/05/06/07，不用 DTO、单独状态查询或
append 正例替代真实移动。两类不足按最后必要事实、最终答复、run 终态及有效活动
分别判断；长时间无进展后最终结束仍不能算通过。mobile 首个可观察模型内容约在
10.563 s，现有记录无法独立判断远端处于等待还是 reasoning，归因保留未知。

desktop preview 零写且无 Undo 回执，直接 apply 无 PA Confirm；compact/full review、
Undo/Undo all 均已实际操作。mobile simulator 的追加、完整审阅与 Undo 可达，原会话
重载恢复；dev:errors 无错误，console 无捕获消息。没有 iPhone、生产或跨设备结论。

首轮原生正反向调用观察到同一 TFile 身份；F-07 唯一变化是指引，原生接线未变，
该证据复用。宿主 alwaysUpdateLinks=false，正向 renameFile 弹出 Update links，选择
Do not update，设置保持；人工宿主选择不属于模型空转，也不是 PA Confirm。
修订后答复没有宣称所有引用已经更新，completed 只证明实际路径变化。

desktop-final 顶层路径布尔值后来被 Undo 导出覆盖，现值是 Undo 后态，不声称仍有
独立前置布尔快照。同 run 原始 CUA leaf 路径、真实 owner/下一 dispatch 与 review/Undo
共同闭合验收；独立 GPT 复核确认充分，未补造快照或为同一事实重复采样。

## 清理与证据保留

四个自建合成文件先备份再清理，三个自建会话逐条核实后删除。原 af26cbd5-e9f4-499c-8634-dd4e8ddd6c44
四轮会话、Web sources 和原 B-168 Debug 历史保留；mobile/streaming=false，临时 observer
不存在，dev:debug off 返回 Debugger detached。当前验收构建保留，无私人 vault 写入。

本机原始记录为 `/private/tmp/b173-desktop-observation.json`、`b173-desktop-final.json`、
`b173-mobile-final.json`；截图为该目录的 `b173-desktop-review.png`、
`b173-desktop-incomplete.png`、`b173-mobile-review.png`。全量、focused、lint/build 及
部署日志使用该目录既有 `b173-*.log`。这些临时文件不是新增审计持久化或长期资源；
关键事实和限制已压缩保留于本页，过程处置见 [Disposition Log](../disposition-log.md)。

收尾与 Git 检查按实际 receipt 报告；本页不代替提交签名、推送、CI 或发布结果。
