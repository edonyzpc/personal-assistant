# Bounded Code Cleanup Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-09-13
Work item: B-136
Authority: 此次清理的唯一执行状态、finding、验证证据和交付记录。
Product spec: [Bounded Cleanup Product Spec](../../../product/specs/pa-bounded-code-cleanup-product-spec.md)
Plan: [Delivery Plan](./plan.md)

## Current Snapshot

- Current phase: P1/P2 的实现、完整 gate、独立复审与实际 app 验收完成；用户授权后，运行时代码及测试已直接提交到 master：`76355b9c`，配套文档单独提交。
- Next action: 本次交付停止于本地 master 提交。推送、发布和文档 closeout 等待另外授权。
- Blocker / decision needed: 无待定产品取舍；技术候选不满足证据门即保留并记录，不扩范围。
- Last verified behavior: P2 真实显式发现返回 verified，活动合成笔记为 anchor，另一篇获准合成笔记为来源；来源跳转、展开、保存取消/确认、390px 移动呈现和键盘焦点均通过。原 Share Card、Chat、标签页、设置已恢复。
- Delivery tree: 隔离实现树 `/private/tmp/pa-b136-glm.H5jnqn/worktree`，branch `codex/b136-bounded-cleanup`，基线 `ec22499c`；接收目标为当前 repo checkout。规划文档已复制为只读任务快照，GPT 维护当前 checkout 的唯一 Tracker。
  唯一默认 app 目标为 repo `test/` vault；其内容不是清理对象。
- P2 delivery tree: `/private/tmp/pa-b136-glm.H5jnqn/p2-worktree`，branch `codex/b136-pagelet-retirement`；复制 P1 冻结 diff 后 913 个 tracked 输入 hash 相同，避免影响 P1 app 验收。接收时 master 为 `99e320a995d6a567c4f3870e9a249a9caea3769e`，该提交的另一任务 6 个 Share Card prototype/test 文件已保留。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-136/REQ-01 / B-136/AC-01 | C-01～C-05、C-07～C-08 的有限删除与根/兼容证据 | [x] | 两阶段 GLM 报告、实际 diff/AST 独立 review、完整 gate |
| T-02 | B-136/REQ-02 / B-136/AC-02 | C-06 旧范围控件及专用状态/CSS/i18n | [x] | 真实桌面/移动入口均无旧控件，Panel 与两个桌面 Expand 按钮保留 |
| T-03 | B-136/REQ-03 / B-136/AC-03 | Deep Discover 和旧命令/零新增调用/来源边界回归 | [x] | 旧 Open 命令隔离零调用；Quick review 显式别名、verified anchor/跨笔记来源；排除/PNG 负例与准入回归 |
| T-04 | B-136/REQ-04 / B-136/AC-04 | 保留功能的依赖/入口检查与适用回归 | [x] | 外围管理、Stats 采集/显示、Share Card/字体、Records 保留；full Jest 与定向 diff review |
| T-05 | B-136/REQ-05 / B-136/AC-05 | 共享 scope/上下文/正常保存/恢复与权限保护 | [x] | 共享服务/队列/历史/权限回归；真实来源、Detail View、正常保存取消与确认 |
| T-06 | B-136/REQ-06 / B-136/AC-06 | 有条件复用、专用资源清除和文档一致性 | [x] | 下方 S-01～S-05 disposition；生成 CSS AST、docs/DOM/diff checks |

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | Product mismatch | 旧范围 UI 可选，但实际 Deep Discover 不接收选中范围 | DEC-035 退役该 UI 及其专用链，不清退全局 scope | P2 的 T-02/T-03 | Fixed |
| F-02 | Evidence boundary | bundle 不变不能单独证明可删；独立 Worker 和类型可能受影响 | 分别核对生产根/类型/Worker/兼容 | 各删除切片 | Guard retained |
| F-03 | P2 | 草案的“全部删除项无生产入口”误覆盖已授权退役的活跃 C-06 | Plan/AC-01 明确普通死代码门与 C-06 产品退役门；仅其专用依赖随删 | 文档差异与窄边界复核 | Fixed in plan |
| F-04 | Cleanup completeness | S-01 的 `checkedThemes` 仍仅初始化/递增，没有消费 | 已在 P2 删除；主题管理功能保留 | 实际 diff 与最终完整 gate | Fixed |
| F-05 | Retained consumer | `deviceMemoryReviewQueueRepository` 在 src 只写，但 `scripts/pagelet-smoke-runner.js` 用于禁止旧 probe 修改 durable Memory | 保留字段与赋值，不改弱安全 probe 以获得删除量 | 实际 scripts 引用与 Memory reviewer 复核 | Candidate retained |
| F-06 | P2 | P2 的 review ContextPager 把被排除的 Markdown 或 PNG 活动文件误报为 used/evidence_found | 保留当前文件类型与来源准入/诚实 skipped 分类，不恢复旧范围扫描 | 68 个 focused tests、最终 full、独立复核；app 排除源 0 used/1 privacy excluded，PNG 无虚假 used source | Fixed |
| F-07 | P2 | 删除旧 Recap fixture 时误删当前 AgentInsight/Pattern 共用 timer/Ring 的三条生命周期断言 | 迁移冷却到期唤醒、Pet 销毁后取消、Ring close 恢复至活 fixture；Pattern 用于 generic hints 开关断言，保留 AgentInsight 独立准入 | R3 Bubble 23 tests/full + 独立复核；不把已取消定时器后的 destroy 调用夸称独立 live-timer destroy 测试 | Fixed |
| F-08 | Cleanup completeness | Panel 两个 Expand 字段只写；仍有已选范围/retry/高风险 adjust 文案指向旧控件 | 删除专用字段及 3 个无消费 key，保留两个真实 Expand 控件；retry/adjust 文案保留准入与消耗说明 | R3 locale 32、Panel 84、plugin 384 tests/full 与独立复核 | Fixed |

## Validation Plan

| REQ/AC 或风险 | 变化 | 最低充分证据/命令 | 通过条件 | 重跑/扩展触发 |
| --- | --- | --- | --- | --- |
| B-136/REQ-01 / B-136/AC-01 | 普通死代码/依赖删除 | 定向根与生命周期搜索；`npm test -- --runInBand <affected suites>`；阶段 `make deploy` | 无未解释活入口/兼容损失，目标 suites 确实运行且退出成功 | 新消费者、输入变化、具体回归；依赖变化加 `npm ci --dry-run` |
| B-136/REQ-02 / B-136/AC-02 | 旧 Panel 控件/状态 | pagelet-panel-tab-view、analysis-session-manager、orchestrator 相关 source tests；真实旧 Panel 入口和移动呈现 | 控件/语义/空白区域无残留，Panel 正常可用 | 交互/CSS/locale 或移动分支变化 |
| B-136/REQ-03 / B-136/AC-03 | 兼容路由和 anchor | pagelet-commands、orchestrator、agent-anchor/runtime、provider admission 相关回归；真实入口 | ID/名称/路由保留；open 零新增调用；anchor/允许与排除来源行为保持 | 命令、发送前准入、run 控制流变化 |
| B-136/REQ-04 / B-136/AC-04 | 保留功能的依赖接缝 | 入口/资源 diff；对应既有 Stats、Share Card、管理/Records suites，阶段 full Jest 复用 | 保留入口和字体/导出契约；无功能退役 diff | 真实变更触及相关运行路径时补对应 app smoke |
| B-136/REQ-05 / B-136/AC-05 | 共享服务与正常保存 | 受影响的 source-store/chat history、Pagelet source/save、Memory/VSS/Operations 相关既有回归 | 来源/历史/确认/恢复保护仍在，未新增写入或 fallback | 数据/权限/生命周期变化则停止该候选，重新评估 |
| B-136/REQ-06 / B-136/AC-06 | 复制 helper、CSS/i18n/docs | 原调用方语义回归；目标生成 CSS 比较；Pet/Bubble/Panel 实际行为；`npm run docs:check`、DOM source scan、`git diff --check` | 复制与隐私语义相同，当前动画保护保留，文档不再承诺旧控制 | helper 输入/输出、样式扫描/产物、契约变化 |

上表中的 suites 为按改动选择的入口，执行时核对真实文件名及 source/tooling/artifact
分组；不要求每行各跑一次全量测试。每阶段冻结输入后只安排一个完整 gate，遵守 Plan
的部署/证据复用规则。当前 docs-only 先执行 docs checker 和现有 docs contract suites。

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-13 | B-136/REQ-01 / B-136/AC-01 | 会话中虚拟删除 3 个孤立模块 | source 类型通过，production bundle SHA 与基线一致 | 研究证据：append/selection provider、BackgroundPreparationCoordinator；未执行 Jest/app，不代表工程 AC 完成 |
| 2026-09-13 | B-136/REQ-01 / B-136/AC-01 | 会话中两组独立 source/type/build 消融 | 约 2,500 行候选可裁剪；两组 main.js 分别减少 14,786 / 1,684 bytes | `ec22499c` 生产源码基线；组间不直接相加作为收益承诺，尚有 unused 接线需要正式清理；原始输出在本次分析会话，无独立日志文件 |
| 2026-09-13 | B-136/REQ-01 / B-136/AC-01 | 删除活跃 PageletHost 类型模块的负对照 | bundle 一致，但 76 个语义错误 | 证明仅看 bundle 不足；Worker 入口另查，不将本实验记为 PASS |
| 2026-09-13 | B-136/REQ-02 / B-136/AC-02 / B-136/REQ-03 / B-136/AC-03 / B-136/REQ-05 / B-136/AC-05 | Pagelet reviewer 只读复核 | 确认窄 UI 退役边界；补全 open-panel、全局排除、跨笔记和历史内容保护 | 方案 review；生产代码未变，运行时门尚未执行 |
| 2026-09-13 | B-136/REQ-06 / B-136/AC-06 | `npm run docs:check`；`git diff --check` | PASS；首次缺 Product 索引已补齐 | 4 条精确匹配的既有 episodic-memory 架构索引/可达性告警仍为 advisory；未扩大此次清理 |
| 2026-09-13 | B-136/REQ-06 / B-136/AC-06 | `npm run test:docs -- --runInBand` | PASS，2 suites / 58 tests，自然退出 0 | checker/skill contract 验证；后续只改说明及日志，不改变这两个 suite 的输入；不代表 runtime AC 完成 |
| 2026-09-13 | B-136/REQ-01 / B-136/AC-01 / B-136/REQ-06 / B-136/AC-06 | `npm ci --dry-run --cache <owned run>/npm-cache` | PASS，自然退出 0，607 packages planned | worker 在只读共享 node_modules 内预演遇 EPERM；GPT 在独立空目录复制同一 package/lock/安全 repo .npmrc 后完成真实 npm 预演，不改共享依赖。输入 SHA 记录于 `npm-dry-run-inputs.json`，原始证据 `npm-dry-run-r2.log`；最终输入 hash 未变化才复用。首次空目录准备失败不计为证据 |
| 2026-09-13 | B-136/REQ-04 / B-136/AC-04 / B-136/REQ-05 / B-136/AC-05 | P1 Memory/Chat 独立实际 diff + AST review | 无 P0/P1/P2；24 个保留函数体与 ec22499c 相同 | SourceRecord 浅拷贝复用不合并 context 隐私差异；URL/HTML/截断、父取消/超时/监听器、VSS 读取失败断言保留或迁移。Type C 内存 viewer、Type A 治理及 weekly 历史设置保持；review 不替代 app gate |
| 2026-09-13 | B-136/REQ-04 / B-136/AC-04 / B-136/REQ-06 / B-136/AC-06 | P1 surfaces 独立 diff + 生成 CSS AST 比较 | 无 P0/P1/P2；仅删旧 mascot/anim 专用规则 | 其它 1,632 个 selector 实例的顺序、at-rule 上下文和声明相同；Pet/Bubble/Action Ring/reduced-motion 保留。当前 CSS SHA `c12d45c1a04f5fc5a3770d205fcb3acc26e1c02a8c217f719a3a721a9f9febdb`，基线/产物均保留于运行目录；两处旧 CSS 文档路径在接收树已修正 |
| 2026-09-13 | B-136/REQ-01 / B-136/AC-01 / B-136/REQ-04 / B-136/AC-04 / B-136/REQ-05 / B-136/AC-05 / B-136/REQ-06 / B-136/AC-06 | P1 `make bin` + DOM scan + notice/diff checks | PASS，自然退出 0，271 suites / 7,535 tests；platform guards 391 files、lint、生产 build 通过 | 原始 `p1-r2.stdout.log` 的 gate completion 及 `p1/make-bin.log` 已核对；首轮未用 type import 的 lint 错误修复后重跑。最终 main.js SHA `5c2028c95d3d8ed6998bccc9b0784a02c6f0ac84fdc5bdbb0da760cecff427b7`；913 个 tracked source/test/tooling/asset 输入记录于 `p1/gpt-accepted-source-inputs.json`，最终 gate 后无生产输入写入。npm 预演的 package/lock/.npmrc hash 均与最终输入相同；app 尚待验收 |
| 2026-09-13 | B-136/REQ-04 / B-136/AC-04 / B-136/REQ-05 / B-136/AC-05 / B-136/REQ-06 / B-136/AC-06 | P1 eligible `make deploy-current` + Obsidian 1.13.7 实际窗口验收 | PASS；loaded SHA 与 P1 build 一致；fresh errors 为空 | Pet 实际点击打开 Capture/Review/Discover/Share Action Ring；Bubble 可见，Chat 历史在 reload 后保留。真实 Quick review 旧别名走现行 Deep Discover（非零调用命令），以 `pa-inline-font-smoke-20260913.md` 为 anchor 得到 `pa-share-menu-smoke-20260913.md` 来源，展开并实际跳转后返回原笔记。1 个当前 Pet、0 旧 mascot；Statistics/preview/targetPath 设置原值保持；debug/mobile 已关闭。来源均为现有明确合成 fixture；无笔记编辑/确认写入。原始证据 `p1/app-reload-and-debug.json`、`p1/app-final-runtime.json` 与本会话可见交互；reduced-motion 用生成 CSS AST/现有测试证据，没有声称开启 OS 辅助功能或真机验证 |
| 2026-09-13 | B-136/REQ-01 / B-136/AC-01 / B-136/REQ-02 / B-136/AC-02 / B-136/REQ-05 / B-136/AC-05 / B-136/REQ-06 / B-136/AC-06 | P2 R1 `make bin` + 3 个独立风险方向 review | 完整 gate PASS，269 suites / 7,372 tests；阶段未接受 | F-06/F-07 必须修复。生成 CSS 仅删旧范围 28 个 selector/context 键，其余 1,602 个实例同序/同声明；当前命令名称/ID、Deep Discover 核心、共享服务/预算/队列和正常保存保留。R1 原始日志 `p2/make-bin.log`；R2 任务 `p2-task-r2.md`，不把 R1 绿灯当作最终验收 |

## Final Acceptance And Conditional Candidates

- C-01～C-08 按 Plan 的普通死代码门或 C-06 产品退役门完成；没有把 bundle
  未变化单独作为删除依据。测试仅删除退役行为专用断言，迁移仍有效的来源、取消、
  生命周期与兼容断言；F-07 的共用 Bubble 保护已补回。
- S-01：无消费数组/计数/props 已删除，包括 P2 收尾的 `checkedThemes`；
  `deviceMemoryReviewQueueRepository` 因真实安全 probe 消费而保留（F-05）。
- S-02：只把三处完全相同的 SourceRecord 浅拷贝复用为现有模块 helper；不同
  context clone 的隐私裁剪未合并。
- S-03：不可达 Type C 文件写入和无效 weekly pass-through 已删；Type C 内存
  分析/viewer、Type A/proposal、持久化设置及历史兼容保持。
- S-04：只删除直接 `@langchain/textsplitters` 依赖、对应 lock/notice 条目；
  没有换库、升级依赖或改动共享 node_modules。
- S-05：只删旧准备链专用实例和无生产写入的 pending-summary 分支；正常 findings
  保存、ScopeResolver、前台预算、共享 Quiet Recall/Scope Recap 和队列保留。
- SuggestionCard/ResearchManager/draft、公有 VSS 兼容和 Records 合并未扩大实施；
  大类拆分仍归 B-105，Statistics 历史整理仍归 B-110。B-122 的 future adapter
  边界已同步，不能继续假定已退役的 preload producer 正在运行。

### Final Evidence

证据根目录：`/private/tmp/pa-b136-glm.H5jnqn`。所有 PASS 绑定下述具体输入，
不是只绑定 HEAD；主 checkout 的另一任务六个 prototype/test 文件保留。

| Check | Result and input | Original evidence / limits |
| --- | --- | --- |
| GLM P2 R3 最终 `make bin` | 自然退出 0；269 suites / 7,377 tests；platform guards 387 files、lint、生产 build 通过 | `p2/r3/make-bin.log`、`p2/r3/report.md`；两次新测试 mock 类型失败记录保留，修复局限于 mock cast |
| 定时器诊断补充 | `npm test -- --runInBand --detectOpenHandles __tests__/pagelet-bubble-coordinator.test.ts __tests__/pagelet-orchestrator.test.ts`，2 suites / 91 tests，自然退出 0，无 open-handle 告警 | `p2/r3/gpt-open-handle-check.log`；full gate 的一秒提示如实保留，未使用 forceExit |
| 独立最终 review | F-06/F-07/F-08 已关闭；无剩余 P0/P1/P2 | Pagelet、Memory/Chat、surfaces 三个 reviewer；当前命令/核心准入/共享状态和正常保存保留；CSS 除 28 个旧 scope selector/context 键外，其余 1,602 个实例同序同声明 |
| 接收与组合验证 | worker 914 项输入 hash 与主 checkout 逐项相同；另一任务新增 prototype source suite 22 tests、TypeScript 均自然退出 0 | `p2/gpt-final-inputs.json`、`receipt.json`、`p2/integrated-prototype-test.log`、`p2/integrated-typecheck.log`；不把“269 全套 + 单独 22 tests”声称为又跑过 270 套全量 |
| 主 checkout build | 自然退出 0；main.js / CSS 与已 app 验证的 P2 完全一致，当前 production provenance blockers 为空 | `p2/integrated-build.log`、`p2/integrated-build-identity.json`；最初直接复用 worker provenance 因主树多 `src/.DS_Store` 及接收时间戳不适用，未删除该无关文件或伪造凭据，重新正常 build |
| 实际旧入口与负例 | 自动发现临时暂停后，真实 Open Pagelet 命令 0 host discovery calls、0 旧控件；被排除 Markdown 显示 0 used / 1 privacy excluded；PNG 不生成 used outcome | `p2/app/open-panel-isolated.json`、`excluded-note.json`、`nonmarkdown*.json`；此前计数出现的是既有 `open-changed-note` 路径，不宣称其为显式调用或物理 provider 次数 |
| 实际发现/来源/展开 | 显式 Current note 返回 verified，以 `pa-inline-font-smoke-20260913.md` 为 anchor，获准 `pa-share-menu-smoke-20260913.md` 为另一来源；真实来源跳转、Detail View Expand、Quick review 别名通过 | `p2/app/verified-and-expand.json`、本会话 AX/UI 交互；配置 route `qwen` / model `deepseek-v4-pro`，不据此猜测服务端实际型号。首次运行未保留返回状态，不计成功；补只读结果记录后获得 verified，Memory 提示选择 Answer now，无额外索引准备 |
| 正常 Review 保存 | 预览显示本地目标/来源不修改；取消后零文件，确认后生成 1,499 bytes 笔记，含两篇来源与 finding metadata；无新增发现调用 | `p2/app/reviews-before-save.json`、`save-result.json`、本会话真实确认/取消交互；Operations 保持禁用，未确认来源编辑 |
| 移动/键盘/恢复 | 390×844 移动模拟，Panel 宽 390 且无横向溢出、0 checkbox/旧 scope；键盘操作来源并 Tab 到主按钮，实际关闭成功；恢复 desktop/dark/原五个 Markdown leaf、Chat、活动合成笔记选区和原 Share Card modal | `p2/app/mobile-layout-focus.json`、`mobile-final.png`、`final-runtime.json`、`provider-and-restoration.json`；不是 iOS 真机证明。mobile/debug 已关闭、自动发现/contextPager 原值 true、临时排除与探针不存在；fresh errors 为空 |
| 最终 docs / DOM / 差异检查 | docs checker PASS，仅原有 4 条 advisory；docs contracts 2 suites / 58 tests 自然退出 0；diff check 退出 0、DOM scan 无匹配退出 1（按门禁为 PASS） | `p2/final-docs-check.log`、`final-docs-tests.log`、`final-source-checks.json`；914 项最终源码/测试/配置输入仍一致，staged diff 为空 |

最终 main.js SHA：`fa13bae5bc4ee557b3c7a209efb12aff5d3108a81c0a0094dcdfd465118e8668`。
最终 CSS SHA：`95bae6d65728e0801f9bda3cabe68612abc9c800b8c70665e700663c4d1a3536`。
主工作区重建产物与部署/加载产物一致，无需为同一字节再次重跑 app。

## Closeout Readiness

- [x] Owning contract 与清理后的实际行为一致。
- [x] 两阶段 required tests/review/app evidence 已按当前输入记录。
- [x] S-01～S-05 及范围外事项有明确执行/保留理由，相关 Backlog 已对齐。
- [x] 稳定结论已吸收到 current contract/tests。
- [ ] 过程文件默认 delete-after-absorption；独有消融证据仅在仍有当前引用时保留紧凑归档。

## Runtime Resources And Preflight

- 本任务运行目录：`/private/tmp/pa-b136-glm.H5jnqn`，含待创建的 scratch、隔离树、任务输入与原始证据；验收前保留。
- 本机 Codex CLI `0.142.2`；Node `v22.22.2` / npm `10.9.7`。
- 非秘密配置：独立 `pa-glm` profile，ZAI / `https://open.bigmodel.cn/api/v1` / Responses，请求 `glm-5.3`、reasoning `max`；服务端实际型号尚无独立证据。
- repo 与安装 catalog SHA-256 相同：`fb01a21d7b5e06b6864fa973ca9c48199b5ba35cf03af95d436edf4e369ddabe`。不读取或复制密钥。
- 首次无工具预检发现 `--ignore-user-config` 也使 profile provider 不可用（`Model provider ZAI not found`，退出 1，未调用模型）。改为正常 profile 加显式 model/provider/reasoning，并逐个禁用当前配置中的无关 MCP/plugins；未修改稳定配置，仍保留 worker sandbox。具体非秘密参数见运行目录 `run-glm.py` 与各 invocation JSON。
- Obsidian CLI 在外层 sandbox 内退出 134；相同只读命令经标准提权后通过，确认当前 test vault 为 `/Users/eddie/code/personal-assistant/test`，插件 `2.9.2` enabled。这不是新构建的运行时验收。
- 无关 worktree `pa-share-glm.BdZ9WL`、`pa-xerox-glm.YobzC0` 不属于本任务，不修改或清理。
- 预检通过：`auth-r2` CLI header 证明请求 route 为 ZAI/glm-5.3/max，read-only 工具读取预置 challenge；scratch 写入 3 个文件，Node 正向测试退出 0、负对照真实 assertion 失败退出 1。CLI 三次任务均自然退出 0；原始事件、调用参数与结果位于上述运行目录。
- P1 R1：任务 `p1-task.md`，原始事件 `p1-r1.stdout.log`、stderr `p1-r1.stderr.log`；worker 获派 C-01～C-05/S-01～S-04、focused/full gate 和定向 test 插件部署。GPT 负责实际窗口操作，worker 不获桌面工具或自验收权。
- 共享 app 调度修订：任务“增强分享卡片导出样式”确认优先完成 test vault/UI 验收，且只接收 prototype scripts/test，不改生产 src。GPT 在 R1 未运行 gate/deploy 时停止其 CLI（SIGINT，最终 exit 1，最后命令已结束），保留已写删除和全部日志；R2 从实际 diff 继续，不重复预检。R2 完整 gate 为 `make bin`，禁止部署/app；交接后由 GPT 在相同输入/build 上执行 eligible `make deploy-current`。此调整不减少任何阶段 gate。
- R2 任务 `p1-task-r2.md` 补入实际未完成项、精确重复字段名和格式化命令校正；原始事件 `p1-r2.stdout.log`。R1 中断记录为 `p1-r1-interruption.json`，不计为交付 PASS。
- app 等待调度修订：另一任务报告其临时交接协调被自动审批拒绝，交接未执行；本任务未部署/reload/操作该窗口。P1 源码/build 独立冻结，在另一个树推进已获授权的 P2 代码；P1、P2 的实际 app gate 及阶段完成仍按序执行，不减少验收条件。若 P1 app 暴露新问题，同步修复并失效对应 P2 证据。
- P2 资源与派工：`p2-resources.json`、`p2-documents.json` 记录第二棵树、共享依赖链接与 16 份只读文档快照。R1 已自然退出 0；R2 修复任务在执行 72 条 command/file 事件后遇 GLM 5 小时限额退出 1，保留已写的 orchestrator/两个测试文件。最初把额度错误误解为启动即失败已在会话中更正；完整事件与 hash 证明确有部分修改。用户明确确认额度已重置并要求继续原分工，R3 用修订任务 `p2-task-r3.md` 接续，无模型替换，日志 `p2-r3.stdout.log`、证据 `p2/r3/`。
- R2 的两个 ContextPager 红灯在 Jest 输出中真实失败，但首个 zsh wrapper 误用 Bash PIPESTATUS，外层错误返回 0；不将其伪称自然失败退出。后续又纠正只读 `status` 变量，最终 focused 命令用 `rc` 真实退出 0。此类 wrapper 诊断不替代 R3 最终 gate。
- 资源清单 `owned-resources.json` 记录 node_modules 只读共享链接与准确部署链接；`initial-documents.json` 记录 10 份文档快照 hash。原视图/非秘密设置记录于 `app-before.json`，交付前不清理证据。
- 验收后清理已完成：`p2/app-fixture-cleanup.json` 记录按 SHA 核对移除的 4 个自建
  fixture/Review 文件；保留 `.pagelet` 目录和原合成来源笔记。`cleanup.json` 记录删除
  scratch、独立 npm 预演目录/cache，以及两棵树的自建 node_modules/部署软链接；
  共享 node_modules 和实际 test 插件目录未清理，最终部署继续可用。
- 两棵隔离 worktree 因含已接收但未提交的源码及任务快照而保留；不 force-remove、
  reset/clean 或制造提交来获得干净状态。原始 review/gate/app 证据继续保留于上述
  运行目录，便于核对失败与最终 PASS。主 checkout 的实现、文档和原型提交均保全；
  实施验收阶段没有 stage/commit；后续用户明确授权将代码提交到 master，运行时提交
  为 `76355b9c`，文档按意图另提交。提交前重新核对 914 项输入与既有验证证据一致，
  未扩大测试范围或重复 app 操作。没有 push、tag、release 或执行 closeout。
