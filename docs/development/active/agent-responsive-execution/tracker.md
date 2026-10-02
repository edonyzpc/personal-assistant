# Agent 响应性 Development Tracker

Document status: Current
Delivery status: Validating
Updated: 2026-10-02
Work item: B-155
Authority: 本 track 的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [Product Spec](../../../product/specs/pa-agent-responsive-execution-product-spec.md)
SDD: [Software Design](./sdd.md)

## Current Snapshot

- Current phase: CI 36976281261 已证实根因：Jest 30.3 的每 suite testNameStorage 未 disable，实际 SDK worker 积累97个 enabled ALS；每 Promise 初始化传播到全部实例。正常阶段5.012s中，CPU profile top20仅 ALS init/propagate 已计2.530s，已观测GC334ms，不能再把主要原因称为平台硬限制或GC停顿。
- Next action: 官方jest30.1.3＋globals30.1.2最终本地gate已通过：lint/build、完整coverage355 suites/8618 tests自然exit0、docs/diff/DOM；SDK在最后运行，正常/编辑响应577/560ms。500来源、6阶段、默认5s和全部断言保持，生产依赖零变动，冻结diff身份一致。提交推送exact-master完整CI；通过后按Owner既有授权包装beta.18并实际BRAT desktop/mobile smoke。首轮沙箱EPERM已明确superseded，保留完整设计，不自动closeout。
- Blocker / decision needed: 无产品决策；GLM 周限额，Owner 已授权 GPT 完整实施。早期自动审批的集成/竞态证据问题已补实测、独立复核并通过，接线已落地。
- Last verified behavior: 真实 query factory 500 ancestry × 500 候选的多次切片只完整准入一次，dirty 后再准入；真实 SDK 撤销拒绝、普通编辑保留快照；desktop/mobile 实际检索成功、准备时编辑可落盘、tab/原生命令/Stop 正常。
- Delivery tree: 基于主树 09c2961 的 managed worktree 已安全接收全部任务 diff 到主仓库；后续修正仅在主仓库，保留无关改动。
- Actual app target: 主仓库 `test/`，不改真实 `anthelion` vault。
- Owned resources: managed worktree 已可恢复归档，主树依赖保留；无运行中的任务 probe。三轮合成 fixture 均按唯一 marker 清理，最终 test 回到 16 篇基线、零自有会话/标签、原会话恢复、Host/fetch/Memory 恢复、mobile simulator 关闭。`/private/tmp/pa-responsive-*.log/json/cjs` 中本任务原始日志及 probe 脚本保留为验收证据；未清扫其它任务的文件。
- Stop point: 按 Owner 明确授权完成 master push、beta.18 发布及对应 BRAT smoke，保留用户要求的完整设计，不自动 closeout。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-155/REQ-01 / B-155/AC-01 | 有界协作执行及原生 UI | [x] | 真实切片回归与 desktop/mobile 准备期间原生操作 |
| T-02 | B-155/REQ-02 / B-155/AC-02 | 批次准入、直接单篇查询、分块检索 | [x] | 真实 factory 次数回归；原生 inspect/query/snippet 成功 |
| T-03 | B-155/REQ-03 / B-155/AC-03 | 撤销、身份、快照及派生来源 | [x] | Source/SDK/observation 回归与独立复核 |
| T-04 | B-155/REQ-04 / B-155/AC-04 | 准备取消、迟到结果、独立回执 | [x] | Dispatcher/runtime 回归；实际 Stop，准备取消后无下一物理请求 |
| T-05 | B-155/REQ-05 / B-155/AC-05 | 既有语义与包装 | [x] | 最终 lint/build/full 355 suites / 8598 tests PASS；标准资产一致 |
| T-06 | B-155/REQ-06 / B-155/AC-06 | 共享 gate 与适用 app smoke | [x] | 输入冻结、docs/diff/DOM、desktop/CLI mobile simulator，环境恢复 |

## Validation Planning And Reuse

| REQ/AC or risk | Change | Minimum sufficient evidence | Pass condition | Rerun / expansion trigger |
| --- | --- | --- | --- | --- |
| B-155/REQ-02 / B-155/AC-02 | cheap path guard、async lineage、direct lookup | 相关 executor/run/search tests；新增次数与 macrotask 回归 | 不随 candidate × ancestry 重做准入；真实事件循环能执行 | guard/枚举/调度实现变动 |
| B-155/REQ-03 / B-155/AC-03 | 读取与请求 checkpoint | 既有 scope/snapshot/revocation suites，切片期间撤销反例 | 撤销拒绝、普通编辑保留、身份替换拒绝 | 来源及 prepare hook 变动 |
| B-155/REQ-04 / B-155/AC-04 | abort-aware yield 与请求 fences | dispatcher/runtime 取消回归及实际停止 | 下一 I/O/provider 不启动，迟到忽略 | abort/timer/lifecycle 变动 |
| B-155/REQ-05 / B-155/AC-05 | async 检索/投影保持算法 | 既有工具、context、observation 回归；统一 lint/build/full Jest | 已有语义与正常打包通过 | 结果格式/排序/预算/配置变动 |
| B-155/REQ-01 / B-155/AC-01 | renderer 分块 | 当前构建部署到 test 后 desktop 原生编辑/tab/命令/停止；CLI mobile simulator 对应操作 | PA 准备进行时原生动作可完成，记录实际保存与停止 | 部署构建或相关 UI/runtime 变动 |
| B-155/REQ-06 / B-155/AC-06 | 共用 gate | docs:check、diff:check、DOM scan；复用 enclosing make deploy 检查 | 各证据范围、自然退出、输入身份明确 | 输入变化或实际发现遗漏 |
| B-155/REQ-05..06 / CI 调度夹具 | 真实 timer polling、分场景 eval、来源集成确定性调度计时 | 四 affected suites；时间预算直接回归；最终 exact-master 完整 coverage CI | 500 来源、撤销/编辑、完整 12 场景及跨场景证据保持；默认 timeout 与覆盖率门槛不变 | fixture 或调度行为变化 |
| CI 覆盖率资源竞争 / Owner 资源复审 | CI 与 release 同步 2 workers；保留全量、V8 coverage、5s 及现有断言 | workflow tooling contracts；一次 exact-master 全量 CI，输出实际 CPU/内存、time 统计、worker heap 与重型 case 时长 | Test 自然退出 0 且完整 coverage 门槛通过；诊断输出不覆盖失败；资源指标只作为诊断，不是产品性能合同 | 仍失败则重新审视测试分层与重复对拍，不盲目提高 timeout 或再开全量重试 |
| Owner 最小测试修复 / F-08 | SDK 去重复 oracle；已有 unit 承担有效/edit/delete 对拍；E-10 main/control 分独立 run 并清理已发生的超时 late-write | 三 affected source suites、type/lint/docs/diff；冻结后一次完整 exact-master CI | 500 三场景、12 主场景、8+4 轮、共享 50 请求及 aggregate 断言不变；默认 5s、coverage 和生产代码不变 | 仅新失败或实际缺口追加诊断；不加故障注入测试、通用 helper 框架或内部防御 |
| Owner 本地/GitHub 差异追因 | 临时两阶段 wall/CPU 观测；两 suite cold-cache coverage 对照 | 相同夹具和命令的本地/GitHub 日志，包含实际 worker/PID、wall/CPU、prepare/request/read 数 | 分清计算与等待；局部全局覆盖率不足仍自然 exit 1，不伪造完整 CI；观测结束删临时代码 | 只对实测差异选下一项诊断，不重复全仓或预先缩小夹具掩盖原因 |
| F-10 / 已证实 Jest ALS 累积 | 固定官方30.1.3/30.1.2依赖组合，删除临时诊断 | 现有SDK/eval/cooperative suites、干净npm ci含一致性校验；lint/build/full test coverage、docs/diff；exact-master CI | 原500/6阶段/5s/coverage通过，官方传递依赖匹配，产品源码不变；无额外测试矩阵/清理框架 | 现有断言失败才扩大定位；未来升级Jest需核实此路径修复，不凭latest假定 |
| B-155/REQ-03,05..06 / 已验证来源重复解析 | owned 标量 dependency 直接执行同一权限谓词；对象型仍保留 parser 副本；虚拟 reserve 匹配虚拟 timer | run / actual SDK / real query / writing preview focused；malformed 与 callback throw 反例；lint/build/完整 CI；BRAT desktop/mobile 最小 runtime smoke | strict 外部解析、scope/epoch/abort/独立 receipt 不变，500 与默认 5s 保留；完整检查和实际发布资产均通过 | 源码、夹具变化或 CI / app 新失败 |

不增加耗时阈值单测、全域性能基准、额外 provider 调用或真机 iOS gate。自动化次数/让出证明与原生操作证明承担不同问题。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | 单篇 current 查询全库，逐候选又校验全 lineage | 分离职责与直接路径查询 | T-02 | Fixed |
| F-02 | P1 | 同步准备垄断 renderer，停止/timeout 不能调度 | macrotask 切片及边界 abort fences | T-01/T-04 | Fixed |
| F-03 | P2 | 非命中 backlinks 成为数百项 ancestry | 本次保留真实扫描证明并消除重复验证；不凭不完整 epoch 静默丢弃证据；这不是剩余实施 gate | T-03/T-05 | Accepted design tradeoff |
| F-04 | P2 | JSON 廉价结构步骤使用过小切片增加调度等待 | 局部步骤上限 512，保留 8ms；不改 source/search 默认粒度 | SDK 500 依赖默认 timeout PASS | Fixed |
| F-05 | P2 | 新 snippet 枚举包装 native 异常破坏标准失败来源分类 | 原样交给既有 adapter 脱敏；保留 API 缺失及非数组业务契约 | E-06 与 snippet focused PASS | Fixed |
| F-06 | P2 | 普通编辑使不同准备段的 epoch 票据相互失效 | 固定 payload 先准备，末尾集中、有界重验授权；实际撤销仍拒绝 | SDK 500 依赖三场景与 snapshot 52 项回归 PASS | Fixed |
| F-07 | P1 | 实际 factory 每次 yield 后 executor 无条件重建 500 来源证明；准入耗时再触发下一次 yield，仍反馈放大 | executor 先检查 attempt abort/run/scope；严格票据有效即复用，首次/dirty 才完整准备；独立 receipt 不变 | 真实 factory 多候选次数回归及重新 app smoke | Fixed |
| F-08 | P2 | 多轮 eval / polling 与测试时钟不匹配；SDK 集成重复对拍增加成本，E-10 timeout 后运行未结束 | SDK 仅承担真实接线，等价对拍集中到已有 unit；500 连续 run 保留两阶段；E-10 main8/control4 独立测试，共享 cap/aggregate；afterEach 取消并等待 run＋driver 再恢复 timer，closed fence 阻止晚写 | 106 focused、类型/lint/docs/diff 与独立复核通过；最终 exact-master CI 待验 | In validation |
| F-09 | P2 | owned lineage 已严格解析，async 却对每个标量 dependency 再进行 single-lineage Zod 解析 | 复用同一权限谓词，仅 user-text/vault/web 使用已验证 DTO；对象型保留原副本；外部严格 parser 和 source-only 完整检查不变 | 独立 diff 复核与 136 focused PASS；CI 最终结果待验，不以 CPU profile 单独声称 Linux 根因已解决 | In validation |
| F-10 | P2 | Jest30.3为每suite启用ALS但不disable，复用worker积累97个上下文；大量Promise初始化传播放大SDK CPU，默认5s超时 | 固定官方jest30.1.3 / globals30.1.2：普通test不启用此ALS；30.2与30.5.2均仍有该路径，不盲升版本。保留500及原deadline，删除诊断，产品代码不变 | 源码链、真实GH97槽/profile及同机受控对照已证实；最终本地完整coverage355/8618 PASS，exact-master CI待验 | In validation |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-10-01 | B-155/REQ-01..06 / B-155/AC-01..06 | Source-verified design | 完成设计，实施中 | 基线与适用当前来源/快照合同；没有当前 app PASS 声明 |
| 2026-10-01 | B-155/REQ-02 / B-155/AC-02 | 检索 slice 6 suites / 137 tests | PASS，natural exit 0 | `/private/tmp/pa-bounded-search-tests.log`；直接单篇 identity lookup、分块枚举/排序/匹配；后续四处仅传 signal，35 项 observation focused 回归 PASS |
| 2026-10-01 | B-155/REQ-03..05 / B-155/AC-03..05 | Context/observation/hash slice 11 suites / 204 tests | PASS，natural exit 0 | `/private/tmp/pa-context-hash-final-focused.log`；异步投影、summary、Unicode hash 与取消；自有 lint/diff PASS |
| 2026-10-01 | B-155/REQ-03 / B-155/AC-03 | Source slice focused 5 suites / 93 tests | PASS，natural exit 0 | 准入500依赖、yield间撤销、普通编辑重新准入及未准备guard拒绝；生产runtime接线尚未验收 |
| 2026-10-01 | B-155/REQ-05 / B-155/AC-05 | 调度及provider输入辅助 2 suites / 5 tests；既有history 9 tests | PASS，natural exit 0 | `/private/tmp/pa-responsive-root-tests.log`、`/private/tmp/pa-responsive-history-tests.log`；新增toolResult测试缺timestamp已补，等待最终typecheck |
| 2026-10-01 | B-155/REQ-03..05 / B-155/AC-03..05 | 独立source/context/prompt复核 | 当前已实现辅助逻辑无新增P1/P2 | 来源owner hooks、私有lineage快照、独立receipt与token计数已核对；dispatcher截止/取消修正和实际runtime caller仍需最终复核 |
| 2026-10-01 | B-155/REQ-03..04 / B-155/AC-03..04 | Source 最终 5 suites / 99 tests；actual SDK 500 依赖 2 cases | PASS，natural exit 0 | 500 与默认 timeout 保持；正常 cachedRead=1，首物理请求后准备中撤销 cachedRead=0，后续请求剔除旧私有历史；SDK suite 2.373s，非性能 SLA |
| 2026-10-01 | B-155/REQ-05 / B-155/AC-05 | E-06 标准错误单场景；snippet 16 tests；最终 tsc 与自有 lint | PASS，natural exit 0 | `/private/tmp/pa-e06-standard-failure-test.log`、`/private/tmp/pa-snippet-enumeration-fix-test.log`、`/private/tmp/pa-responsive-typecheck.log`、`/private/tmp/pa-responsive-runtime-lint.log` |
| 2026-10-01 | B-155/REQ-03..05 / B-155/AC-03..05 | Runtime 合并后 4 suites / 25 tests；JSON 粒度相关 3 suites / 81 tests | PASS，natural exit 0 | `/private/tmp/pa-responsive-runtime-focused-final.log`、`/private/tmp/pa-json-granularity-focused.log`；之后 F-06 修正仅失效相关准备/来源证据，需对应 focused 与最终共享 gate |
| 2026-10-01 | B-155/REQ-03..05 / B-155/AC-03..05 | F-06 修正：SDK 500 三场景、snapshot 52 项、runtime/summary 69 项 | PASS，natural exit 0 | `/private/tmp/pa-responsive-sdk-admission.log`、`/private/tmp/pa-read-snapshot-reseal-focused.log`、`/private/tmp/pa-responsive-reseal-runtime.log`；真实撤销反例保持，普通编辑不失去 A |
| 2026-10-01 | B-155/REQ-05..06 / B-155/AC-05..06 | 首轮 make deploy | Lint / build PASS；full Jest 失败后明确 superseded，make exit 2，未部署 | `/private/tmp/pa-responsive-deploy.log`；新合作准备暴露旧 fake-clock/关闭后重放/生命周期 mock 假设；回环 HTTP 被 sandbox EPERM。保留原门槛，未制造绿色 |
| 2026-10-01 | B-155/REQ-05 / B-155/AC-05 | 受影响夹具：record 408、iOS transport 20、B129 118、ChatService 88、Pagelet 105 | PASS，natural exit 0 | `/private/tmp/pa-plugin-record-lifecycle-fix-test.log`、`/private/tmp/pa-ios-transport-fixture-focused.log`、`/private/tmp/pa-responsive-b129-focused.log`、`/private/tmp/pa-responsive-chat-service-focused.log`、`/private/tmp/pa-pagelet-runtime-fixture-fix-suite.log`；保留 deadline、取消、来源和异步图片契约，无 production 改动 |
| 2026-10-01 | B-155/REQ-05..06 / B-155/AC-05..06 | 首次最终 lint/build/full Jest、diff/DOM，deploy-current | PASS；355 suites / 8597 tests，natural exit 0 | `/private/tmp/pa-responsive-final-lint.log`、`/private/tmp/pa-responsive-final-build.log`、`/private/tmp/pa-responsive-full-pass.log`、`/private/tmp/pa-responsive-deploy-current.log`；已部署 test。F-07 生产修正使这些运行证据失效，重新共享 gate |
| 2026-10-01 | B-155/REQ-01..02 / B-155/AC-01..02 | 首轮 desktop 原生交互 | 编辑/磁盘保存/tab/阅读命令/实际 Stop 成功；整体未接受 | `/private/tmp/pa-responsive-desktop-running.json`；真实 metadata/snippet 接线推进偏慢，发现 F-07，停止并清理唯一 marker 505 路径及会话，恢复设置；未标 desktop PASS |
| 2026-10-01 | B-155/REQ-02..04 / B-155/AC-02..04 | F-07：真实 factory 回归及 source 5 suites / 127 tests，独立只读复核 | PASS，natural exit 0 | `/private/tmp/pa-source-admission-slices-test.log`、`/private/tmp/pa-responsive-admission-final.log`；500 ancestry × 500 候选的多次真实切片，仅首轮完整 prepare=1，dirty 后累计=2，stable+cancel 仍 AbortError；独立 receipt、未知 Host 完整 fallback 保留 |
| 2026-10-01 | B-155/REQ-05..06 / B-155/AC-05..06 | F-07 最终 lint/build/docs/diff/DOM | PASS，natural exit 0；DOM scan exit 1 无匹配 | `/private/tmp/pa-responsive-f07-lint.log`、`/private/tmp/pa-responsive-f07-build.log`、`/private/tmp/pa-responsive-f07-docs.log`；docs 保留 4 条既有 advisory；959 source/test/fixture/config/script 输入冻结于 `/private/tmp/pa-responsive-f07-freeze.sha256`，full 正在运行 |
| 2026-10-01 | B-155/REQ-05..06 / B-155/AC-05..06 | F-07 完整共享 gate 与 deploy-current | PASS：355 suites / 8598 tests，natural exit 0；冻结输入零变化 | `/private/tmp/pa-responsive-f07-full.log`、`/private/tmp/pa-responsive-f07-deploy.log`；Jest 有 1 秒退出提示，随后自然退出；已有本地 HTTP handles 39 项诊断无 leak 报告，不使用 forceExit；最终标准三资产与 test 安装逐字节一致 |
| 2026-10-01 | B-155/REQ-01..02,04..06 / B-155/AC-01..02,04..06 | 最终 desktop 原生 smoke | PASS | `/private/tmp/pa-responsive-desktop-final-running.json`、`/private/tmp/pa-responsive-desktop-final-stopped.json`；500 backlinks，实际 inspect/query/snippet 均 success；request preparing 时编辑事件真实调度，两笔记落盘、tab/阅读命令、可见 Stop；停止时及后续 providerRequests=4，active=false；dev:errors 无记录。使用合成 provider，不证明收费模型网络表现 |
| 2026-10-01 | B-155/REQ-01..02,04..06 / B-155/AC-01..02,04..06 | CLI mobile simulator + 实际 UI smoke | PASS | `/private/tmp/pa-responsive-mobile-final-running.json`、`/private/tmp/pa-responsive-mobile-final-stopped.json`、`/private/tmp/pa-responsive-mobile-final-stop-stable.json`；isMobile=true，500 backlinks、三工具 success、prepare 期间原生编辑，两笔记落盘、tab/阅读/Open Chat 原生命令、可见 Stop；准备第 6 请求时停止，completedPrepares/admissions/providerRequests 保持 5，后续无新请求；dev:errors 无记录。不涉及 iOS 专属能力，无真机 gate |
| 2026-10-02 | B-155/REQ-06 / B-155/AC-06 | 环境与数据恢复 | PASS | simulator on/off 会重载并清除临时 JS 控制；desktop 资料先按已记录 marker 核实回收，再建立独立 mobile fixture，未使用丢失的控制作证。`/private/tmp/pa-responsive-desktop-reload-cleanup.json`、`/private/tmp/pa-responsive-mobile-cleanup.json`、`/private/tmp/pa-responsive-final-app-restored.json`、`/private/tmp/pa-responsive-final-ui-restored.json`：每轮 505 自有路径、会话清理；最终 16 篇、零自有会话/标签、原会话恢复、Memory/Host/fetch 恢复、isMobile=false、标准资产一致 |
| 2026-10-02 | B-155/REQ-06 / B-155/AC-06 | 交付树安全回收 | PASS | worktree 49 个任务路径全部在主树，5 个差异均为已验证的后续主树修正；唯一 ignored 项为共享 node_modules。archive_worktree 完成，list_artifacts 确认为 archived_worktree；当前主树源码与冻结 959 输入仍一致。没有主树 commit/push/release |
| 2026-10-02 | Owner 本轮 master 提交授权 | 本地 master 签名交付 | Runtime/tests 已提交并验签 PASS；设计与验收文档随本次独立提交交付 | `f2e7245d8307f662489f656c557b452eea589a8c`：45 runtime/test 文件，Good signature。冻结 959 输入仍一致，复用完整 8598 项及原生验收证据；未 push/release/closeout |

| 2026-10-02 | Owner master push / beta 授权 | 首次 master CI 36954401673 与本地四 worker coverage 原始复现 | CI 3 suites / 4 tests 失败；本地 355 suites / 8598 tests PASS，natural exit 0 | `/private/tmp/pa-beta18-master-ci-failed.log`、`/private/tmp/pa-beta18-full-coverage.json`；本地聚合 eval 4.781s、正常/编辑来源集成 3.818/3.608s。CI 超时未被视为通过；beta 尚未包装或发布 |
| 2026-10-02 | F-08 / B-155/REQ-05..06 | affected 四 suites 带 coverage 运行 | 54 项行为断言 PASS；局部覆盖率未满足全局门槛，command exit 1，不当作完整 gate | `/private/tmp/pa-beta18-fixed-focused.json`；500 来源正常/编辑 2.030/2.105s；12 场景及 aggregate 均独立默认 deadline，无改生产逻辑；完整 exact-master CI 待验 |
| 2026-10-02 | F-08 / B-155/REQ-05..06 | 标准 source focused、lint、docs、diff | 四 suites / 54 tests PASS，natural exit 0；lint/docs/diff PASS | `/private/tmp/pa-beta18-fixture-focused.log`、`/private/tmp/pa-beta18-fixture-lint.log`、`/private/tmp/pa-beta18-fixture-docs.log`；生产源码未变，既有 desktop/mobile 行为证据保持；随后 CI 36956186903 的 E-10 与来源集成仍超时，该夹具修正不足，未发布 |
| 2026-10-02 | F-08 / B-155/REQ-05..06 | timer idle 的进一步夹具修正 | 四 suites / 54 tests PASS，natural exit 0 | `/private/tmp/pa-beta18-timer-final.json`；500 来源正常/撤销/编辑 0.407/0.183/0.401s；E-10 0.262s，八轮恢复及无进展控制原断言保持。Jest runAllTimers 会在 WebCrypto pending 时误跳到远期 deadline，E-10 改为有界 1ms 推进；没有放宽生产 deadline、默认 test timeout、覆盖率或请求 cap。测试计时不作性能证据 |
| 2026-10-02 | F-08 / B-155/REQ-05..06 | CI 36957506236 与最后的 SDK timer driver | CI 354 suites / 8608 tests PASS，500 来源 suite 的三场景仍超时；修正后四 suites / 54 tests PASS，natural exit 0 | 原始 `/private/tmp/pa-beta18-third-master-ci-failed.log`；SDK 的一次性 runAllTimers 可能在原生异步 I/O 尚未完成时提前结束，后续新 timer 无驱动。改成有界、小步推进直到整轮 settled，夹具 read 明确跨真实 setImmediate；500 来源保留，正常/编辑额外断言实际工具回执 isError=false；撤销仍 cachedRead=0 且旧私有历史剔除。`/private/tmp/pa-beta18-sdk-driver-final.json`。未发布失败构建 |

| 2026-10-02 | F-08..09 / B-155/REQ-03,05..06 | CI 36960573234 的一次性阶段诊断 | 未通过，不发布 | `/private/tmp/pa-beta18-stage-ci-failed.log`：unchanged 在 3s 时 tick=23、prepare=completed=3、request=1、read=1、pendingTimers=1；首请求/读取已完成，不能称前置死锁。首超时后仍运行并污染后续 fake timer。另有 reserved writing 的虚拟 Date.now 与真实 deadline 先于请求触发。诊断代码已移除。CPU profile 指向重复 strict parse，但不足以单独证明 Linux 耗时根因 |
| 2026-10-02 | F-09 / B-155/REQ-03,05 | 标量权限谓词及独立只读复核 | 4 suites / 136 tests PASS，natural exit 0；lint/type/diff/DOM PASS | `/private/tmp/pa-beta18-scalar-focused.json`；2 malformed＋1 callback throw 反例；外部严格解析、对象副本、fallback、epoch、abort、receipt 保留。生产改变需最终完整 CI 与发布资产 app smoke，旧源码实测不替代新资产检查 |
| 2026-10-02 | F-08..09 / B-155/REQ-05..06 | 更正 coverage CLI 参数后的限定文件检查 | 4 suites / 136 行为断言 PASS；局部覆盖率未满足全局门槛，natural exit 1 | `/private/tmp/pa-beta18-scalar-targeted-coverage.json`：正常/撤销/编辑 959/206/806ms，不作性能 SLA。误用 coverageReporters variadic 参数的前次运行意外选了全仓且未先 build，353 suites 通过、2 artifact suites 因过期 provenance 失败；`/private/tmp/pa-beta18-scalar-focused-coverage.json` 明确非完整 gate，不以此制造绿色 |

| 2026-10-02 | F-08..09 / B-155/REQ-03,05..06 | CI 36961802941 与连续 SDK 请求边界夹具 | CI 354 suites / 8612 tests PASS；仅正常/普通编辑两轮总默认 5s 超时，不发布 | `/private/tmp/pa-beta18-scalar-master-ci-failed.log`；撤销与 writing 恢复，afterEach 取消后没有旧 timer 污染。夹具分成同一 run 的两阶段，离线 first fetch 记录后先暂停响应；阶段1 request=1/read=0，阶段2释放同一响应并保留全部原断言。第一阶段未通过则取消并等待 run＋driver；阶段2明确拒绝未验证的前置状态。每段默认 5s，500 与生产 deadline 不变；不再证明整轮总 5s，SDD 不设耗时 unit SLA |
| 2026-10-02 | F-08 / B-155/REQ-03,05 | SDK 两阶段源码 / coverage 局部检查与独立边界复核 | 6 项 PASS；source natural exit 0，focused coverage 因全局门槛 exit 1 | `/private/tmp/pa-beta18-phased-sdk.json`、`/private/tmp/pa-beta18-phased-sdk-coverage.json`；持久 request 数组与 plain counters 跨阶段保留，clearMocks 不影响 first read=0 后第二阶段实际读次数；full CI 仍待验，不能用 focused 替代 |
| 2026-10-02 | F-08 / Owner CI 资源复审 | CI 36963141250 | 353 suites / 8613 tests PASS；SDK 第二阶段两场景与 E-10/aggregate 共 4 项失败，不发布 | `/private/tmp/pa-beta18-phased-master-ci-failed.log`；第一阶段/撤销通过，分阶段仍不能解决重型阶段的 5s 超时；E-10 超时导致 aggregate 缺项。失败为 Jest timeout，未见 OOM/runner 强杀；公开 Ubuntu runner 标称 4 CPU/16GB，但本轮缺实际资源峰值，不认定平台限流。冻结源码/夹具，下一次仅用 2 workers 与资源输出验证竞争假设；不实施已考虑的 15s timeout |
| 2026-10-02 | CI 覆盖率资源预算 | workflow / release CI evidence / classifier tooling contracts 与 docs/diff | 3 suites / 97 tests PASS，natural exit 0；docs/diff PASS | `/private/tmp/pa-beta18-ci-resource-contracts.log`、`/private/tmp/pa-beta18-ci-resource-docs.log`；只改两份 workflow 与对应命令合同，源码/重型夹具冻结；完整两 worker CI 待验 |
| 2026-10-02 | CI 覆盖率资源预算 / Owner 复审 | CI 36966858602，冻结相同源码/夹具，只降 4→2 workers 并输出资源 | 354 suites / 8615 tests PASS；仅 SDK 正常/普通编辑第二阶段两项超时，natural exit 1；不发布 | `/private/tmp/pa-beta18-resource-ci-full.log`；实际 availableCpu=4，AMD EPYC 7763，memory=15.61GiB；GNU time 245% CPU、最大 RSS 2428448KiB（不是所有 worker 总峰值），SDK suite heap=790MB，未见 OOM/平台强杀。E-10=2659ms PASS；SDK 首请求正常2037/编辑2349ms，第二段5012/5007ms超时，撤销第二段284ms PASS。全量618.131s，比前轮435.013s长；低并发有助 E-10，但不足以解决 SDK 重复工作，不认定平台硬限制为主因 |
| 2026-10-02 | SDK / eval 测试职责复审 | 原始测试与独立只读复核 | 设计结论，尚未实施 | SDK wrapper 每次 prepare 额外 `admitsLineage`＋`sourceValidity`/legacy capture 完整对拍，主要重复正常 true；撤销 prepare 抛错时不对拍 false。scope/mixed/unknown 等价、500 yield 撤销和真实 query sealed 复用已有底层覆盖。后续最小整理：SDK 保留 500 与真实接线断言，回执 true/edit-true/revoke-false 用小 fixture 验证；E-10 8+4 保留，但分独立 run test，幂等取消并等待 run/driver 后再还原 timer，禁止 timeout 后晚写 aggregate。不加框架、不扩大 runner、暂不提高 timeout，不以全量盲重试代替分析 |
| 2026-10-02 | Owner 最小测试修复 / F-08 | 三 affected source suites、类型/lint/docs/diff、独立只读复核 | 106 tests PASS，natural exit 0；静态检查 PASS；无具体 review 缺口 | `/private/tmp/pa-beta18-dedup-source-tests.log`（SDK/run 82）、`/private/tmp/pa-beta18-e10-final-source.log`（E10 24）；去两处每 prepare 对拍，已有普通 edit unit 增加 legacy true/edit-true/delete-false。E-10 两臂各自取消/等待 run+driver、恢复 timer，Jest 顺序与幂等 cleanup 保证 slot 置空，无额外身份防御。500 三场景、actual12、8+4、共享50、所有 aggregate/E11 断言不变；生产代码、5s、coverage 不变，无新增框架/故障注入或 app gate。冻结后一次完整 CI 待验 |
| 2026-10-02 | Owner 本地/GitHub 差异追因 / F-08 | CI 36971604883，master 16554672 | 354 suites / 8616 tests PASS；仅 SDK 两个工具响应阶段 5014/5012ms 超时；不发布 | `/private/tmp/pa-beta18-test-repair-ci-full.log`；E-10 main/control 2059/303ms PASS，SDK 首请求 1974/1685/1582ms，撤销响应 244ms。全仓 760.43s，最大 RSS 2751708KiB（非所有 worker 总峰值），未见 OOM/平台强杀。同一基线本地两 suite coverage 30 断言 PASS、2.521s，SDK 响应 575/39/516ms；局部 global coverage 不足自然 exit 1。范围、cache、Node patch、硬件仍有变量，不能据此断言具体根因。 |
| 2026-10-02 | Owner 本地/GitHub 差异追因 / F-08 | 临时 CI 36974550776：cold-cache、coverage、2 workers、显式 default reporter，仅 SDK＋eval | 本地/GitHub 均 30 断言 PASS；局部 global coverage 不足，各自然 exit 1；不是完整 gate | `/private/tmp/pa-sdk-local-cold-phase-default.log`、`/private/tmp/pa-sdk-phase-gh-full.log`；正常响应本地 wall/CPU=605/776ms、GitHub=2339/2824ms；编辑=534/583ms 对 1913/2069ms；撤销=41/49ms 对142/160ms。SDK 均 worker=2，5/5/6 prepare、2 request、1/0/1 read 相同。CPU 含进程辅助线程，证明不是主要空等，未量化 GC。GitHub SDK 末 heap343MB，完整失败轮538MB且执行前已跑约8分钟；其它 worker 输出 heap 曾到1900MB，不能以这些不同进程的末值直接证明 GC 因果。本地自动 AgentReporter 隐藏 PASS console/heap，是日志差异，显式 default 后仍通过。 |
| 2026-10-02 | Owner 本地/GitHub 差异追因 / F-08 | 临时 CI 36975030496：六 suite 先运行重型 UI/VSS，再 SDK，记录 heap/GC | 本地/GitHub 均 828 断言 PASS；局部覆盖率不足自然 exit 1；未复现全量超时 | `/private/tmp/pa-sdk-local-worker-reuse.log`、`/private/tmp/pa-sdk-worker-reuse-gh-full.log`；GitHub 正常响应 wall/CPU=1956/2306ms，已观测 GC 49次/88ms，编辑1751/1944ms、49次/92ms；SDK首段起始heap174MB、末455MB。process CPU含辅助线程、GC事件仅代表已观测时长，不能由此排除全量特有的资源竞争或后台回收；不再把heap增长直接当作已证实原因。 |
| 2026-10-02 | F-10 / 因果验证 | 同本机、同500来源SDK、V8 coverage、默认5s、runInBand的0/150自有ALS受控实验 | 两轮6断言PASS，均natural exit0；局部证据不替代全仓 | `/private/tmp/pa-sdk-als-{0,150}.log`：实测slots1→151，正常587→2799ms、编辑471→2638ms、撤销35→70ms；正常CPU807→2949ms、GC39→162ms；150轮profile top20仅 `_propagate`已至少1276ms，基线7ms。preload只disable自己150个，结束槽数回1。证明额外enabled ALS足以放大，并非把模拟实例数冒充真实GH数。 |
| 2026-10-02 | F-10 / 真实失败栈 | 完整 CI 36976281261，master33e53958 | 354 suites /8616 tests PASS；仅SDK正常/编辑响应5.012/5.016s超时，natural exit1 | `/private/tmp/pa-sdk-als-full-gh.log`：worker2实际slots97，起始heap约223MB；正常CPU5557ms、已观测GC334ms，top20原生ALS init/propagate合计2529.614ms为下界，GC profile378ms。请求1/read1/prepare3时已超时，非网络死锁、非OOM/平台强杀。完整565.605s、maxRSS2528920KiB；失败后既有cleanup取消并等待。36975656966因补slots观测明确cancelled/superseded，非通过证据。 |
| 2026-10-02 | F-10 / 修复候选只读复核 | 官方npm源码、integrity与Node22/timer兼容链 | 设计结论，实际依赖验收待完成 | `/private/tmp/pa-jest-upstream-{30.1.3,30.5.2}/`；30.5.2仍每VM新ALS无disable，不采用。30.1.3仅concurrent时启用，本仓无concurrent tests；匹配globals30.1.2及官方不同patch传递组合，不单包override。Sinon13同样捕获真实setImmediate，tickAsync/doNotFake所需约束保留；其它timer差异由现有suite/full gate验收，无新增矩阵。 |
| 2026-10-02 | F-10 / 最小候选修复 | SDK/eval/cooperative 3 source suites；最终lock的干净npm ci；独立依赖/断言复核 | 33 tests PASS，natural exit0；npm ci自然exit0；无具体review缺口 | `/private/tmp/pa-jest-pin-focused.log`、`/private/tmp/pa-jest-pin-clean-install.log`；npm自动hoist的产品semver提升已撤回，原生产依赖全部逐条一致，仅dev树变动。SDK逐字恢复16554672，无减500/放5s/改断言；关键family按真实解析路径mismatch0、ts-jest peer兼容。focused早于最终semver收窄，最终完整gate仍须覆盖最终lock；不把此focused当完整PASS。 |
| 2026-10-02 | F-10 / 本地最终gate环境修正 | lint/build/full coverage | lint/build PASS；沙箱full被明确停止，exit143、superseded，不计通过 | `/private/tmp/pa-jest-pin-{lint,build,full}.log`；Ghost回环服务器listen EPERM，属于本机执行权限错误，不是SDK超时。以允许回环服务器的权限重跑full，复用未变输入的lint/build；没有改变测试代码或降低门槛。 |
| 2026-10-02 | Owner 本地/GitHub差异解释边界 | 已保存旧本地full与当前cold pair证据，只读、零新测试 | 旧本地full355/8598 PASS，SDK正常3818ms/编辑3608ms；当前cold pair正常605ms/GH2339ms | `/private/tmp/pa-beta18-full-coverage.{log,json}`；旧SDK在108.346s启动，此前所有worker合计349 suite结束，不能称本地提前跑，也不能换算该worker槽数。旧full缺PID/slots/CPU且夹具版本不同，无法精确拆分各因素；环境整体速度差与已证实ALS累积共同解释阈值差异，97是总enabled native ALS而非全数Jest实例。 |
| 2026-10-02 | F-10 / 最终本地共享gate | npm run test:all -- --runInBand --coverage --reporters=default --json；复用lint/build；docs/diff/DOM | PASS：355 suites/8618 tests、coverage门槛，natural exit0；静态检查PASS | `/private/tmp/pa-jest-pin-final-full.{log,json}`（775.351s）、`/private/tmp/pa-jest-pin-{lint,build}.log`、`/private/tmp/pa-jest-pin-final-docs.log`；SDK全仓最后运行，正常/撤销/编辑响应577/46/560ms，首请求195/137/130ms。冻结diff SHA256 6fe9dfb79b4e5fa8368d19da6faeec553e841c6da4772db71356ff9aefe0a508始末一致；没有forceExit、timeout/coverage放宽或新增测试矩阵。exact-master CI仍独立待验。 |

## Acceptance Boundary

GPT 在 Owner 授权的完整设计实现范围内独立验收。全部 T-01..06 完成，无未处置 P1/P2 或必要产品决策。Validated 表示此构建与上述合成资料/平台的证据门通过，不表示任意硬件/资源压力下的硬实时保证、真实 provider 性能、真实 vault 已更新、master 已提交/推送或版本已发布。

原故障的约 2470 万项是量级估算；当前次数回归证明该乘法结构已消除，不把它转换成未经测量的速度倍数。

## Closeout Readiness

- [x] Owning contract 与实际行为一致。
- [x] Required review/smoke evidence 已记录。
- [x] 无剩余实施或验收项需要移入 Backlog。
- [x] 稳定结论已吸收到 current contract/tests。
- [x] 用户要求的完整 SDD 保留；执行停在 Validated 与 Owner 明确授权的本地 master 提交，没有自动 closeout/push/release。
