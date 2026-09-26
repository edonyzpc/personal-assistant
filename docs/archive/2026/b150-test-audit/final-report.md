# B-150 测试审计验收记录

Document status: Archived
Delivery status: Closed
Updated: 2026-09-26
Work item: B-150
Authority: 本轮审计结束时的裁决与验收快照；不作为当前执行、生产行为或发布状态权威。
Governance contract: [GOV-004 — 测试审计与质量保护设计](../../../development/governance/gov-004-test-audit-quality-preservation.md)

## Scope And Input Identity

Owner 于 2026-09-26 授权实施 B-150，随后明确选择文档收尾并保留设计、覆盖地图与关键证据。
本轮采用全仓建图、按风险分批深审；GPT-6 实施并由非作者 GPT-6 复核，未调用 GLM/ZAI。
有改动的每批保留定向测试、关键反证和独立复核，全部改动冻结后按 Owner 决定合并一次
完整验收。九份测试（八份修改、一份新增）及文档是最终改动面；生产、共享 helper、
配置和依赖无持久修改。

- 基线 HEAD：`8b137601a0e4ecc178730f35feb71781eceee46a`；交付仍为本地未提交修改。
- [覆盖地图](./coverage-map.md)：最终 328 文件 = 303 source + 23 tooling + 2 artifacts；
  集合无遗漏、重叠或组间迁移，含 8 份 src 共置测试、26 份辅助文件与 52 个显式 mock。
- 深审 18 份既有测试及 1 份新增测试；其余 309 份明确未深审。文件职责映射和完整测试通过
  不等于每条断言都经过审计。地图是本轮快照，后续工作须核对当时的实际发现集合。
- B0 冻结 887 个运行输入，327 suites / 8273 tests 全通过；最终冻结 888 个运行输入，
  328 suites / 8276 tests 全通过。lint、build、完整 coverage、最终 diff check 均自然退出 0。
  最终隔离文档与运行输入无漂移，接收工作区运行输入也与已验收版本一致。
- Node `v22.22.2`；完整测试命令为 `npm run test:all -- --runInBand --coverage --watchman=false`。
  artifact 测试使用该冻结输入的新 production build；旧主工作区 dist 未作为本轮证据。
- 两份紧凑证据中的路径与哈希保留执行当时原值，包括已清理的工作树及旧文档路径。
  它们是历史输入身份，不要求当前路径仍存在，也不将文档迁移误判为运行输入变化。
- 大型原始报告、日志及复现脚本保留在本机 `/private/tmp/pa-b150-17pvq8dx`；下文未链接的
  receipt/log 文件名均指该目录的 `evidence/`。仓库内紧凑证据可独立查阅，但不冒充完整原始报告。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P2 测试缺口 | 并发 guard 只检查属于 a/b 任意一项，可能漏掉复用首次权限对象 | B1 按每次 signal 精确核对等待前/后对象身份，保留撤销结果 | focused、独立复核、M-GUARD 目标反证与恢复、最终完整门禁通过 | Closed |
| F-02 | P3 证据边界 | wrapper preflight 的手写 Map 被描述为真实 Host read plan | B1 保留 forwarding，显式 Host stub + 完整输入和精确拒绝结果；真实 planner 由 siblings 承接 | focused、独立承接复核与最终完整门禁通过 | Closed |
| F-03 | P2 测试缺口 | inline WASM 前五例验证的是 Jest mock，无法发现真实生成器失去懒解码 | B2 真实 esbuild 三例先通过，再移除五项自证；URL cache 两例保留 | 独立包字节、懒解码/复用、非作者承接复核与最终完整门禁通过 | Closed |
| F-04 | P2 测试缺口 | Worker delete/reset/replacement 的“cache invalidation”前置均未建立热缓存 | B2 保留 cold、加入 warm 行与精确查询结果 | focused、三个缓存变异目标红/恢复绿与最终完整门禁通过 | Closed |
| F-05 | P2 测试缺口 | 原子替换用例未排除多个 IndexedDB 事务 | B2 在读取前验证单个 state/readwrite 事务，保留 abort 旧状态 | 三事务变异被 1 vs 3 断言抓住；恢复绿与最终完整门禁通过 | Closed |
| F-06 | P2 测试缺口 | upsert 失败后测试手工恢复 chunks，可遮蔽缺失 ROLLBACK | B2 删除手工修复，断言生产失败路径恢复旧行和可查询数据 | 缺 ROLLBACK 变异在旧行保持断言失败；恢复绿与最终完整门禁通过 | Closed |
| F-07 | P2 fixture 缺口 | fake 未实现 vss_files COUNT，fileCount 前后始终为 0 | B2 返回 files.size 并验证已知非零前置，保留回滚比较 | 非零前置、恢复/连续性、独立复核与最终完整门禁通过；原兜底覆盖变化见下文 | Closed |
| F-08 | P3 证据边界 | hybrid “fused”用例实际上 lexical disabled，走向量回退 | B2 准确验证 disabled 回退；保留真实 ready/attempted/2÷31 融合用例 | 两种契约 focused、独立复核与最终完整门禁通过 | Closed |
| F-09 | P2 测试可达性 | vault 根路径 folder-probe 用例先被 allowlist 拒绝 | B3 保留拒绝契约，补真正到达根路径 async 校验的成功和碰撞反例 | 根路径漏碰撞变异被精确结果抓住；恢复绿与最终完整门禁通过 | Closed |
| F-10 | P3 证据边界 | append prompt-injection 标题声称模型授权、UI renderer/rollback，实际仅执行 helper | B3 准确限定路径约束、原文/preview metadata、marker；不恢复已退役模型工具 | 8 例 26 条原 expect 行未变；独立复核与最终完整门禁通过 | Closed |
| F-11 | P3 证据边界 | executor 用例标题称 preview 在 Gate 1 前，生产实际先 confinement | B3 改正并验证实际顺序；保留拒绝时不 preview 的独立用例 | 提前 preview 变异被顺序断言抓住；恢复绿与最终完整门禁通过 | Closed |
| P-01 | P3 潜在生产问题 | executeStandardCall 在异步 reserve 返回后先 abort 再保存 lease，接口反例漏 rollback | 按既定范围单列后续；当前同步 localStorage + timer 路径未证实际可触发 | 只读局部执行及独立追溯：standard 无 rollback，risk-aware 有；非 Obsidian 证据 | 不改生产；待触发条件 |

## Batch Records

以下保留实际深审、可信失败、历史与承接依据；B1–B3 的定向验证和反证完成后，
统一参加最终完整门禁。B4/B5 无测试删改，复用相同输入的 B0 并由最终门禁再次覆盖。

### B1 — Agent / Chat 来源与生命周期

- 完整阅读：`task-source-read-guard`、`task-source-executor-integration`、
  `conversation-writing-admission`、`writing-recovery-sources`，41 个展开用例。
- F-01 的可信失败是共享 executor 错用首次调用权限对象。主要边界是
  `pa-agent-host-tools` → Registry → adapter；测试内 capability 只记录接收到的引用，
  不实现来源 guard，外部断言避免 adapter 吞掉失败。只改该并发断言，不合并不同生命周期。
- F-02 原 TaskSourceConstraint 未传给 wrapper，拒绝由手写 Map 产生；旧 snapshot 相等
  无独立运行时保护。保留两种 wrapper 的完整批次转发与禁止 prepare/execute；
  `task-source-constraint/read-plans/executor/run` 的实际准入、复制快照拒绝、Host denial、
  identity replacement 和 Data Boundary 用例继续承担真实来源契约。
- 历史：`b4aed6bd` 来源接缝、`935128a7` 当前测试内裁决、`148d7e36` 会话竞态；
  `6bee016b` / `0bbe12ba` / `97937a52` 分别保护 legacy、snapshot、v2 lineage 恢复。
- 保留：conversation 七个竞态用例；writing recovery 的 25 个来源/父版本用例。
  泛化父版本错误可在后续对应 reader 改动时细化，本轮不删除已有保护。
- 最低证据：两个修改文件 source focused；精确并发用例正常—错绑—恢复；
  非作者对旧/新断言承接复核；最后参加合并 lint/build/完整 coverage。生产或保留断言变化失效。
- 已有证据：`evidence/agent-focused.log`，2 suites / 9 tests、自然退出 0；非作者复核无阻塞。
  变异目录 `/private/tmp/pa-b150-17pvq8dx/mutation-tree`，receipt 与清理前的哈希核对证明所有临时源文件均已恢复。
- M-GUARD：`evidence/mutation-guard-receipt.json` 保存四次原始 JSON/log、精确选择条件及哈希。
  正常新测试 1/1、旧测试在错误缓存首次 guard 下仍 1/1、新测试同变异下 0/1（退出 1），
  失败明确位于测试主体 `before.toBe` 对象身份断言；恢复后 1/1、退出 0。
  源码 SHA-256 恢复为 `5ad7d9d595a770ff875fee64403b20380caa212c65d05ccd29c7f4e343b298db`；
  测试恢复到已验固定版本。使用 Jest 源码执行，没有构建、部署或残留变异 bundle。

### B2 — Memory / VSS 数据与资源

- 完整阅读：`sqlite-inline-assets`、`memory-admission-policy`、`vss-data-safety`、
  `vss-local-state-store`，125 个展开用例。policy 70 个边界行全部保留。
- Worker 使用真实请求队列、事务接线和 JS 缓存，SQLite/OPFS/MATCH 是 fake；
  不以这些测试证明真实引擎或浏览器持久性。只修 F-03～F-08 的前置、fixture 与断言。
- WAL/rollback、热冷缓存、marker unknown、不同持久化状态分别保留；真实 hybrid
  承接项已验证 lexical ready/attempted/matchedRows/融合评分，不由 disabled 例替代。
- WASM 使用现有 production in-memory build 入口，不新增生产 export。新 tooling 证据
  必须执行真实构建结果，旧前五例才可移除；原 URL cache 两例继续留在 source。
- 最低证据：上述 source 和新 tooling focused；delete/reset/upsert cache、缺 rollback、
  非原子替换五个独立最小变异；非作者复核；最终合并 coverage 与 B0 分母/路径核对。
- 历史依据：`4084d52b` 引入懒 getter；`cb318935` / `5069cbc7` / `59840f22` 扩展
  Worker hybrid 与检索事务，`6abe7c64` 强化 first-use 原子状态。旧回滚注释已落后于
  当前 fixture 的 transaction snapshot 能力，因此去掉测试代替生产恢复数据有直接依据。
- 已有证据：`memory-focused-receipt.json` / `memory-focused.json`，5 suites / 126 tests，
  无 failed/pending、自然退出 0，输入无漂移；非作者 GPT-6 实际核对 diff、生产 owner、
  旧/新保护和原始结果，未发现阻塞。三份新增 WASM 用例先独立通过后才移除旧五例。
- WASM 首次失败属于新 fixture 的预期路径被 Jest mapper 重定向，并非产品缺陷；
  改为独立 Node 解析安装包路径，长度及 SHA-256 仍来自真实文件，未放宽断言。
  `memory-wasm-initial-fixture.*` 保留首次失败，`memory-wasm-replacement.*` 保留修复后证据。
- `mutation-memory-receipt.json`：正常五例绿；M-DELETE-CACHE / M-RESET-CACHE 分别
  在查询成功断言红，M-UPSERT-CACHE 在期望一个新结果而实际为空时红；
  M-UPSERT-ROLLBACK 在旧行被新行替换时红；M-ATOMIC-STATE 在事务次数 1 vs 3 时红。
  每次只变一个生产错误，失败不是编译、导入或超时；所有源文件按字节恢复，五例恢复绿，
  888 个副本相关输入无漂移。SQLite/OPFS fake 的适用边界未改变。

### B3 — Capture / 写入边界

- 完整阅读：共置 `append-action`、`prompt-injection-append`、`stale-reread`、
  `target-confinement`、`runtime-integration` 五份 spec，128 个显式用例。
- path、原文字节、过期 hash、确认、取消、失败 rollback、自写标记各自保留。
  等长文本变更确实到达 hash 校验，不与长度变化用例合并。
- F-09 保留当前 `outside_allowlist` 的独立拒绝；新增 exact-root 允许的 `foo.md` 场景，
  检查只查询文件本身、成功或精确 `name_collision`，不再依赖不相关早拒绝。
- F-10 / F-11 仅将保护层级写准确并加强真实执行顺序；实际“取消不写”由
  ActionExecutor 及 `pa-agent-runtime-write-action` registry/wrapper 用例承接。
- 历史 `76355b9c` 已退役 AppendToolProvider；append helper 的非测试调用清理另列，
  仍被 Quick Capture 使用的 confinement 不能误删。
- 根路径用例来自 `b5da8c84`，其注释已承认 `./` allowlist 提前拒绝；现有断言应保留为
  该拒绝契约，同时补到达 async 层的输入。`8f4d6752` 的 preview safeguard 与拒绝时
  不构建预览的独立测试继续保留。
- 最低证据：五份 source spec 与 runtime-write-action sibling focused；如修关键 guard，
  在允许范围做目标反证；非作者复核；最终合并冻结门禁。宿主视觉/真实 IO 未作为删项理由。
- 已有证据：`capture-focused-receipt.json` / `capture-focused.json`，6 suites / 141 tests，
  无 failed/pending、自然退出 0，887 个相关 tracked 输入无漂移。主 Agent 作为非作者核对
  三份 diff、confinement 与 executor 的实际调用顺序、原拒绝与 runtime-confirmation siblings，
  未发现保护丢失。prompt 八例的 26 条 expect 原样保留，只缩小不实证据声称。
- `mutation-capture-receipt.json`：正常两例绿；M-ROOT-COLLISION 只使无斜杠根路径
  错误绕过碰撞拒绝，新用例在精确结果断言红；M-PREVIEW-ORDER 提前启动同一次 preview，
  新用例在 guard/preview 顺序断言红。源文件逐字节恢复后两例绿，副本输入无漂移，未构建或部署。

### B4 — Pagelet / UI

- 完整阅读 `pagelet-provider-call-admission` 和 `view-lifecycle`；保留全部测试。
  延迟控制由 Promise 输入提供，真实 owner 决定取消后不创建 root、不注册事件、
  不调用 provider 及 rollback。notice 一次、high-risk 每次确认、重新分类、额度提交顺序
  是独立契约，不能按“都是取消/拒绝”合并。
- 追溯 provider admission、preview/stat owner 与 plugin/Review/Quiet Recall/Scope Recap
  接线；历史 `faaf9a6b`、`60feb4a6`。mock React/Obsidian 不作为实际视觉或设备证据。
- P-01 的接口反例原始结果在 `evidence/pagelet-reservation-diagnostic.json`；独立审查
  未确认默认应用路径可触发，因此不升级为已复现用户缺陷，不越权改生产。
- 最低证据：无测试删改，复用 B0 相同输入的完整测试；不添加制造绿灯的生产行为。

### B5 — Tooling / 发布

- 完整阅读 `jest-test-groups-script`、`release-ci-evidence-script`、
  `ci-validation-scope-script`；保留全部用例。
- discovery 真正调用四个 Jest 入口；CI scope 使用临时真实 Git 仓库，包含两侧 rename、
  多提交及 PR merge-base，不能用简单字符串 classifier 测试替换。
- release CI evidence 执行真实 Node/helper；git/gh 是严格无网络 stub。不同 latest-run、
  attempt、required-step、分页、origin、竞态的反例均独立，不声称 live GitHub 查询。
- 追溯 `scripts/lib/jest-test-groups.cjs`、`release-ci-evidence.mjs`、CI scope 及实际 release
  和 workflow 调用，历史 `1405353f`、`2b5634a1`。近期已精简，不为删减数字重新扩大。
- 最低证据：复用 B0 真实工具/发现门禁；WASM 新 tooling 由 B2 负责，其发现新增须同步地图。

## Production Follow-ups

- P-01 → [Backlog T-007](../../../backlog.md#触发型评估)：局部反例只证明通用接口可能
  丢失 reservation；独立追溯未找到当前默认用户路径的真实异步窗口。需要可达性证据或
  新异步 caller 时重新启动，不以这次 source 单元审计声称已复现 Obsidian 用户问题。
- [Backlog T-008](../../../backlog.md#触发型评估)：历史 append helper 已随 provider 退役失去
  当前运行入口；`__computeTargetPathForTest` 仍需全仓导出/历史核对。这些只作为生产清理
  候选，不在本次 diff。confinement 的 Quick Capture 调用、WithHost renderer 的生产调用
  是明确反例，不能按命名批量移除。

## Final Evidence And Acceptance

可跟踪的紧凑证据保存在 [验证与输入身份](./evidence/validation.json) 和
[覆盖率对比](./evidence/coverage-comparison.json)。它们保存命令、实际结果、前后
输入哈希、精确用例变动、非作者复核归属、原始变异失败消息及 build 产物身份。
大型原始 Jest JSON、coverage 和日志保留在本任务运行目录的 `evidence/`，其文件
SHA-256 和大小列入验证记录；紧凑记录不冒充原始报告或额外测试。

| 指标 | B0 | 最终 | 核对结论 |
| --- | --- | --- | --- |
| 测试文件 / 用例 | 327 / 8273 | 328 / 8276 | 全部实际执行并通过，0 skipped/pending；新增真实 WASM tooling 3 例 |
| coverage 文件 | 436 | 436 | 420 个 src 文件及 16 个配置/静态文本路径完全一致 |
| 行 / 语句 | 167713 / 184006（91.14%） | 167726 / 184006（91.15%） | 分母不变，覆盖增加 13 行 |
| 函数 | 8445 / 9926（85.07%） | 8445 / 9926（85.07%） | 分母及 covered 不变 |
| 分支 | 44070 / 53493（82.38%） | 44075 / 53496（82.38%） | V8 范围拆分/合并变化已核对；未缩小统计分母 |

- 分组、coverage 收集/忽略设置和阈值保持：statements/lines 75、functions 74、branches 71。
  原五项 WASM mock 自证由三项真实构建用例承接；保留三个 cold 行并新增三个 warm 行，
  根路径新增两个可达用例，其余测试数量不变。标题改变不算删除原行为保护。
- 已定位到新增的真实路径：根路径不探测空父目录、Worker 热缓存替换后的提交更新。
  branchMap 的编号/范围不能简单逐 ID 比较；逐位置差异保存在覆盖率证据内。
- `sqlite-worker.ts:3838` 的非数字兜底从 19 次变为 0。前后 getStats 均为 19 次、数字读取
  均为 76 次，旧 fixture 恰好漏掉每次的文件 COUNT 返回值，造成 `Number(undefined ?? 0)`
  偶然覆盖。修复后返回真实文件数并验证非零前置；旧测试没有独立的非数字 SQL 契约。
  非作者核对源代码、旧/新 fixture 和原始覆盖报告，确认未丢失真实保护，不为恢复百分比
  重建错误 fixture 或添加只镜像兜底实现的测试。
- `vss-core.ts:3747` 的一次额外覆盖受前一时间戳比较的短路影响；owner 及相关专属测试
  未改，聚合报告不足以确定具体触发用例，记录为未归因的运行差异，不计作审计收益。
- 八项隔离变异仅用于拟修复的关键契约，均有正常绿、目标红、字节恢复后绿的证据。
  最终完整门禁在独立的正常工作树上运行，没有复用变异 bundle；无生产持久修改。
- SQLite/OPFS 仍是 fixture、真实 CLI/Git 使用临时仓库或严格无网络替身；本轮不提供
  Obsidian、真实 SQLite 引擎、设备、供应商或远端发布验证。未审的 309 份不能由全量绿灯
  推定为断言有效。P-01 与生产清理按 T-007 / T-008 后续触发，不混入本轮修复。

| AC | 当前证据结论 |
| --- | --- |
| B-150/AC-01 | 328 行职责地图、四分组实际集合、26 helper、新增/保留和未审边界明确 |
| B-150/AC-02 | F-01～F-11 均有可信失败、生产 owner、历史/承接与处置；新增有真实风险依据 |
| B-150/AC-03 | B1/B2/B3 非作者承接复核通过，取消/恢复/来源与真实工具保护保留 |
| B-150/AC-04 | focused 与集中完整门禁自然通过；覆盖路径/分母及细粒度变化有可复核解释 |
| B-150/AC-05 | 八项关键反证有效，输入及源文件恢复，无导入/编译/超时失败冒充反证 |
| B-150/AC-06 | 九份测试（含一份新增）及文档；生产、共享 helper、配置/依赖零改动；GPT-6 执行，未调用 GLM/ZAI |
| B-150/AC-07 | 批次、未审项、生产 follow-up 和证据限制明确；Owner 已授权文档收尾，终态事实由紧凑验收快照承接 |

## Remaining Investigation Leads

以下线索不是已确认缺陷，也不是本轮未完成的实施门禁。后续获得新的风险审计范围时，
从地图的未深审项重新核对实际源码、测试及输入，不自动开启全仓逐条 campaign。

- L-02：`__tests__/chat-view.test.ts` 的 Writing 已有 stream 派发等待修复；同区域固定次数
  轮转只是调查入口。出现可复现的时序窗口或相关 Chat 生命周期变更时检查，不据此判 flaky、
  删除测试或统一提高 timeout。
- L-03：`__tests__/pa-agent-runtime-prompt.test.ts` 同时包含提示规则与 SDK HTTP 接线；
  相关 prompt/权限入口变更时区分各自契约，不把提示文本当成执行边界，也不批量删字符串断言。
- 生产候选仅由上方 T-007/T-008 的启动条件承接。仍在生产调用的 confinement 和 WithHost
  renderer 是不可按命名删除的已核实反例。

## Retained Evidence And Resource Disposition

- 稳定规则、用户范围决定和 REQ/AC 保留在 Current GOV-004；本报告只保存独有裁决、
  保护承接和验收事实。覆盖地图改为 Archived 快照，两份 evidence JSON 按原字节迁移。
- Feature Home、Tracker 与重复计划/检查清单完成吸收后删除，Active Registry 移除 B-150；
  原过程包未提交，不声称可从既往 Git 提交恢复。T-007/T-008 保留在当前 Backlog。
- 隔离交付 worktree 和变异副本已在输入/恢复哈希核对后清理，使用正常 worktree removal；
  无强制删除。主工作区交付、共享依赖和原始证据保留，清理回执已收录于 validation.json。
- 没有部署、Git 提交、推送或发布；相应动作与本轮审计和文档收尾分开授权、分开验证。

## Documentation Verification

文档收尾只改变证据位置与引用，不改变测试、生产输入或既有验收规则；复用本轮已冻结的
运行时验收。收尾检查覆盖文档契约、引用完整性、空白诊断、地图迁移和证据字节身份。

- `npm run docs:check` 自然退出 0：236 Markdown / 2827 local links；4 项原有 architecture
  索引/可达性告警仍为 advisory，无新增 finding。
- `npm run test:docs -- --runInBand --watchman=false` 自然退出 0：2 suites / 58 tests 通过。
- tracked diff 与六份新增文件均无空白诊断；额外核对归档内部文件链接和 Markdown 锚点，
  当前文档没有残留的已删除 Tracker/Feature Home 引用。
- 两份 JSON 的迁移 SHA-256 一致；地图仍为 328 行、19 份深审、309 份未深审；接收
  工作区 888 个运行输入与最终已验收版本一致，HEAD 未变。收尾检查日志和额外核对回执
  保留在原始证据目录，不反写已经冻结的历史验证 JSON。
