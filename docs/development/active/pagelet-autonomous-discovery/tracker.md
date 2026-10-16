# Pagelet Autonomous Discovery Development Tracker

Document status: Current
Delivery status: Planned
Updated: 2026-10-16
Work item: B-175
Authority: 本 track 的唯一执行状态、finding 和验证证据。
Product spec: [Pagelet Autonomous Discovery](../../../product/specs/pagelet-autonomous-discovery-product-spec.md)
SDD: [Implementation Design](./sdd.md)

## Current Snapshot

- 当前阶段：`sdd-only` 文档已完成；用户于 2026-10-16 后续授权将两轮方案提交本地 master，并选择在 MacBook 上继续开发。本主机不启动 runtime/test code 修改或部署，推送尚未授权。
- 源码基线：`ecddc088`；相关 Pagelet/Command 源码相对前次分析基线 `df49a48c` 无变化。
  当前仍有旧语义规则；设计获批不代表代码或运行验收完成。
- 本次 writer：GPT-6；两位独立 GPT reviewer 分别复核产品权威与 runtime 风险，均无阻断设计问题。文档检查证据见下方。
- 下一步：MacBook 开发任务从本 Tracker 与 SDD 接续，按下面三个内部切片完成第一轮；第二轮独立见 [B-176 Product Spec](../../../product/specs/pagelet-reading-loop-product-spec.md) 与 [SDD](../../proposals/pagelet-reading-loop/sdd.md)，按其启动条件迁入 Active，不将第二轮任务/测试提前塞入本轮。
- 无未决第一轮产品阻断；代码实现和全部 runtime 验证尚未开始。保持其他活跃 workstream 原状。

## Work And Development Sequence

切片是实现顺序，不是新产品轮次或额外审批门。实施获得授权后由 GPT-6 固定范围、维护
文档与独立验收，GLM 按现有[交付流程](../../workflows/gpt6-glm-delivery-workflow.md)承担限定源码/测试实施；
同一复杂 runtime 默认一个 writer，避免并行改同一来源/结果类型。只有实际独立工作才拆分。

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-00 | B-175/REQ-01..08 / B-175/AC-01..08 | 文档化设计、局部 authority 接续及验证映射 | [x] | 文档检查通过；仅完成设计交付，不表示功能验收 |
| T-01 | B-175/REQ-01 / B-175/AC-01；B-175/REQ-02 / B-175/AC-02；B-175/REQ-04 / B-175/AC-04 | 模型输入与 lead policy 去语义约束；可选暂存从恢复解耦；恢复回到 search 观察 | [ ] | 源码与对应 focused suites，见 SDD V-01/02/04 |
| T-02 | B-175/REQ-03 / B-175/AC-03；B-175/REQ-06 / B-175/AC-06 | 事实校验、逐份身份/失效、完整集合/缓存、真实终态与用量 | [ ] | SDD V-03/06；取消、来源和提交竞态负例 |
| T-03 | B-175/REQ-05 / B-175/AC-05；B-175/REQ-07 / B-175/AC-07；B-175/REQ-08 / B-175/AC-08 | 最小交付/显式运行接线，部署观察与独立验收 | [ ] | SDD V-05/07/08；范围内统一 gate 一次 |

T-01/T-02 可以在源码依赖需要时一起完成，不以中间不完整接口作为可用交付。
每片先跑受影响的 focused suites；整个闭环完成后冻结相关输入，集中运行必要 broad/app gate。
不要求每片重跑 full suite，不为每个 prompt 句子造测试，不增加后续轮次的验收任务。

## Validation Assignment And Reuse

风险到最低充分证据、通过条件和扩展触发统一见 [SDD Test Matrix](./sdd.md#test-matrix)，
结果只记录本 Tracker。确定性夹具、真实模型、已部署 app 分开；不得用其中一种替代另一种。

- 当前文档任务：`npm run docs:check`、`git diff --check`；仅文档产物，无源码/工具资产变化，
  不跑 TypeScript/build、模型、部署或设备验证。若 docs checker/skills 未改，不为重复检查其自身而运行其实现测试。
- 后续实施：对应 source suites 先行；共享 runtime/多模块行为收口时一次 lint、production
  build、`npm run test:all -- --runInBand`、diff check 与 DOM/style 注入扫描；build 覆盖 TypeScript。
- 实际 app 证据必须先按 [test-vault skill](../../../../.agents/skills/obsidian-test-vault-smoke/SKILL.md)
  部署/重载并核对测试 vault 和 bundle。`make deploy` 已覆盖的 gates 不重复；已有同输入成功证据
  和当前 build 时可用 `make deploy-current`，其身份校验不是测试成功证据。
- 只选 SDD 三类小样本做实际模型观察，不扩成洞察准确率/惊喜率研究；失败先区分语义、边界、
  工具、环境与错误验收，不重采样直到得到预设答案。源码或相关输入改变才补受影响证明。
- 一个执行者负责冻结输入后的昂贵 gates，GPT-6 核对实际 diff、原始证据与必要界面；
  不重复有效 contributor 检查。常规移动风险用 simulator，不自动增加 iPhone 或跨平台矩阵。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| D-01 | Design | 暂存目前受恢复开关和 pending-first 控制，删除显式上限仍不能成为可选暂存 | SDD 拆开生命周期与 capability availability；保留独立来源 | 实施时 V-02/04 | 设计已处理，代码待实施 |
| D-02 | Design | 提示词、工具描述及回执可重新强制首/次发现和终止 | SDD 全部模型可见面审计，采集真实组装输入 | 实施时 V-01 | 设计已处理，代码待实施 |
| D-03 | Scope | 全量短点/长按、Save 与 Detail 旧路径、编辑上下文可拖大第一轮 | Spec 非目标；仅修本轮交付直接阻断 | 范围核对 | 明确排除，无隐性后续验收门 |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-10-16 | B-175/REQ-01..08 / B-175/AC-01..08 | 设计源码复核 | 完成静态核对 | 基线 `ecddc088`，SDD 指向现有代码/测试；不代表 app、真实模型或新设计已实现 |
| 2026-10-16 | 文档完整性 | `npm run docs:check` | PASS，exit 0 | 当前文档链接、最小 package、REQ/AC 映射与 WIP 检查通过；本轮未改 checker/skills，不运行其实现自测 |
| 2026-10-16 | 文档完整性 | `git diff --check`；新增五份 Markdown 独立 whitespace 检查 | PASS | tracked 与 untracked 文档分别覆盖；源码、测试、工具及依赖无差量 |
| 2026-10-16 | B-175/REQ-01..08 / B-175/AC-01..08 | 独立产品与 runtime 设计复核 | 无阻断设计问题 | 两位 GPT reviewer 阅读实际 diff 和五份新文档，分别核对批准/实现区分、权威接续、可选暂存、来源/取消、恢复资格和测试范围；静态设计证据，不代表实现成功 |
| — | B-175/AC-01..08 | runtime / 实际模型 / app | Not run | 未授权实施，不复用历史 PASS 作为新闭环证据 |

## Closeout Readiness

本轮止于设计交付，Delivery status 保持 Planned。未来只有实现、职责复核和必要证据齐备，
才能标记功能验收；closeout/Git/release 仍分别授权。后续讨论不自动进入本包 Work/Test Matrix。
