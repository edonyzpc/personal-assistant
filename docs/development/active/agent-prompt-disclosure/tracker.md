# PA Agent Prompt Disclosure Development Tracker

Document status: Current
Delivery status: Planned
Updated: 2026-10-11
Work item: B-171
Authority: 本任务唯一开发顺序、执行状态、finding 与验证证据。
Product spec: [Prompt Disclosure](../../../product/specs/pa-agent-prompt-disclosure-product-spec.md)
SDD: [Software Design](./sdd.md)

## Current Snapshot

- Authorization: 用户已确认方案并要求方案文档与 SDD 开发测试计划，文档阶段为 `sdd-only`；2026-10-11 追加授权将当前 B-170、B-171 文档提交到本地 master。仍不改正式代码/测试/Skill 运行资源，不调用模型、部署、推送或发布。
- Baseline: `5c224108cb045bdeaec557369a6bbc81e0634eac`；开始时已有 `docs/backlog.md`、Discovery 索引和 B-170 研究记录修改，保留。B-171 独立登记，不推进 B-170 实施。
- Current phase: 方案/SDD/开发测试计划已编制，并经独立只读设计复核；运行实现和新行为验证均未开始。
- Next action: 本地文档交付后等待用户启动后续任务；取得实施授权后由 GPT 核对本 SDD 与工作区，再派发一个有界实现任务。
- Blocker / decision needed: 无未定产品选择；实施未获授权不是验证失败。
- Last verified behavior: 本轮仅核对当前源码与既有记录，不能宣称新 prompt 或性能已通过。

## Development Plan

按 [GPT-6 / GLM workflow](../../workflows/gpt6-glm-delivery-workflow.md) 分工：GPT 维护产品/设计/Tracker并独立验收；默认一个 GLM writer 负责源码、资料和相关测试，同一任务连续交付 T-01/T-02，避免按文件拆大量 worker。配置/额度预检仅补变化，沿既有接管规则，不因其他任务的旧额度记录自动推定本次接管。

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-171/REQ-01、B-171/REQ-02、B-171/REQ-04；B-171/AC-01、B-171/AC-02、B-171/AC-04 | 核心/工具说明精简，事实条件说明，纯输出重复去除；实际请求与估算、摘要/最终轮一并接线 | [ ] | 待实施；V1、V3 |
| T-02 | B-171/REQ-03、B-171/REQ-04；B-171/AC-03、B-171/AC-04 | 复用现有 Skill/reference 承接长方法，拆命令/图片事实与教程；同步相关测试 | [ ] | 待实施；V2、V3 |
| T-03 | B-171/REQ-05；B-171/AC-01、B-171/AC-02、B-171/AC-03、B-171/AC-04、B-171/AC-05 | 独立审查、冻结差量、完整必需门禁、隔离 Chat 与最少模型样本、恢复临时验证环境 | [ ] | 待实施；V4、V5 |

实现前在同一工作区保存普通合成请求的实际序列化基线/工具身份，复用现有测量接口；不创建常驻遥测或跨任务报告系统。代码共享事实解释且涉及来源/权限说明，独立只读审查由实现者之外的 GPT 承担；只处理有具体触发与后果的发现。

## Minimum Sufficient Validation Plan

此处是计划，以下均非已执行证据。优先扩展现有断言，不新建完整 eval 框架；fixture 证明确定性边界，真实模型证明实际行为观察，真实 Chat 证明接线，三者分开。

| ID / risk | Existing evidence / minimum new check | Pass condition | Rerun trigger |
| --- | --- | --- | --- |
| V1：精简不达真实请求、丢 schema 或估算漂移 | `pa-agent-runtime-tool-definitions`、`pa-agent-runtime-prompt`、`pa-agent-prompt-cooperative`、相关 `native-writing-output/loop` 现有 suites；补无历史普通查询、原生/兼容纯输出、实际消息与同步/异步估算一致性 | 绑定集合/参数不变；去重复声明有真实依据；核心和必要调用说明仍在；system、guidance、schema、context/history 分项可比 | 拼装、transport、模板或测量输入变化 |
| V2：指南不可发现/不完整，完整查询退化 | `skill-context-provider` 现有完整入口/reference/来源覆盖；仅补迁移资源注册/关闭场景；`query-notes-tool` 和实际 provider 投影的相关完整列表用例 | 指南完整且零动作；禁用指南不移除工具必需语义；完整匹配清单与正文分离保持 | 资源、目录、工具说明或列表投影变化 |
| V3：最终轮/压缩历史丢效果解释，伪字段提升权限，当前图片事实丢失 | `pa-agent-context-summarizer`、`pa-agent-context-summary-projection`、`pa-agent-action-history`、`task-source-constraint`、`chat-view` 中相应现有用例；补当前/历史 owner 状态、无工具最终轮、压缩编码、伪状态正文及真实图片 refs/版本/像素事实的必要缺口 | accepted/unknown/partial 与原 ID 语义保留；不编造效果或重提未知操作；来源/Context Used 和取消后不接纳材料保持 | 共享规则、投影或 Chat 上下文接线变化 |
| V4：模型行为/耗时与实际 Chat | 复用已有合成夹具和诊断，按下文三个具体案例取最低充分新证据；首个案例同时承担实际 Chat 来源/Context Used 验收 | 正确性与来源可核；没有新增必经 Skill/工具顺序；缺失与限制如实记录；按观察报告延迟/轮数而非承诺比例 | 具体失败、关键未覆盖行为或相关 prompt 改动；不为更好数字重采样 |
| V5：共享 runtime 回归与打包接线 | 输入冻结后集中 lint、production build、`test:all`、diff 与 DOM 禁止项扫描；按有效证据复用部署门禁 | 必需检查自然完成；对应构建已在核对身份的 repo-local test 观察真实 Chat | 相关源码/资源/测试配置变化，或真实失败 |

V1–V3 选择受影响的既有测试，不把所有列出的 suite 当作每次小改都要重复的固定清单。原执行逻辑未变时，取消/deadline、Worker 和 iPhone 运行矩阵复用各自有效证据；只补新的 prompt/fact 接线风险。实际字段是否仍保留通过对应 source/Context Used 断言验证，不能只搜文案。

### Minimal model and app cases

| 案例 | 输入与目的 | 最低新增证据 |
| --- | --- | --- |
| M1 普通完整笔记查询 | 独立 test、新 Chat、固定合成笔记；用户输入明确给定日期区间、所查询的日期字段及所需时区/日期语义。两臂请求与来源设置相同 | 同输入基线/候选各一条逻辑任务；已有确切同输入基线有效则复用。观察完整清单、来源与 Context Used，不要求先取时间、加载 Skill 或读正文 |
| M2 按需方法 | 使用已启用的某个现有 Skill 解释其适用方法，选择实际涉及迁移资料或 reference 的一个任务；无写入/付费效果 | 候选一次，复用确定性完整性证据；观察能力发现和正确回答，不强制特定内部调用序列 |
| M3 历史未知效果 | 合成 owner 记录，结果未知/部分完成，并撤下不应可用的动作工具；询问已有操作状态 | 候选一次，核对已有事实、原 ID、可用只读核查与不重提语义；不真实发布、生图或重放 |

通常新增 3 个候选任务，M1 缺有效同输入基线时另加 1 个基线任务；不是物理调用轮数上限，也不为凑数量运行不相关用例。一个任务的正常必要工具往返保持原预算。先做确定性验证，发现具体问题先修再补相应案例，不重跑整组；遇到环境阻塞先诊断，不将缺证据记为通过。

保持当前获准 provider/model/thinking/temperature 等配置；使用合成数据，不触碰私人 vault 或新增 provider。M1 的固定范围是双方相同的合成用户输入，用于隔离已知日期能力缺口，不是生产 Host 时间注入、日期默认口径或固定调用流程。原句“看一下最近两周我都有哪些笔记记录”复用 B-170 的既有观察，不为本任务再次采样；B-170 两个模型样本不直接充当相同输入的 B-171 对照。若观察到日期错误，单列真实缺口，不据错误答案计算有效提速，也不越界修复 B-170。必要澄清是允许行为；不能编造事实或把未交付记录为完成。

每例记录构建/输入身份、首响应与整任务耗时（可取得则记）、物理模型调用数、输入/输出及 reasoning tokens、工具轨迹、答案正确性。估算/字符量与 provider 实测分列，缺失记未知；单样本不能声称普遍提速或成功率。沿用现有计时/Debug，不增加每句 prompt 的归因实验。

部署先核对 repo-local `test`；使用 `make deploy` 的完整门禁，或当前输入检查/构建已通过时使用 `make deploy-current`，不重复相同 enclosing gate。真实 Chat 操作不能用只打开 Obsidian 或单独脚本冒充。没有新增移动特有路径，本任务不安排 iPhone/WebKit/Android 矩阵；日后有明确平台差异才补对应证据。验证后按本任务清单恢复临时设置、探针和合成资料。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| D-01 | Design risk | 共享 action-state 规则还服务摘要，工具撤下后也需解释历史效果 | 核心常驻；字段解释按实际投影事实，覆盖摘要与最终轮 | V3 | 已纳入设计，待实施验证 |
| D-02 | Design risk | 实际发送与同步/异步估算可能消费不同条件规则 | 同一次 canonical 拼装、共用渲染输入 | V1 | 已纳入设计，待实施验证 |
| D-03 | Test design | 自然语言“最近两周”缺可靠时间事实会混入 B-170 旧能力问题 | M1 使用用户自带确定日期条件的同输入对照；复用原句旧观察 | 独立只读设计复核 | 已修订计划，无新增采样 |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-10-11 | B-171/REQ-01–05 / B-171/AC-01–05 | 源码核对、独立只读设计复核 | 完成 | 接受 D-03 修订，其余无必要扩展；不是运行或模型通过证据 |
| 2026-10-11 | 文档一致性 | `npm run docs:check` | PASS | 新文档、索引与追溯检查通过；与产品运行验收分开 |
| 2026-10-11 | 文档合约 | `npm run test:docs -- --runInBand` | PASS | 2 suites / 57 tests，exit 0；没有运行产品测试或模型 |
| 2026-10-11 | 变更范围 | `git diff --check`、受保护文档身份核对 | PASS | 原有 Backlog / Discovery 索引 / B-170 内容与本轮开始的 SHA-256 一致；仅本任务文档与必要索引新增修改 |

## Closeout Readiness

- 实施尚未获授权，所有开发/运行验收待做；仅获本地文档提交授权，无关闭、推送或发布授权。
- 完成后只把已实现机制吸收到现有 Architecture，不能现在把 Draft 设计写成当前行为。
- 验证与独立审查按以上具体风险收口；未完成项保持可见。显式 closeout 后按文档规范吸收，过程文档默认 delete-after-absorption，独有证据才保留。
