# Quality-first Test Reduction Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-09-26
Work item: B-151
Authority: 本轮唯一执行状态、候选裁决与验证记录。
Governance contract: [GOV-005](../../governance/gov-005-quality-first-test-reduction.md)

## Current Snapshot

- Current phase: 本轮实施、完整门禁与独立验收完成；5 个测试文件净减 11 例，覆盖率零下降。
- Next action: 按 Owner 于 2026-09-26 的明确要求将本轮修改签名提交并推送至远程 `master`；文档收尾另行处理。
- Blocker / decision needed: 无；20% 不作承诺，证据不足的候选保留。
- Last verified behavior: `master` / `c3c37e07ed3fa277594793a35cc1b662858a3bb5`，初始工作区干净。
  B-150 最终 888 个 source/tests/fixtures/config/dependency 输入哈希全部匹配；Node
  v22.22.2、原 node_modules 安装路径一致，原始结果与 coverage 文件哈希匹配。
  复用 328 suites / 8276 tests 基线，不为计时重复运行。原证据见
  [B-150 validation](../../../archive/2026/b150-test-audit/evidence/validation.json)。
- Temporary resources: `/private/tmp/pa-b151-n8k0qx5a/evidence` 保存输入身份、命令与原始结果；
  当前 workspace 是交付树；不使用 GLM、不部署、不操作真实 provider/vault。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-151/REQ-01 / B-151/AC-01 | Receipt 相同场景合并 | [x] | C-01/C-02，199/199 PASS，audit_design_review 独立复核通过 |
| T-02 | B-151/REQ-01 / B-151/AC-01 | Template/Capture 承接与条件候选 | [x] | C-03/C-04，28+1 focused PASS，root 非作者复核通过；C-05 保留 |
| T-03 | B-151/REQ-01 / B-151/AC-01 | Settings/Panel 承接与条件候选 | [x] | C-06/C-07，309/309 PASS，root 非作者复核通过；C-08 保留 |
| T-04 | B-151/REQ-02 / B-151/AC-02 | 冻结、完整 coverage 与范围核对 | [x] | 328/8265 PASS；436 路径、原始计数/分母/覆盖位置全部不变 |
| T-05 | B-151/REQ-03 / B-151/AC-03 | 独立验收、文档与资源核对 | [x] | audit_design_review 独立重算原始结果通过；docs 与 58 个文档契约通过；原始证据保留 |

## Candidate Decisions

以下裁决已完成定向验证与非作者复核，总体接受仍以完整门禁为准。

| ID | Candidate / owner | Retained protection / decision basis | Net reduction | State |
| --- | --- | --- | --- | --- |
| C-01 | receipt verifier 三个 strict-v9 正常 fixture 执行；`inspectAppReceipt` | 同输入路径合并到首个完整 PASS，保留 profile/compactProxy 与 externalMemory 精确结果 | 2 | Focused/review PASS |
| C-02 | receipt verifier 两个 compact 正常 fixture 执行 | 保留完整 CANDIDATE 与仅 owner disposition blocker 的精确列表，strict/compact 仍独立 | 1 | Focused/review PASS |
| C-03 | note-template 重复 title / 日期 padding；`renderNoteTemplate` / `buildNoteTemplateContext` | 自定义模板中两次 title 与 created/modified 不同日期完整结果承接 | 2 | Focused/review PASS |
| C-04 | Quick Capture service 重复 getter | 保留同 harness 的 Pagelet teardown 前后 service identity 及其他服务生命周期保护 | 1 | Focused/review PASS |
| C-05 | quick-capture Markdown 单 heading / fence 参数 | 独立 H1/无末尾换行与 composite H3/有末尾换行、原文件状态不同，仍有边界价值；不做为减量服务的变异 | 0 | 保留两例，文件未改 |
| C-06 | settings 三次 mobile display 与两行相同 count 规则 | 保留 rows > 10；加载设置使用真实 normalize，保留 undefined/"99" 行及其他边界 | 4 | Focused/review PASS |
| C-07 | Panel icon SVG 细节 | 先验证同 ID 注册、SVG 根标签与绘图元素，再移除精确坐标/颜色/描边匹配；不声称浏览器解析或视觉验证 | 1 | Focused/review PASS |
| C-08 | settings source-literal rebuild 分类 | 尚无动态重建分类的行为替代，保留 | 0 | 保留 |

具体承接测试（名称为稳定查找入口，均在同一文件）：

- `retrieval-evidence-receipt-verify.test.ts`：`does not reinterpret a strict v9 receipt...`
  与 `accepts a desktop receipt without an external memory binding` 由
  `passes a strict v9 fixture with a compact manifest plan and no external memory binding without claiming live currentness`
  承接；`does not require unavailable process-memory or heap diagnostics for compact readiness`
  由 `keeps a machine-complete compact proxy CANDIDATE blocked only on owner disposition` 承接。
  保留 exact externalMemory 对象、空 failures/integrityErrors 和仅一项 blocker。
- `note-template.test.ts`：`replaces multiple occurrences of the same placeholder` →
  `uses custom template when provided`；`pads single-digit months and days` →
  `maps creation and modification times independently for an existing file`。
  同创建时间及 date/aliases 断言保持原文；默认 modify 仍由 `formats date and time correctly` 保护。
- `plugin-record-note.test.ts`：`reuses one service so separate modals share the same append queue`
  → `keeps the shared service when Pagelet runtime is torn down`；真实 `getService()`
  前后 identity 精确相同，Pagelet session dispose 与其他 service 不销毁断言保留。
- `settings.test.ts`：两个弱 mobile display 测试 →
  `settings display produces expected number of setting rows on mobile`；原 `getLeaf("window")`
  标题只检查 rows > 0，没有窗口调用保护，不能声称删除了已存在的窗口路由验证。
  direct normalizer 的 undefined/"99" 两行 → `normalizes loaded featured image count %p to %p`
  的相同两行；`mergeLoadedSettings` 无条件调用真实 normalizer，不由 mock 提供结果。
- `pagelet-panel-tab-view.test.ts`：`registers a quiet compound Pagelet detail tab icon` →
  `exposes Pagelet detail as a native Obsidian item view`；注册 mock 在构造前清空，不能由
  前一测试的调用充当证据。原 native view、payload 与空状态断言保留。

root 编写 receipt 测试，由 audit_design_review 复核；capture_audit 编写模板/服务，
memory_audit 编写设置/图标，均由 root 非作者复核。对照实际 diff、生产 owner 与原始
focused 结果后无保护丢失 findings。回执与图标测试均未形成宿主/视觉验证主张。

## Evidence Plan

| Risk / AC | Change | Minimum evidence | Pass condition | Rerun / expansion trigger |
| --- | --- | --- | --- | --- |
| B-151/AC-01；receipt 结果漏字段/错误接受 | C-01/C-02 | tooling receipt suite；非作者对旧/新断言逐项核对 | 199 个用例自然通过，新增承接断言不弱于原断言 | fixture/结果结构/CLI 输入变化 |
| B-151/AC-01；模板内容或服务生命周期漏保护 | C-03/C-04 | note-template 与 plugin-record-note 的 Quick Capture service lifecycle；非作者复核 | 保留具体文本与同一 service identity 的完整验证 | 模板/服务 fixture 或 teardown 行为变化 |
| B-151/AC-01；原文损坏 | C-05 | 同路径证明与必要的 GOV-004 隔离反证；不足则保留 | 正常绿、目标损坏红、精确恢复绿 | 目标路径不等价或反证不针对目标 |
| B-151/AC-01；设置入口/图标接线丢失 | C-06/C-07 | settings、panel-tab suites；非作者复核 | 真正调用生产 normalize；mobile 构造有效；同 ID 注册受保护 | stub/初始化/注册断言变化 |
| B-151/AC-02 / B-151/AC-03 | 全部冻结修改 | lint → build → `npm run test:all -- --runInBand --coverage --watchman=false`；docs、diff | 自然退出 0；发现集合与原始 coverage 范围一致，四项各下降 ≤ 2pp | 输入漂移、失败或无法解释的分母/保护损失 |

只回滚本轮候选的局部修改；不清空工作树或覆盖无关改动。任何需生产修复的发现单列，
不靠放宽断言/增加 timeout/skip/forceExit 取得通过。scripts 被 coverage 排除，CLI
保护必须独立复核，不能用总覆盖率替代。

## Findings

无未处置的 P0/P1/P2 findings；C-05/C-08 已裁决保留，不作为实施遗留承诺。

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-26 | B-151/REQ-02 / B-151/AC-02 | 888 个运行输入与原始报告哈希、Node/依赖安装身份 | 一致；复用基线 | `baseline-inputs.json` / `baseline-reuse.json`；文档更新不改变运行基线 |
| 2026-09-26 | B-151/AC-01 | receipt tooling suite | 199/199 PASS，自然退出 0，输入无漂移 | `receipt-focused*.json/log`；独立复核通过 |
| 2026-09-26 | B-151/AC-01 | note-template 全组、Quick Capture service lifecycle 子组 | 28+1 PASS，均自然退出 0，497 输入无漂移 | `capture-template*` / `capture-lifecycle*`；plugin 的其他 407 例由命令过滤，留到完整门禁，未加 skip |
| 2026-09-26 | B-151/AC-01 | settings + panel-tab source suites | 2 suites / 309 tests PASS，无跳过，自然退出 0，566 输入无漂移 | `settings-focused*`；图标承接用例在删旧例前已单独通过 |
| 2026-09-26 | B-151/AC-03 | 文档初检、diff check | 239 Markdown / 2846 links PASS；4 项既有架构索引提示 | 完整门禁后复核最终文档；未增加新错误 |
| 2026-09-26 | B-151/AC-02 / B-151/AC-03 | 冻结后的 lint / production build / test:all coverage / docs / diff | 全部自然退出 0；328/328 suites、8265/8265 cases，0 failed/pending/todo；覆盖率阶段 1465.555s | [验证摘要](./evidence/validation.json)；1228 个冻结输入与构建产物在门禁中均无漂移 |
| 2026-09-26 | B-151/AC-02 | 完整原始计数、统计路径及逐位置比较 | 436 路径不变；行/语句、函数、分支的计数与分母全部相同，变化均为 0pp；无 lost/gained/map 位置变化 | [Coverage 对比](./evidence/coverage-comparison.json)；不是仅比较格式化百分比 |
| 2026-09-26 | B-151/REQ-02 / B-151/AC-02 | 运行输入集合补充核对 | 扩展集合 981 项，无新增/遗漏，内容仅 5 个获准测试文件改变 | 原清单外 93 项中 75 项已有 B-150 文档哈希，另 18 项通过两端 Git blob、当前字节与 B-150 全 tracked diff 清理记录补核；不改写原冻结清单 |
| 2026-09-26 | B-151/AC-01 / B-151/AC-02 / B-151/AC-03 | 最终非作者原始证据复核 | audit_design_review 独立重算原始报告后通过，无阻塞 | 数量、完整 case 差异、全部覆盖位置、981 输入与构建产物一致；无全仓逐例/性能/宿主主张 |
| 2026-09-26 | B-151/AC-03 | 最终记录的 docs / test:docs / diff | 文档 239 files / 2848 links PASS，2 suites / 58 tests PASS，自然退出 0；仅 4 项既有提示 | gate 后仅 Tracker 与证据记录更新，不改变 runtime 或验收规则 |

## Final Result

本轮实际净减 **11 / 8276 = 0.1329%**，最终 **328 suites / 8265 tests**。
完整用例名称多重集合仅显示 5 个预期文件变化；receipt 主例改名计作一增一减，
不把改名计算为删减。未减少 suite、未改发现配置、未新增跳过。

| Metric | Baseline and final raw count | Exact percentage (rounded here) | Delta |
| --- | --- | --- | --- |
| Lines / statements | 167726 / 184006 | 91.152462% | 0pp |
| Functions | 8445 / 9926 | 85.079589% | 0pp |
| Branches | 44075 / 53496 | 82.389338% | 0pp |

比较按原始分数交叉相乘判断 2pp；表内展示舍入不参与验收。Jest 的截断显示值与此表
四舍五入值可能不同。统计集合仍为 420 个 src 与 16 个配置/文本文件。
本轮未调用 GLM、修改生产/配置/依赖或部署；没有 Obsidian/设备验证或稳定提速主张。
以上为 Git 交付前的验收结果；Owner 随后已明确授权提交并推送远程 `master`。
C-05/C-08 的保留是质量裁决，不是为达 20% 而必须完成的遗留删项。

## Closeout Readiness

- [x] 候选承接、非作者复核与完整门禁完成。
- [x] 实际减少量、保留候选、证据限制与稳定结论对齐。
- [ ] Owner 授权收尾后再吸收证据与处置过程文件；Git 交付授权不改变本项状态。

所有测试/构建/诊断进程均已自然退出，无本轮隔离 worktree 或 app 状态待恢复。
原始报告及输入哈希位于前述临时目录，保留用于复核；共享依赖、当前构建与
交付文件保留。采样仅定位当时的 V8 coverage 计算，不构成性能改进的测量证据。
