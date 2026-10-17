# B-178 Chat 本次修改单卡汇总验证

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-18
Work item: B-178

本页保留最终验证、已修问题和证据限制，不作为当前实现或执行状态权威。
稳定行为由 [DEC-068](../../product/decisions/dec-068-chat-request-change-summary.md)、
[Product Spec](../../product/specs/pa-chat-request-change-summary-product-spec.md) 和
[Operations Architecture](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers) 持有。

## 授权与处置

Owner 确认单卡预览、完整展开、整次「撤销 / Undo」和中英文，先要求设计及独立团队审查，
随后于 2026-10-17 授权按 B-178 实现、测试和 repo-local test 库交互。2026-10-18 追加完成度
审查发现四项 P2，用户授权修复；修复验收后明确要求收尾并提交本地 master。没有推送或发布授权。

接收基线 master `03f4733445f1110a6ba34b2c943514b4f0796cfd`。GPT-6 负责产品、文档、
独立验收与 app；唯一 GLM writer 使用既有 pa-glm / ZAI / glm-5.3 / max，原隔离树和同一
CLI thread `01a14a06-177d-7592-a5a5-5405a30a84a8`，最终接收的交付轮次均自然结束；
早期中断或限额过程不计作成功证据。
原设计的恢复、产品、比例三 lane 及实现定向复核均完成，R-01..20 已解决，无本范围未完成项
或待定产品选择。不新增 Backlog，也不关闭其他 track。

最终规则吸收至当前契约及既有 focused tests；Home/SDD/Tracker 与 Active 入口删除，
仅保留本紧凑记录，见 [Disposition Log](../disposition-log.md)。未提交过程原文及终态 Tracker
保留于本机 `/private/tmp/pa-b178-closeout-53dqk9um/`，不声称旧 Git 含完整过程包。

## 确定性证据与复用范围

| 范围 | 验证与结论 | 边界 |
| --- | --- | --- |
| 请求聚合与差异 | Chat/session/model/UI 回归验证 canonical run、SDK 子操作、去重/下一请求隔离、连续 A→B→C、断点/表示身份、preview 分区、全部 blocks 和真实资源效果 | 沿用既有 diff 与 owner，不新增持久账本、依赖图或模型摘要 |
| 整次恢复 | controller/editor SDK 50/50；真实逆序、未知/无回执屏障即停、共享效果占位、timeout 后原生 await、三调用交接、恢复 lifetime 和逐步失效保护 | 原权限、身份、当前 Data Boundary、CAS/checkpoint 保持；不保证原子回滚 |
| 完整收口 | R8 平台 guard、完整 lint、production build 和 full Jest 397 suites / 9705 tests 均自然 exit 0，社区扫描无匹配、diff 通过 | `/private/tmp/pa-b178-gates-PgxvIw/`；lint 仅 Node stack4096，规则/globs不变；无 forceExit/跳过或弱化断言 |
| 远隔差异展示补修 | R9 UI 23/23；gap 不再合成错误的无末尾换行标记，真实无换行语义保持；当前 build/deploy 后中文旅程通过 | `/private/tmp/pa-b178-r9-X5hixM/`；只两份文件变化，未变全仓/恢复证据复用 |
| R-17..20 补修 | R11 session/UI/locale 64/64；R12 仅校正现有两 fixture 后 session 24/24，其他40项输入未变。runtime/UI reviewer 检查实际 diff 后关闭问题 | `/private/tmp/pa-b178-r10-Z9q0lg/`、`pa-b178-r11-yt8OfY/`、`pa-b178-r12-mrExb2/`（后两者同属 `/private/tmp/`）；两 fixture 的双 prepared IDs/path 与结果一致，修 fixture 不算产品红灯 |
| 最终运行时输入 | 主控完整 lint、production build（含 TypeScript）、社区扫描、diff、deploy-current 均通过；18份 source/tests 与已验证 writer 一致，只接收补修7份，其余11份不变 | R12 `integration-final.json`、`root-lint.log`、`root-build.log`、`deploy-current.log`；没有因换阶段或提交重跑完整测试/模型 |

R-17..20 的最终修复：恢复过期使用准确中英文语义；SDK Undo 的终态不覆盖已恢复事实和
历史；每项实际写入及时投影，queued/await/Stop 未收敛时不开放 Undo；普通已知失败本地化
且非空，成功恢复后移除旧失败说明。所有非 preview 成员终态齐备后才可判全部恢复，
后续 A→C 仍是当前变化，首次用户整次 Undo 才冻结当时历史。没有新增测试矩阵或抽象平台。

## 真实模型与已部署交互

测试 app 为 Obsidian 1.14.4 / PA 2.10.10，精确库路径为 repo-local `test`。
原问题在 Anthelion 只读定位，全部写入验收仅作用于三份自建合成笔记。

| 旅程 | 实际观察 | 证据限度 |
| --- | --- | --- |
| 英文桌面 | 既有 qwen / deepseek-v4-pro 单次请求自然产生3 intent/3 receipt，两篇笔记只有一张默认收起卡；全部差异、Space收起/展开、完整tab关闭重开、tab整次Undo、卡/tab同步、历史收起均实际操作；两修改笔记恢复原始字节；321.5px 无横向溢出 | 构建 `a6eefd2f4da3142025202e31d828d2b4fbfe843558b36496bc77e3bd9819c651`；不固定模型工具次数，不从单轨迹推断成功率 |
| 中文常规 mobile | 官方 Obsidian CLI mobile，320×844，原生新Chat/来源/提问/展开；一张卡展示两个远隔块，1gap/0错误newline标记，三个动作44px、无溢出 | R9 构建与实际 loaded 同为 `5de53cd841763fff48690debb500d30841ee6f8fdda22211ae46eaf3a4c66e82`；是模拟器，不是真实 iPhone 硬件 |
| 人工后改保护 | 原生编辑器追加并保存人工行后点击“撤销”，显示冲突并禁用；完整文件前后 bytes/SHA256 相同，保留人工行与未恢复变化，不误报全部撤销 | 同一中文旅程；使用真实笔记/owner恢复检查，fresh errors0 |
| 最终补修 renderer | R12 已部署真实 Review renderer，内存合成 partial/expired/undone 状态；原生“撤销”一次显示中文恢复期限过期，仍可展开变化，普通stale为中文；英文Undone历史Before/After可展开，Undo禁用 | 不执行真实 SDK/owner或模型、不写笔记；实际 session 归约由当前源码回归证明，不能把合成 facade 当成真实恢复执行证据。英文交互fresh errors0 |

最终 dist、test 部署及实际 loaded SHA256 均为
`85540f7cd47c8f664aaedd45c3745a39d372027c2734e61774342903566d083b`。
旧真实旅程只复用未变的 owner/布局/provider 边界，不冒称在此最终构建重复执行。
原始实际旅程证据在 `/private/tmp/pa-b178-app-L71MHg/`；四张截图留在本聊天 visualizations。
补修证据在 R12 的 `zh-expired-renderer.log`、`en-history-renderer.log`、`en-history.png`。

原旅程结束时 Memory/原排除项、desktop/en/debugger=false、原窗口/栏宽恢复，三份夹具核验后
进入 test 本地可恢复回收站。补修无笔记写入，临时 review/facade 已移除，原活动笔记/leaf、
en、mobile=false、debugger=false 核回基线，见 R12 `baseline-restored-confirmed.log`。

## 收尾边界

收尾只修改文档与生命周期记录，复用上述输入未变的测试、构建和 app 证据；文档/链接及
差异检查单独执行并通过（324 Markdown / 4195 local links，`git diff --check` exit 0）。
独立检查确认18份源/测试与接收hash一致，样式与构建/部署副本一致；收尾前后19份
运行时/测试/样式文件未变。签名本地提交、远端推送、CI 和发布是独立事实，本记录不证明后三者。
保留仍被引用的原始日志和可恢复过程副本；其他工作与用户资料不清理。
