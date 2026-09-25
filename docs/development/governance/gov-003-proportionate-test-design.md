# GOV-003 — Proportionate Test Design

Document status: Current
Governance ID: GOV-003
Updated: 2026-09-25
Work item: B-142
Authority: 测试精简与执行优化的设计约束；不改变 PA runtime、用户行为或 GOV-002 发布资格。

Bootstrap source: Owner 于 2026-09-19 要求调查发布测试耗时与重复覆盖，随后要求复核
待讨论问题、制定设计并完成 B-142。本契约本身不授予代码实施、外部源码传输、Git
或发布权限；B-142 于 2026-09-19 验收并获准 closeout，长期规则与终态证据保留在本文。

## Context And Selected Governance Choice

采用现有 Jest 和 source/tooling/artifacts 分组，先精简明确冗余与夹具成本，再以
有界实验决定是否适合并行。质量依据是可捕获的真实回归，不是 case 数量；不设
删除比例或尚无证据的加速目标。纯逻辑负责规则矩阵，接缝负责传播与副作用，真实
集成负责文件/CLI/构建身份，实机负责宿主能力和交互。

[GOV-002](./gov-002-master-first-branch-and-beta-packaging.md) 的 build-before-full-test、
完整 coverage、beta exact-master CI 复用与最终 tag 独立验证继续生效。

## Requirements

- B-142/REQ-01: 删除行为或发布保护测试须列出等价的保留用例或测试内自证的依据；
  仅匹配 UI 样式源码字面的测试可按视觉验证边界移除，无须逐项补写同类断言。
  正常行为、实际临界点、不同失败原因和关键时序不得因结果同为拒绝而合并。
- B-142/REQ-02: 为规则选择主要 owner suite；跨层只保留独立接线或故障价值。
  参数化仅减少维护重复，不能宣称减少执行量；测试标题不得超出实际断言。
- B-142/REQ-03: 框架/分组调整保持完整发现集合；CLI、真实文件/Git、签名/重放和
  production bundle 身份的代表性集成证据保留。缓存只限不可变输入或编译结果，
  不共用可变 VM、结果、文件树、时钟、receipt 或恢复状态。
- B-142/REQ-04: 提速只用相同输入、环境与 coverage 模式的配对证据判断；变更后的
  完整验证可兼作基线，不为计时例行多跑全量。并行无可靠收益或存在串扰时保留串行。
- B-142/REQ-05: 保持现有测试门禁、coverage 分母/阈值、最终 tag 与适用实机要求；
  不使用 skip、forceExit、提高 timeout 或修改正确预期获取通过。门禁调整不在本轮范围。
- B-142/REQ-06: 分片先 focused，冻结输入后集中完整验证并复用有效证据；实现/验收
  按 GPT-6/GLM 流程分工，不为每个删项增加全量回归或独立治理台账。

## Non-goals

- 不修改 `src/` 产品逻辑、样式、笔记、设置、vault 或已发布版本；不部署插件。
- 不迁移 Jest、升级依赖、启用分片覆盖率汇总、创建通用测试平台或长期测量服务。
- 不开展全仓固定比例删减；首批候选和重型 harness 的边界见 SDD。
- 不改变 coverage 频率/工具、结果复用政策或 release source；外部源码传输仍须任务级
  明确授权。

## Acceptance Criteria

- B-142/AC-01: 每个实际删除/合并项有简短依据；行为与发布保护项有保留断言。
  无仅凭文件名/行数的删除，首批候选 focused suites 通过，取消/权限/持久化等
  独立风险保留。
- B-142/AC-02: 相关输入只构造必要次数，标题与实际结果一致；不同前置状态、迁移
  优先级和事件维度仍明确可诊断，不以一条复杂测试吞并无关行为。
- B-142/AC-03: 准备成本优化前后结果一致；可变场景独立且自然清理；完整发现与分组
  契约通过；真实 CLI 的 PASS/FAIL/BLOCKED、文件/身份拒绝等接缝仍由真实执行证明。
- B-142/AC-04: 记录同环境配对结果和局限；测试集合/断言不变的优化才归因到执行
  改造；有界并行完成评估并明确采用或保留串行，不能宣称未实测的 CI 收益。
- B-142/AC-05: 最终所选执行配置覆盖全部预期 suites，保持原 coverage 门槛，
  lint/build/完整 tests/diff 通过；release 工具与分组受影响时其契约同步通过。
- B-142/AC-06: closeout 前的执行记录保存检查输入、命令、结果/自然退出、复用与
  失效触发；检查和资源清理不重复、不吞失败。长期规则和必要终态证据吸收到当前
  契约或 focused tests，不保留已完成的过程状态。

## Delivered Outcome And Evidence

B-142 在不修改 `src/`、依赖、Jest 分组、coverage 阈值、CI、Makefile 或 release
调用点的前提下完成：

- 删除 12 个重复或测试内自证的执行：字体数学自证 4 个、重复 settings/Recap 7 个、
  一次性 B-136 源码符号黑名单 1 个。实际 CSS、settings truth table、单来源与 callback、
  `openPanel()` 不触发 provider 以及 abort/dispose/source revoke 三类竞态仍有保护。
- runner 编译缓存、receipt fixture 预建与 FTS 身份缓存因收益低于波动，或复杂度与
  隔离风险不相称而未采用；真实进程、签名、challenge、replay 与 build identity 保留。
- 冻结最终输入的 lint、production build、分组契约和完整 coverage 门禁通过：
  291/291 suites、7748/7748 cases；statements/lines 89.8715%、branches 81.681%、
  functions 87.469%。
- 同一输入的本机二 worker 运行与串行 suite、case、snapshot、coverage 完全一致，
  elapsed 496.786s → 204.177s；因没有对应 CI runner 与完整聚合内存证据，保留
  `--runInBand` 默认，不宣称 CI 提速。后续采用并行须建立新的同环境 runner 证据。

## 2026-09-25 Follow-up

Owner 要求按最小必要原则继续精简 UI 单测与 branch-switch 测试。本轮主要删除只匹配
`src/custom.pcss` 样式字面值的断言；它们不能证明 Obsidian 中的实际布局、触控面积或
可见状态。另删除一项仅排除中文标签的弱断言；Bubble content owner suite 已精确
验证英文 `View`、`Later`、`Dismiss` 标签及回调。保留 DOM 交互、焦点、可访问性、
数据与发布来源保护。真正修改 UI/CSS 时仍按适用门禁在 Obsidian 中验证受影响交互。
branch-switch 测试只删除与其他发布来源保护重复的 detached-HEAD dry-run 用例；
CI PR 合并结果分类、beta 来源及发布拒绝路径继续由真实 Git 集成测试保护。

此前常规 CI 与最终版本标签 CI 的完整 coverage 命令限定为 `--maxWorkers=2`；
本地 release 准备仍保持 `--runInBand`。PR #383 的两 worker 测试步骤于
2026-09-25 的 [CI run 36144597950](https://github.com/edonyzpc/personal-assistant/actions/runs/36144597950)
通过，耗时约 8 分 52 秒；先前两次运行暴露的 Writing 测试固定轮转等待已改为
等待真实回合完成。本机有其他任务争用 CPU 和内存，且远端串行基线并非完全相同
输入，本轮不宣称可归因的加速倍数。完整 suite 发现与 coverage 阈值不变。
该次 CI job 因当前 `master` 生产 bundle 的 gzip 体积超过当时预算 17,613 字节
而失败；本分支无生产源码或构建配置改动，本地同样复现。Owner 同日明确授权放宽
bundle 体积门禁；上限从 2.8 MiB 调至 2.85 MiB，当前构建 2,953,626 gzip 字节
仍有 34,816 字节余量。Node 内建引用仍被记录，动态 script、字体及 license 等
审计继续执行。
Owner 同时要求试跑四 worker，常规 CI 与最终版本标签 CI 改用
`--maxWorkers=4 --coverage`；本地 release 准备仍保持 `--runInBand`。四 worker 的
[PR CI run 36148798103](https://github.com/edonyzpc/personal-assistant/actions/runs/36148798103)
在 2026-09-25 通过 327/327 suites、8273/8273 cases、完整 coverage 与 bundle
审计，Jest 耗时 367.459 秒；此前两轮二 worker 测试分别耗时 423.967 秒与
531.055 秒。四 worker 在本次样本中更快，但不同 runner 的波动仍在，不能据此
推断稳定加速幅度；后续 CI 若出现串扰或资源失败，应复核并行数。最终 tag 工作流
须在实际版本标签上独立验证，此处的 PR 证据不替代发布门禁。

## Traceability

| Requirement / AC | Current protection / durable evidence |
| --- | --- |
| B-142/REQ-01 / B-142/AC-01 | [UI/UX behavior](../../../__tests__/pagelet-b118-ui-ux-optimization.test.ts)、[B-136 behavior](../../../__tests__/pagelet-b136-p2-retirement.test.ts) 与上述删项依据；Typography 字面值测试于 2026-09-25 移除 |
| B-142/REQ-02 / B-142/AC-02 | [Settings owner](../../../__tests__/pagelet-settings.test.ts)、[cache race](../../../__tests__/pagelet-agent-quality-cache.test.ts) 与实际标题/断言 |
| B-142/REQ-03 / B-142/AC-03 | [Group contract](../../../__tests__/jest-test-groups-script.test.ts)、[runner](../../../__tests__/retrieval-smoke-runner.test.ts)、[receipt](../../../__tests__/retrieval-evidence-receipt-verify.test.ts) 与 FTS artifact suites |
| B-142/REQ-04 / B-142/AC-04 | 上述 frozen-input 串行/二 worker 配对及保留串行的明确处置 |
| B-142/REQ-05 / B-142/AC-05 | `lint`、production build、完整 coverage、[release contract](../../../__tests__/release-script.test.ts) 与最终 tag 独立验证 |
| B-142/REQ-06 / B-142/AC-06 | 本契约、focused tests 与仓库 Validation Planning And Reuse 规则 |

## Authority And Change Boundary

本契约限定测试优化应满足的工程结果。产品行为改变时
停止受影响切片并重新定范围；更换框架、放宽覆盖/发布边界需 Owner 单独决定。
环境预检、可比较基线与实现授权是执行前提，不是当前设计未决产品问题。

## Terminal Disposition

B-142 已 closeout；Feature Home、SDD 与 Tracker 在稳定规则和证据吸收后删除。本文继续
作为 Current 治理契约。未来若被替代，Superseded 必须指向新的 Current successor。
