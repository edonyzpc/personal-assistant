# B-176 Pagelet 入口与阅读闭环验收记录

Document status: Historical
Delivery status: Closed
Date: 2026-10-24
Work item: B-176
Authority: 已完成工作的历史验收与证据边界，不授予新的实现或 Git/release 权限。
Current contract: [DEC-066](../../product/decisions/dec-066-pagelet-reading-loop.md) / [Product Spec](../../product/specs/pagelet-reading-loop-product-spec.md) / [Architecture](../../architecture/pa-agent-architecture-plan.md#pagelet-deep-insight-recovery)

## Outcome And Evidence

REQ/AC-01～08、D-01～03 与材料保存修订已验收，F-01～09、R-01～07 均已解决。主要实现及跟进修订由提交 `cbf87d1a`、`71617c9b` 保留。用户于 2026-10-24 明确授权清理已完成 Active 记录和必要归档，本轮据此收尾；B-141 的 Detail 交接缺口已由 D-02/D-03 实际交接验收承接，不再等待独立实施。

| 阶段 / 范围 | 历史证据及其边界 |
| --- | --- |
| 2026-10-16 初轮自动化 | 纯读/backend 121 tests、Detail 88 tests、UI 164 tests 及 Panel 新回归通过；F-01～09 修复后，真实 producer → controller/adapter → Chat/runtime/provider 的完整正文与来源、request 归属、Web TTL、epoch 封口、空 proof 和历史连续性反例通过。独立 review 无剩余 actionable P1/P2。 |
| 初轮统一覆盖 | 原 full 自然 exit 1：395 suites / 9632 tests PASS，唯一 Writing 旧无 proof 正常 fixture 失败。补真实来源后该 suite 41 tests PASS；最后来源/历史修订 4 suites / 285 tests PASS 替换受影响证据，共接续 396 suites 覆盖，不称原 full 命令 PASS。最终 lint、production build、platform 551、diff/注入扫描和 deploy-current 通过。 |
| 桌面阅读 | 在 A 运行时短点 B 只读，无新增运行或抢占；A 晚到不覆盖 B。受控两份成果 A→来源 B→关闭→B→A 仍选第二份，来源展开与 scroll 1759 精确复访；普通活动更新保持正文节点。 |
| Panel → Detail 与草稿 | 真实展开保留第二份、原锚点和来源展开；宽布局将底部位置限制到 1376。草稿冲突返回 draft-conflict，原文与精确草稿保留，不自动发送。 |
| CLI mobile simulator | 390×844 实际正文滚动 967、client/scrollWidth 均 390，来源可展开/打开，阅读锚点保持 A，Close 可达；无捕获错误。属于模拟器，不是 iPhone 硬件证据。 |
| 真实模型与成功交接 | 当前部署下发现 4 turns / 7 tools，completed / verified、3571 字符、三份合成来源及 complete proof；真实 Panel → Detail → Chat 同 ID / 原锚点 / 全文一致。一次自然 notes Chat 实际 acceptedId 匹配，回答含材料、answer-complete、pending=null、lineage complete。不将前轮 unknown 样本手改为成功。 |
| 2026-10-16 跟进修订 | R-01/05 验证非枚举 Memory 来源、接纳保存/序列化、重开按需读取、第三轮不自动重发全文及会话/run/hash/权限反例；来源 3 suites / 175 tests、阅读 2 suites / 190 tests PASS，三名 reviewer 独立复核实际差量。 |
| 跟进统一覆盖 | 原 full 自然 exit 1：395 suites / 9607 tests PASS，47 失败来自生命周期旧 mock 2 例及 sandbox 本机监听 EPERM 45 例；只修两个 mock，允许本机监听后两套 / 171 tests PASS，未变输入复用，共 397 suites / 9654 tests 覆盖。最终 lint、production build、platform 552、deploy-current 通过，不称原 full 命令全绿。 |
| 跟进桌面交互 | 空 Detail 保留原因与 Start discovery，未调用模型；合成完整祖先变化后正文/节点不变、scroll 712→712，提前提示并禁 Discuss。受控已接纳材料从原生 History 重开、展开 From Pagelet，2823 字符完整一致，包括首轮回答未复述段落；该次零模型调用，工具入模由 runtime 回归覆盖。 |
| 2026-10-17 R-06/07 | 两条竞态目标先红后绿；后台来源复核不取消用户选择，缓存读取接续 Detail、退出 checking，旧缓存不覆盖新集合。最终 orchestrator 98/98、TypeScript、定向 lint、DOM 扫描通过；独立 reviewer 核对修改前快照、差量和红绿日志。 |

R-06/07 仅改 orchestrator 及其回归，复用未变模块证据，未重跑全量、build、deploy、模型或设备矩阵；前轮 app 观察不能冒充这两项竞态的新部署证明。原始来源不完整样本仍保留 unknown；结构/来源通过不证明模型语义准确率。

## Evidence Locations And Residual Boundaries

- 初轮：`/private/tmp/pa-b176-20261016-tr3D00/`，含 `full-final.log`、`pagelet-continuity-scope-focused.log`、`app-real-owner-final.log`、`app-attachment-ready.log`、`app-chat-progress.log`、`mobile-scroll.log`。
- 跟进：`/private/tmp/pa-pagelet-followup-20261016-DI21XQ/`，含 `full-tests.log`、`failed-suites-rerun.log`、`app-stale-reading.log`、`app-chat-reopen-final.log`。
- 两项竞态：`/private/tmp/pa-pagelet-races-20261017-CxtAbH/`，含 `target-red.log`、`orchestrator-superseded-green.log`、`tsc-final.log`、`lint-final.log`。本机临时日志路径不是永久存档承诺，完整过程见上述提交的 Tracker。
- 初轮合成笔记哈希未变后删除，设置/来源选择、原 Agent Debug、空 Chat 和 mobile/debug off 已恢复；初轮一份合成 Chat 历史按当时记录保留。跟进的合成笔记/聊天/叶与临时 global 已清理。未扩展删除原用户历史。
- B-175 的 O-01 provider admission 原始失败仍无可定位原因，本增量未宣称修复。CI、生产发布与 iPhone 硬件不在验收范围；B-002 其他 async UX 未被关闭。

## Closeout Disposition

DEC-066 / Product Spec 保留产品选择；纯读、阅读归属、来源准入、材料持久化和两个取消/缓存边界由 Architecture 承载。本记录保留独有验证与限制。原 Feature Home、Tracker、SDD 吸收后删除，不完整归档过程包；Git 历史保留恢复依据。本轮授权和逐文件 disposition 在删除前写入 Tracker，整理副本存于 `/private/tmp/pa-project-cleanup-20261024/pagelet/`。
