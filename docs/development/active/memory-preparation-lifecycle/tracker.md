# Memory Preparation Lifecycle Development Tracker

Document status: Current
Delivery status: Validating
Updated: 2026-11-13
Work item: B-197
Authority: 本切片唯一执行状态、finding 和验证证据。
Product spec: [Product Spec](../../../product/specs/pa-memory-preparation-lifecycle-product-spec.md)
SDD: [SDD](./sdd.md)

## Current Snapshot

- Owner 已选择 A，并授权必要文档、开发、测试与本地验收，不过度设计/测试。
- Baseline: master `07e638c2825a3fdf62a96d4182b63ac0ae49a5c0`；开始时仅本任务讨论文档 dirty。使用当前合适 checkout，保护全部现有修改。
- Current phase: 已知源码finding F01–16均已修正并独立复核；最终冻结输入的platform、lint、生产build、全组Jest通过（405 suites / 9940 tests，零失败/跳过）。当前仅余计划内app验收。Owner要求保存到master并转MacBook继续，因此停在Validating，不标Validated。
- Ownership: GPT-6 负责权威文档、派工、独立验收；单个 GLM writer。隔离、注入、鉴权和工具检查通过；私人 vault 不外发。
- Execution order: 回归目标失败 → Chat/Manager 生命周期 → 状态/进度/终态 → 独立审查 → 冻结输入统一检查 → 测试 vault 交互。交付顺序与回滚见此页/SDD，无额外 Plan。
- Validation owner: writer focused；冻结后单执行者统一 gate；GPT 负责可见 app 操作。受影响 desktop/mobile 入口，不要求 iPhone，不用私人 vault 或真实模型长重建。
- Next action: MacBook拉取本次master检查点，按本机规则准备test vault和当前构建，补齐下面列出的桌面/CLI mobile交互。相同源码/测试/配置可复用本次完整自动检查；不能把Linux构建/CLI预检当作Mac本机部署或工具成功。原红灯、worker与最终gate日志保留在Linux，不要求新设备访问它们才能继续。
- Validation resources: Linux `/tmp/b197-validation/`保存完整自动检查日志，`/tmp/b197-app/`保存受控VSS夹具、截图和清理记录；这些临时资源不随Git同步，不是MacBook前置依赖。夹具仅替换索引边界，执行部署包的真实Manager/确认/通知/UI；无真实provider、无私人vault。实际Chat类型为`sidellm-view`。不新增通用测试框架或独立handoff文档。
- Cleanup: Linux测试库已取消合成任务，恢复原Manager/VSS、配置检查方法及自动维护；fixture与备份global已移除，activeRun=false。已恢复原cat.md叶、原Chat会话/空草稿、窗口/焦点，mobile=false、debug=false；当前测试库保留已部署3.0.6构建。未改私人Anthelion。
- Open product decisions: 无。Owner于2026-11-13明确授权将当前进展提交并推送master供MacBook续接；不授权tag/release或closeout。

### MacBook Resume Point

1. 阅读本Snapshot、SDD与当前AGENTS；按本机GPT-6/GLM工作流核对工具。GPT负责验收/文档，若发现具体源码或测试问题，再按现有路由派给GLM；不为已通过输入重开全面审查。
2. 确认本机工作树、依赖和目标`test/`，构建当前产物并按部署复用规则部署/重新加载。Linux已通过完整gate，换设备本身不要求再跑全组测试；依赖/源码/配置变化或具体失败才补受影响检查。不要部署到私人vault。
3. 桌面与CLI mobile补原定链路：批准准备 → Chat Memory Status → 关闭进度 → 显式重看 → 重复Prepare/Update复用。检查当前计数、关闭后被动更新不重弹、观察不加入shared consumer、重复动作不重建第二次。完成/失败各一条受控分支，确认单次终态和可重看结果；旧Memory当前可用性与最近结果分开。
4. 使用真实部署Manager/UI与受控VSS延迟/完成/失败，复用源码测试中的行为夹具思路；不得复刻产品逻辑。无须真实模型调用、私人全库重建或iPhone。Linux仅观察到用户点击确认后一次run、`answer-now`/`preparationState=running`和进度2/30、7/12；这不是后续链路或完成/失败的PASS。Linux自动鼠标点击因200%坐标未命中，不能记产品失败，也不能照搬X11助手到Mac。
5. 记录本机新鲜错误/控制台与实际可见操作，恢复临时夹具、布局、debug/mobile状态。满足全部剩余证据后更新本Tracker为Validated；closeout和发布仍需单独授权。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-197/REQ-01 / B-197/AC-01 | 前置确认与后台返回 | [~] | 跨层与完整gate通过；Linux真实确认后后台返回已观察，其余app链路待补 |
| T-02 | B-197/REQ-02 / B-197/AC-02 | owner/attempt/consumer生命周期 | [x] | 原目标红灯、稳定owner/shared/首次与旧同步取消及最终全组通过 |
| T-03 | B-197/REQ-03 / B-197/AC-03 | 来源/配置准入与兼容 | [x] | 撤销零effect、restricted、无owner、Pagelet/旧调用、来源撤回保护及最终全组通过 |
| T-04 | B-197/REQ-04 / B-197/AC-04 | preparing、重看、重复入口 | [~] | 竞态/重看/被动不重弹/复用及最终全组通过；桌面/mobile完整实际入口待补 |
| T-05 | B-197/REQ-05 / B-197/AC-05 | 真实计数与单次终态 | [~] | 五类结果与当前可用性分离及最终全组通过；app完成/失败分支待补 |
| T-06 | B-197/REQ-06 / B-197/AC-06 | durable准入及旧run隔离 | [x] | 补偿、旧run隔离和跨层单次admission保护及最终全组通过 |

## Findings

最终自动gate已全部通过，独立源码复核无未解决finding；共同剩余门为上述app验收，不把源码修复结论等同整体验收完成。

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | 长准备绑短attempt并包含确认等待 | 分离preflight和operation；不延长检索预算 | 实现前目标回归 | Fixed; final gates pending |
| F-02 | P2 | 进度关闭后失联、active状态未优先 | 复用snapshot和Notice，显式重看 | UI和状态测试 | Fixed; final gates pending |
| F-03 | P2 | 重复入口/终态/计数不能准确表达工作 | 具体命令复用、单终态、文件计数 | 负例及原操作链 | Fixed; final gates pending |
| F-04 | P2 | 新owner controller只识别私有Stop reason，漏supersede；首个owner绕过消费者计数 | 复用真实caller signal和既有consumer等待；移除额外原因协议/无条件取消权 | 正常完成、真abort、多consumer | Fixed; final gates pending |
| F-05 | P2 | Pagelet context-only附件错误禁用Chat新模式；同步分支影响独立Pagelet取消 | 所有Chat启用；独立Pagelet/旧同步维持原signal等待，first-use例外保留 | Chat handoff及同步兼容 | Fixed; final gates pending |
| F-06 | P2 | preflight丢弃cancel与准备中消息，并提前绕过结果投影 | 明确cancel；保留decision事实并经过统一投影 | 实际跨层确认/返回/取消 | Fixed; final gates pending |
| F-07 | P2 | completed回退失败文案；last outcome替代当前状态 | 成功正确消息；当前可用性+最近结果并列 | 成功/失败/Reset后的状态 | Fixed; final gates pending |
| F-08 | P2 | lexical finalizing重开后取消按钮复活；旧plan reject盖掉preparing | 恢复阶段状态；catch也重读active | 两个最小状态负例 | Fixed; final gates pending |
| F-09 | P2 | 初轮active复用仍晚于plan/早退；结果计数/接口尚未闭环 | 完成原AC04/05；show函数只显式调用，读状态用snapshot | 原入口链与被动刷新不重弹 | Fixed; final gates pending |
| F-10 | P2 | 非后台approved仍用长owner；缺owner Host分支提前返回错误层结果 | 恢复旧同步signal；无owner关闭新后台模式并走正常投影 | 双signal同步取消、无owner Ready查询 | Fixed; final gates pending |
| F-11 | P2 | 旧plan在准备完成后返回，仍可覆盖较新Ready | 最小请求序号与当前视图检查 | 真正pending后开始/完成的异步时序 | Fixed; final gates pending |
| F-12 | P2 | lexical非用户aborted事实丢失，被分类failed | 保留内部中断事实，复用统一终态 | interrupted/partial最小分支 | Fixed; final gates pending |
| F-13 | P2 | 两条Chat竞态测试预先设active，未调用目标plan分支 | 修正输入时序并断言实际plan已挂起；Notice fixture作用域同时修正 | 运行修订后的现有用例 | Fixed; final gates pending |
| F-14 | P2 | background/只读复核用展示preparing拒绝底层仍ready的lexical/refresh Memory | Manager区分展示状态与现有索引可读性；保留合法旧Memory，full rebuild仍answer-now | active lexical真实只读查询；不得二次准备 | Fixed; final gates pending |
| F-15 | P2 | 移除全局owner默认参数后，旧两参数first-use失去原signal取消兜底 | 仅first-use局部恢复owner??signal，检查与启动一致；不放宽新后台模式 | 既有首次取消用例改为两参数，保留独立owner负例 | Fixed; final gates pending |
| F-16 | P2 | 任意skipReason替代规范unavailable说明，既丢安全约束又破坏封闭来源识别 | 普通结果恢复固定说明；Manager封闭准备状态事实投影为保留安全约束的固定新形态，runtime精确识别 | 6条既有安全回归不变；跨层准备中与runtime来源用例 | Fixed; final gates pending |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-11-13 | B-197/REQ-01–06 | 源码设计与两路独立只读复核 | Design reviewed | 修复范围/边界已进入SDD；此前隔离Manager/通知观察不是修复验收 |
| 2026-11-13 | B-197/REQ-01–06 | 文档准入 | PASS | `npm run docs:check` 372 Markdown / 4780 links，exit 0；`git diff --check` exit 0 |
| 2026-11-13 | 执行环境 | GLM preflight | PASS | CLI 0.157.1；pa-glm/ZAI 原端点，glm-5.3/max，服务端型号未独立证实。宿主合成 allow/deny：READ_OK / FileNotFoundError；本机 catalog 覆盖，memory/skills/plugins/MCP关闭，实际 prompt preview 无私人注入。AUTH_OK；实际 read/patch/assert exit0/预设exit7。证据 `/tmp/b197-worker/{prompt-input.json,auth,tools}`，隔离探针 `/tmp/b197-preflight`。初次 auth 的无关 Stripe 初始化失败，后续关闭 plugins，未发送项目材料到该连接 |
| 2026-11-13 | 验证环境 | 构建隔离与 app 目标 | Ready | wybuild 合成命令实际位于独立 `wybuild.slice`；外层受限调用不能访问用户 bus，使用获准宿主调用。Obsidian 1.15.1；test=/mnt/code/personal-assistant/test，原插件3.0.1、mobile=false、debugAttached=false、cat.md；尚未部署或验收 |
| 2026-11-13 | B-197/REQ-02 / B-197/AC-02 | 实现前目标回归 | Expected FAIL | GLM 新增 `keeps an approved settings-changed preparation on its stable owner signal`；真实 Manager + 延迟 VSS，attempt abort/owner live 后 preparationSignal.aborted=true，预期false。1 failed/64 skipped，Jest exit1；worker正常exit0。GPT已读实际diff与失败断言，清理等待完整；`/tmp/b197-worker/reproduce/{regression.log,test.diff,result.md}` |
| 2026-11-13 | B-197/REQ-01–06 | 初轮进行中team审查 | Changes required | 两路功能/生命周期及一路测试必要性只读审查，GPT读关键实现确认F04–09。新增取消原因协议有实际遗漏，须简化；其他display/进程内结果有需求依据，未按行数判过度设计。尚未完成测试不能记过度测试或漏项 |
| 2026-11-13 | B-197/AC-02 | 初轮局部验证 | Partial / not accepted | 原Manager回归1pass/64skip；Manager suite64pass/1fail（进度Notice与终态消息fixture混计），随后仅mock区分修改，未复跑。命令尾部printf掩盖Jest退出，依日志结果为FAIL，不记shell exit0为通过。原回归未区分新Chat模式与旧同步兼容，修订时迁入显式后台路径，保留attempt不取消及owner真取消断言；理由为恢复已批准兼容范围，不为实现放宽断言 |
| 2026-11-13 | B-197/AC-01–06 | r3增量review与局部验证 | Changes required | Manager 69/69曾通过（`fix/manager-focused-3.log`），其后fixture变化须重验；跨层生命周期已运行，尾部内容检索夹具仍失败。确认F10–13；原F04及F07主要源码偏差已修，未冒充最终验收。跨层尾部收敛为真实空结果查询/无二次准备/标准投影，复用已有内容检索测试；保留长确认、后台返回、准入与来源撤销核心断言，不新增同义矩阵 |
| 2026-11-13 | 验证环境 | r4 focused首批失败分类 | Environment + implementation/fixtures | `final-fix/focused-batch-1.log`：8 suites失败/6通过，19失败/1112通过。其中Pagelet缺`classifyRateLimitError`源于本机node_modules与锁文件不符：core锁1.3.2/安装1.1.41，openai锁1.8.0/安装1.4.4；原provider源码不改，当前writer结束后按现有锁文件恢复依赖，再验受影响项。其余返回投影、fixture方法/时序等由r4处理；不弱化正确断言以求通过 |
| 2026-11-13 | B-197/AC-01–06 | r4完成的定向检查 | Scoped PASS / full gate pending | `final-fix/manager-focused-final-2.log` 70/70；`focused-batch-2.log`中cross-layer 3/3及plugin/host-tools/phase1/source相关6 suites通过，最后Manager单独修正并通过；首批Chat/runtime Memory/search、integration/status/handoff 6 suites通过。Pagelet目标Memory 2通过/50未选；完整Pagelet须恢复依赖后重验。worker自然exit0，未构建/部署，不标Validated |
| 2026-11-13 | 验证环境 | 按锁文件恢复依赖 | PASS | wybuild内`npm ci`自然exit0，95.2秒；package.json/package-lock.json散列前后一致，core1.3.2/openai1.8.0与锁一致；`/tmp/b197-validation/npm-ci-result.json`。此前provider测试失败不改产品代码绕过，最终完整门须用此环境 |
| 2026-11-13 | B-197/AC-04–05 | r4 UI/终态增量review | Source clear / test timing correction | reviewer读实际源码和日志确认F07–09/F11–13源码修正；r4报告“新Ready之后旧plan才返回”超出实际测试顺序，r5只调整既有resolve用例顺序，不增加同义用例。当前未发现过度设计/过度测试 |
| 2026-11-13 | B-197/AC-01–04 | r5 F14及测试增量 | Scoped PASS / F15 pending | `final-fix-r5/changed-final.log`：Manager/crosslayer/Chat 3 suites516 tests、`source-existing-only.log`2 suites40 tests均自然exit0。两路review确认真实lexical查询与full-rebuild禁止读取、Chat旧请求后到的真实时序，不重复内容检索测试；独立生命周期review识别F15，尚不标完整通过 |
| 2026-11-13 | B-197/AC-02–03 | r6首次兼容及最终源码review | PASS | `first-use-compat/manager-suite.log`74/74、exit0；仅first-use局部owner??signal及新两参数取消用例，独立review+GPT核对F15关闭，其余已知源码finding均无剩余。未冒充完整门/app |
| 2026-11-13 | 统一gate | platform / 初次lint | PASS / corrected | platform exit0；lint首轮仅2个unused catch错误。`lint-cleanup`自然exit0，只删两个未使用绑定，无行为改动；定向eslint exit0。完整lint复跑并继续build/full Jest，原日志保留`/tmp/b197-validation/lint.log` |
| 2026-11-13 | 统一gate | lint / build类型检查 | PASS / corrected, rerun pending | `lint-2.log`完整lint exit0。`build.log`仅8处测试夹具类型错误，`build-fixtures`自然exit0，在4个测试文件补端口/构造参数/精确Promise和mock类型，无断言削弱；GPT已核对。两次重启隔离gate均因自动审批超时未执行（非不安全判定），已给出替代执行选择，不能记build或full Jest通过 |
| 2026-11-13 | 统一gate | 低并发生产构建 | PASS | Owner明确同意低并发继续；`build-2.log`自然exit0、63.7秒，含完整tsc/Tailwind/生产bundle。platform/lint输入未变复用；全组Jest随后串行执行，尚待结果 |
| 2026-11-13 | 统一gate | 首轮全组Jest | FAIL, diagnosed | `tests.log`/`jest-results.json`自然exit1，405 suites（400过/5失败），9939 tests（9931过/8失败），824.4秒。F16影响ChatService2、Ghost/resource lineage3、live-eval synthetic1；保留正确安全断言。B129第四参数断言需包含真实beforePreparation回调。无真实模型调用 |
| 2026-11-13 | 验证环境 | receipt drift超时诊断 | PASS under runner allowance | 原默认5000ms到期，无行为断言失败；该用例实际构造/验证两组构建产物并调用子进程。低并发单项重验仅将runner时限设15000ms，10031ms内通过全部drift/fail-closed断言；`receipt-timeout-recheck.json`，自然exit0。未改测试源码或产品性能标准，最终低并发gate沿用runner余量 |
| 2026-11-13 | B-197/AC-01,03,06 | F16修复与独立增量review | Scoped PASS | `canonical-projection`自然exit0；最终Manager/prompt124、carry90、Host/B129210、Chat123、tooling eval9均分批PASS（有重叠，不累加）。真实runtime preparing场景保留run-notes lineage及随后撤回正文/路径、已完成Ghost receipt；六条原安全断言未改弱。GPT与独立review确认修复关闭；需要新的完整gate/构建 |

| 2026-11-13 | B-197/AC-01–06 / 最终冻结gate | platform、lint、生产build、全组Jest | PASS | Owner批准默认受限环境低并发。`GOMAXPROCS=2 UV_THREADPOOL_SIZE=2`；platform复用exit0，`lint-3.log`45.8秒/exit0，`build-3.log`62.7秒/exit0（含tsc/Tailwind/bundle）。`npm run test:all -- --runInBand --testTimeout=15000 --json --outputFile=/tmp/b197-validation/jest-results-final.json`自然exit0、836.4秒；405/405 suites、9940/9940 tests、零失败/跳过。`tests-2.log`和`results.json`保留。其后仅文档更新，无runtime/test/config变化 |
| 2026-11-13 | 最终静态检查 | docs、diff、DOM source scan | PASS | `npm run docs:check`372 Markdown/4784 links、exit0；`git diff --check`exit0；AGENTS的runtime style/innerHTML/outerHTML扫描exit1且无输出（PASS）。移交记录修改后重跑docs/diff；不重复昂贵gate |
| 2026-11-13 | B-197/AC-01,04–05 | Linux test vault部署与部分可见操作 | PARTIAL; resume on MacBook | `make deploy-current`exit0并核对构建身份；插件reload后3.0.6，Obsidian1.15.1、目标`/mnt/code/personal-assistant/test`。实际Data/AI provider/Cost确认窗完整可见。自动鼠标首次因DPI坐标未命中；用户手动确认后真实Manager返回`answer-now`/`preparationState=running`，rebuilds=1、aborted=false、shared=false、admissions=0、provider=0，进度files2/30、chunks7/12。截图`/tmp/b197-app/desktop-{confirm,user-started}.png`。Owner要求换设备，未执行后续Status/关闭/重看/重复Prepare和完成/失败/mobile，不记PASS |
| 2026-11-13 | 移交清理 | test vault临时状态恢复 | PASS | `/tmp/b197-app/handoff-cleanup.log`：取消合成任务并awaitIdle，恢复原Manager/VSS/方法及autoStarted=true，activeRun=false、fixture=false、backup=false；原cat.md叶、原Chat会话和draftLength=0保持，mobile=false/debug=false。未修改私人vault，未调用AI provider。当前生产构建保留供后续本机使用 |

## Closeout Readiness

- [ ] Owning contract 与实际行为一致。
- [ ] 必需独立review、自动检查及测试vault证据完整。
- [x] 未完成项明确记录，不用局部通过代替完整门。
- [x] 当前执行已结束，Linux临时app夹具/模式已恢复；原始日志及截图保留作为续接证据。
- [ ] 稳定结论吸收完成；过程文档 delete-after-absorption，closeout 需另行授权。
