# B-169 Complete Note Query — Final Validation

Document status: Archived
Delivery status: Closed
Closed date: 2026-10-24
Work item: B-169
Authority: 已完成开发的历史验证与限制；当前行为以 [DEC-059](../../product/decisions/dec-059-complete-note-query-results.md)、[Product Spec](../../product/specs/pa-complete-note-query-product-spec.md) 和 [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract) 为准。

## Accepted Scope And Evidence

2026-10-10 完成实现、独立验收、失败闭环及部署 test vault 验证；本地提交为
`ded0b2a1`。2026-10-24 用户授权整理完成的 active 记录并直接归档；本次收尾未修改
运行代码、重跑应用验证、部署、提交、推送或发布。原 Tracker 无剩余实现或验收项。

| Requirement / acceptance | 已有证据与边界 |
| --- | --- |
| B-169/REQ-01 / AC-01 | query/metadata 定向回归与实际 601 篇 fixture：旧候选上限之后 101 条命中、准确总数、稳定排序、显式 top 3 完成匹配后裁剪。 |
| B-169/REQ-02、REQ-03 / AC-02 | 本地关键词完整扫描，每篇只返回一条、不含正文；130,000 字符之后的独有关键词、属性/正文范围与大小写边界通过。 |
| B-169/REQ-04 / AC-03 | 来源禁止项及数量不泄露；执行中取消、来源/文件集合/身份变化、未知缓存明确失败、未知 stat 稳定排序均经定向回归及独立审查。 |
| B-169/REQ-04 / AC-04 | capability/context/eval/physical integration 覆盖完整结果进入下一轮 provider envelope、合法长路径、新旧零结果在真实 runtime 准入前的判别；不以注入已有 lineage 冒充兼容验证。 |

GLM 以 `pa-glm` / ZAI `glm-5.3` 为唯一源码/tests writer，GPT 负责当前契约、独立验收
和集中 gate。实际服务端型号未独立确认，配置名不作为证明。最终 19 文件补丁 SHA-256
`5d8c06eb857d05f7becbb74826a5f0b62bd9fb9c7e99c1898c7dab77b715ce08`。

## Full Gate And Failure Boundaries

平台 guards（528 TypeScript files）、lint、生产 build/type-check、diff check 通过，
社区 DOM 注入源码扫描无匹配。首次 lint 发现三个遗留无用计数器，修正后重跑 enclosing gate。
最终全量 Jest 自然结束为 **385 suites / 9,316 tests，其中 383 suites / 9,314 tests PASS**，
耗时 690.035 s，Jest exit 1、make exit 2。两个失败分开处理：

- `b129-multimodal-runtime` 的旧 nextCursor 断言与已批准无分页契约冲突；仅修正该测试，
  要求完整有序 a/b/c、matchCount=3、无游标，同时保留 snapshot/live metadata 边界。
  整套 103/103 PASS，生产代码未改。
- `retrieval-recovery-coordinator` 实时时钟要求 `<110 ms`，该次为 134 ms；不改代码或阈值，
  隔离运行 28/28 PASS，该用例 68 ms。只证明隔离时未复现，不推断历史失败根因。

按 GOV-001 复用其余未变输入的通过证据，**没有新的一次全量单轮 PASS**。
`make deploy-current` 在生产输入未变时核验并部署资产；此命令不运行测试。
历史 docs:check 288 Markdown / 3,744 local links 与 diff check PASS。

## Deployed Comparison And Real Chat

Obsidian 1.14.4、已核对 `/mnt/code/personal-assistant/test` 的真实 test 窗口，插件仍为
2.10.8。已部署 `main.js` SHA-256
`29011532c03165ee247587c457d9897f7e0dab97d30e79f5b2777e5503fb658c`，分发文件与 dist 一致。
同一 601 篇合成 fixture 通过真实加载的 CapabilityRegistry（含 adapter/输出约束）调用，
未注入新查询实现：

| 场景 | 旧安装 | 新安装 | 新安装本次耗时 |
| --- | --- | --- | --- |
| 第 500 篇之后 recorded 日期命中 | 0 / partial | 101 / exact / complete | 930.2 ms |
| 全量标签 | 10 / total 500 lower-bound | 601 / total 601 exact | 1,178.5 ms |
| 元数据关键词 | 8 | 601 / total 601 exact | 66.9 ms |
| 正文关键词，每篇两次出现 | 5 片段、仅扫描 80 篇 | 601 个唯一笔记、无正文 | 1,515.5 ms |
| 130,000 字符之后独有关键词 | 0 / partial | 1 / exact / complete | 1,202.7 ms |
| 显式 top 3 | 3 / total 500 lower-bound | 3 / total 601 exact | 886.9 ms |

六项无 nextCursor、正文或 snippet，fresh exceptions / console errors 均 0。
这是本机工具样本，不是跨设备性能比值。

真实 Chat 使用既有 `glm-5.3` 配置与原 thinking 设置，经 UI 输入并发送日期查询，
最终回答 101 篇。service 耗时 16,235 ms，界面 16 s。模型并行发出两种等价 query_notes，
各返回 101 / exact / complete（1,497 / 1,503 ms），不能相加或宣称只有一次工具调用。
未拆目录、续游标或 read_note；未据此新增调度规则。fresh exceptions / console errors 为 0。
未部署 anthelion，原用户 vault 最近两周查询的新端到端耗时仍未测得。

## Cleanup And Evidence Availability

历史清理按 SHA-256 删除 601 个自有夹具，test Markdown 恢复 78、fixtureCount=0；
诊断包装还原，`memoryApprovalPolicy` 恢复 `auto-refresh-after-prepare`，mobile=false。
CLI debug 未改且初始状态未知，不声称核实过某个特定值。保留用户会话与已验收插件。
GLM CLI 自然退出，工作树逐文件核对后已可恢复归档。

2026-10-24 只读复核时 `/tmp/pa-complete-query-app/`、final-deploy.log、
glm-fixture/、recovery-isolated.log 和 docs-check-final.log 均不可用。本档据原 Tracker
保留历史记录，不宣称重新读取了原始结果或重验 runtime。原 active 包与终态 Tracker
本轮备份在 `/private/tmp/pa-project-cleanup-20261024/query-ghost/`。
稳定职责吸收到 Product Spec，README、SDD、Tracker 采用 delete-after-absorption；无延期项。
