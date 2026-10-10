# Complete Note Query Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-10-10
Work item: B-169
Authority: 本任务唯一执行状态与验证记录。
Product spec: [Complete Note Query](../../../product/specs/pa-complete-note-query-product-spec.md)
SDD: [Implementation design](./sdd.md)

## Current Snapshot

- Authorization: 用户要求实施完整列表查询修正，并于 2026-10-10 追加授权将本次修改提交到本地 master；不含 push/release 或 anthelion 部署。
- Baseline: `fde4db3e02074fdafe1e87f044dea6b53169c437`，接收工作区初始 clean。
- Current phase: 源码/tests、独立验收、全量检查发现项闭环及实际 test vault 工具/Chat 验证完成。夹具已清理，临时设置及诊断包装已恢复。
- Next action: 本次实现与验证无剩余项，按追加授权随本地 master 提交交付；不含 anthelion 部署、push/release。
- Blocker / decision needed: 无未定产品选择。

## Ownership And Validation

GLM 是唯一源码/tests writer，工作树 `/home/admin/.codex/worktrees/complete-note-query/personal-assistant`；不读私人 vault 或凭据。GPT 写当前契约并集中执行 build/full gate/deploy。GLM profile `pa-glm`，ZAI `glm-5.3`，本机既有 catalog 覆盖；实际服务端型号未知，不以配置自述证明。

| Requirement / risk | Minimum evidence | Status |
| --- | --- | --- |
| B-169/REQ-01 / B-169/AC-01：前置截断与结果裁剪 | query + metadata suites；601 篇真实 fixture、阈值后 101 条、准确总数/排序/显式 N | PASS |
| B-169/REQ-02、B-169/REQ-03 / B-169/AC-02：关键词清单与正文分离 | snippet suite；601 篇每篇一次、大笔记尾部命中、无正文、范围/大小写 | PASS |
| B-169/REQ-04 / B-169/AC-03：来源与真实失败 | task-source / observation suites；禁止项不泄露、执行中取消/来源变化/缓存未知 | PASS |
| B-169/REQ-04 / B-169/AC-04：完整交付 | capability/context/eval/physical integration；下一轮 provider envelope、长路径、新旧零结果真实准入 | PASS |
| Runtime integration | lint/build/full scope 检查及失败闭环；已部署 test vault 六项真实工具对照与 Chat | PASS；全量原始失败及复验边界见下文 |

原始 GLM 日志 `/tmp/pa-complete-query-glm/`。初始慢查询证据属于此前诊断，不作为本实现 PASS 或提速比例。仅当输入变化、失败或明确风险未覆盖时补验；不重复有效 gate。

第一版 CLI 自然退出 0，16 个源码/测试文件，593 insertions / 1192 deletions；聚焦 11 suites / 296 tests PASS，TypeScript PASS，diff check PASS，DOM source scan exit 1/no matches。原始 failing-before 三条回归为 exit 1。均为第一版输入的证据，不能覆盖尚待处理的审查修订。修订任务 `/tmp/pa-complete-query-revision-task.md`，报告与日志 `/tmp/pa-complete-query-glm-revision/`。

第一轮修订的聚焦失败已诊断：两次 streamLLM 的正确请求数为 3，原测试期望 2 属于计数错误；snippet 文件集合变化已返回失败，子串断言与实际错误文案不一致。修正测试后对应 suites PASS，TypeScript 最终 exit 0。独立验收另发现 `hasOnlyKeys` 仅校验字段白名单，不能区分旧 metadata 两字段格式与新完整格式；最后任务 `/tmp/pa-complete-query-legacy-fix-task.md` 要求修复判别，并在真实 runtime 准入之前注入新旧格式验证 lineage，避免在已生成 lineage 后修改历史造成伪覆盖。日志 `/tmp/pa-complete-query-glm-final/`。同时将未知 stat 排序夹具改为能触发原比较器问题的交错路径。

最后兼容修订自然退出 0；eval 37/37、query 32/32、TypeScript 与 diff check PASS。独立 GPT 确认上述三项闭环，无新增阻塞。完整部署门禁首次在 lint 发现移除扫描上限后遗留的三个无用计数器，未进入构建或部署；原 GLM 删除计数器及专用字节计算，单文件 eslint 与 diff check exit 0，自然退出 0。最终源码/tests 补丁 SHA-256 `33b9146486c261d41c88c68ad57c5a6cbbb55f32324577dea1a52500072d74f5`，18 个文件；主流程检查并同步唯一差量后重新运行 enclosing gate。证据 `/tmp/pa-complete-query-glm-lint/`、`/tmp/pa-complete-query-final-deploy-lint-failure.log`、`/tmp/pa-complete-query-final-deploy.log`。

## Deployed Baseline

Obsidian 1.14.4 的实际 test 窗口已核对 `/mnt/code/personal-assistant/test`；旧插件 2.10.8，`main.js` SHA-256 `b7917e3f8d7d9957ce0a9d3d5f3cd6d890308ceda390836af675dcf23a55d980`。通过已加载 Chat 的真实 CapabilityRegistry 执行工具，未调用模型、未注入新查询实现。基线证据 `/tmp/pa-complete-query-app/before-fixtures.json`。

自建 601 篇夹具中，前 500 篇 recorded=2026-09-01，后 101 篇 recorded=2026-10-09；每篇正文含两次同一关键词，最后一篇在 130,000 字符之后另有独有关键词。旧插件日期查询返回 0 / lower-bound，标签查询返回 10 / 500 lower-bound，metadata 返回 8，正文搜索仅读 80 篇并返回 5 个片段，末尾独有关键词未找到。它们证明本机旧机制，不能推断另一设备的完整耗时归因。

夹具清单及内容校验值保存在 `/tmp/pa-complete-query-app/fixtures.json`；创建前将 test 的 `memoryApprovalPolicy` 从 `auto-refresh-after-prepare` 暂调为 `always`，清理后恢复。CLI debug 初始状态不可可靠读取，保持未改；mobile=false，保持未改。查询阶段 CDP 只连接经路径核验的 test 窗口。

## Final Validation

最终生产源码已通过平台 guards（528 TypeScript files）、lint、生产 build（含 TypeScript），DOM source scan 无匹配，diff check 通过。全量 Jest 自然结束：385 suites / 9,316 tests，383 suites / 9,314 tests PASS，耗时 690.035 s，自然退出 1（make exit 2）。两项失败分别处理：

- `b129-multimodal-runtime` 原断言要求 nextCursor；按照已批准的无分页契约移除任意 limit，要求完整有序 a/b/c、matchCount=3、无游标，保留 read snapshot 与 live metadata 变化的真实边界。仅该测试文件变更，整套 103/103 PASS、自然 exit 0，未修改生产代码。证据 `/tmp/pa-complete-query-glm-fixture/`。
- `retrieval-recovery-coordinator` 实时时钟断言 `<110 ms` 本轮为 134 ms；保留代码和阈值，待完整测试结束后隔离运行该套件，28/28 PASS、自然 exit 0，该用例为 68 ms。只能确认隔离时未复现，不能据此证明确定历史归因。证据 `/tmp/pa-complete-query-recovery-isolated.log`。

依据 GOV-001 复用未变输入的其余通过证据，不将聚焦复验冒称新的一次全量 PASS。最终源码/tests 共 19 文件，补丁 SHA-256 `5d8c06eb857d05f7becbb74826a5f0b62bd9fb9c7e99c1898c7dab77b715ce08`。生产输入在上述测试断言修订中未变，`make deploy-current` 验证当前构建身份后部署成功（该命令不运行测试）。本机 test 已 reload，实际 main.js SHA-256 `29011532c03165ee247587c457d9897f7e0dab97d30e79f5b2777e5503fb658c`，三个分发文件与 dist 字节一致；版本仍为 2.10.8，未发版。

同一 601 篇 fixture、真实已加载 CapabilityRegistry（含 adapter / 输出约束）对照：

| 场景 | 旧安装结果 | 新安装结果 | 新版本次耗时 |
| --- | --- | --- | --- |
| 第 500 篇之后的 recorded 日期命中 | 0 / partial | 101 / exact / complete | 930.2 ms |
| 标签全量 | 10 / total 500 lower-bound | 601 / total 601 exact | 1,178.5 ms |
| 元数据关键词 | 8 | 601 / total 601 exact | 66.9 ms |
| 正文关键词，每篇两次出现 | 5 个片段，仅扫描 80 篇 | 601 个唯一笔记，无正文 | 1,515.5 ms |
| 130,000 字符之后独有关键词 | 0 / partial | 1 / exact / complete | 1,202.7 ms |
| 显式 top 3 | 3 / total 500 lower-bound | 3 / total 601 exact | 886.9 ms |

六项均无 nextCursor、无正文或 snippet，准确数量/唯一性/边界路径经断言通过；调用期间 fresh exceptions 与 console errors 均 0。证据 `/tmp/pa-complete-query-app/after-fixtures.json` 和 `verify-after.py`。这些是本机工具样本，不是跨设备性能比值，也不证明 anthelion 的新端到端时间。

真实 Chat 使用现有 `glm-5.3` 配置，thinking 设置保留；新建会话并通过 UI 输入、点击发送：

> 查询 __pa_b169_complete_query_smoke_20261010 文件夹中 recorded 属性为 2026-10-09 的全部笔记。只告诉我准确数量，不需要读取正文，也不用列出标题。

观测 service 流程耗时 16,235 ms，界面显示 16 s，最终回答 101 篇。模型同时发出两种等价 `query_notes`（properties equals 与 property calendar-date），各返回 101 / exact / complete，耗时分别 1,497 / 1,503 ms，发生重叠，不能相加当作串行时间。未调用目录拆分、游标续查或 read_note；不能把这次样本说成只调用一次工具。该冗余选择没有造成追加的分页补查，本次不增加新调度器或强制工具规则。全程诊断捕获 fresh exceptions / console errors 均 0。证据 `/tmp/pa-complete-query-app/chat-final.json`、`chat-final.png`、`chat-fresh-errors.json`。

清理按预存 SHA-256 核对后删除 601 个本任务文件与空目录；test 实际 Markdown 恢复 78，fixtureCount=0。诊断方法包装已还原，`memoryApprovalPolicy` 恢复 `auto-refresh-after-prepare`，mobile=false；CLI debug 未变更，初始状态未知而不声称已验证某个特定值。设置恢复曾因 Obsidian 删除事件未处理完而被诊断 guard 暂停，待事件完成后成功，未提前放开后台 Memory。保留用户既有会话及本次结果，保留已验收 test 插件。未对 anthelion 部署，因此用户原始最近两周 prompt 的新端到端耗时仍未在该 vault 测得。

## Review And Resources

独立 GPT 确认必要同步点：source producer、evidence parser/revalidation、snippet V1A output budget；Context 最近结果没有被发现硬截断，不扩展成新 Context 框架。metadata 缓存未知采用明确 unavailable 的简单语义。metadata 总数、未知 stat 稳定排序、source-free 新旧零结果准入、移除无用 hash、真实来源变更检查点、snippet 集合/身份回归、合法长路径通过 adapter、执行中取消等发现均已修正并独立验收。详见 `/tmp/pa-complete-query-glm/review-findings.md`；无剩余阻塞。

最终文档检查 PASS（288 Markdown / 3,744 local links），最终 diff check PASS。证据 `/tmp/pa-complete-query-docs-check-final.log`。提交前确认源码/tests 与已验证补丁完全一致，复用既有验证；本地 master 提交另获用户明确授权，不扩大为 push/release。

临时资源：所有 GLM CLI 自然退出；19 个源码/tests 文件逐一确认与主工作区一致后，本任务 managed worktree 已归档（附件状态 archived_worktree 已核实）。原始日志、补丁及运行证据保留在 `/tmp/pa-complete-query-*`，不作为源码提交内容。应用及用户既有会话保留。
